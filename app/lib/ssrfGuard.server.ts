import dnsPromises from "node:dns/promises";
import net from "node:net";

// SSRF guard for merchant-configured OUTBOUND webhooks. A merchant can set a
// webhook URL (back-in-stock / integration action) and the server POSTs shopper
// data — including email PII — to it. Without screening, a malicious merchant
// could point the URL at an internal or cloud-metadata address (169.254.169.254)
// and use the app as an SSRF proxy into our own network. Policy: HTTPS only;
// reject loopback / private / link-local / reserved hosts, both as URL-literal
// IPs AND after DNS resolution (a basic rebinding guard).

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

// True when an IP string is in a private, reserved, loopback, or link-local
// range — i.e. NOT a safe public destination. Unparseable input -> unsafe.
export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — screen the embedded v4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return isPrivateIp(mapped[1]!);

  if (net.isIPv4(ip)) {
    const o = ip.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = o as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 10) return true; // 10/8 private
    if (a === 127) return true; // 127/8 loopback
    if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true; // 224+ multicast / reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local (fe80-febf)
    if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local (fc00-fdff)
    return false;
  }

  return true; // not a recognizable IP — be conservative
}

export interface UrlScreen {
  ok: boolean;
  reason?: string;
  hostname?: string;
  isIp?: boolean;
}

// Synchronous screen: protocol, hostname denylist, and IP-literal range. Does
// NOT resolve DNS (that's assertPublicHttpsUrl). Pure + testable.
export function screenUrl(rawUrl: string): UrlScreen {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "malformed url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "not https" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip [ipv6] brackets
  if (!host) return { ok: false, reason: "no host" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: "loopback host" };
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return { ok: false, reason: "internal host" };
  }
  if (net.isIP(host) !== 0) {
    if (isPrivateIp(host)) return { ok: false, reason: "private ip literal" };
    return { ok: true, hostname: host, isIp: true };
  }
  return { ok: true, hostname: host, isIp: false };
}

type LookupFn = (hostname: string) => Promise<Array<{ address: string }>>;
const defaultLookup: LookupFn = (hostname) => dnsPromises.lookup(hostname, { all: true });

// Full async screen: the sync checks PLUS verify every resolved IP is public.
// `lookup` is injectable for tests. Use before any fetch() to a merchant URL.
export async function assertPublicHttpsUrl(
  rawUrl: string,
  lookup: LookupFn = defaultLookup,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const s = screenUrl(rawUrl);
  if (!s.ok) return { ok: false, reason: s.reason ?? "unsafe url" };
  if (s.isIp) return { ok: true }; // already range-checked as a literal
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(s.hostname!);
  } catch {
    return { ok: false, reason: "dns resolution failed" };
  }
  if (addrs.length === 0) return { ok: false, reason: "no dns records" };
  for (const a of addrs) {
    if (isPrivateIp(a.address)) return { ok: false, reason: "resolves to private ip" };
  }
  return { ok: true };
}
