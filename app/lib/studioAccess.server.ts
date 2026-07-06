import { createCookie, redirect } from "@remix-run/node";
import { timingSafeEqual } from "node:crypto";
import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { logFor } from "./log.server";
import { clientIp } from "./rateLimiters";

// ───────────────────────────────────────────────────────────────────────────
// Access gate for the standalone /studio surface. This surface is NOT behind
// Shopify's embedded auth. Primary auth is email magic links: /studio/login →
// emailed single-use link → /studio/verify sets a signed, httpOnly session
// cookie (grantStudioSession below; issuing lives in studioMagicLink.server).
// The legacy shared-token path (?key=<STUDIO_ACCESS_TOKEN> → qz_studio cookie)
// is kept as a break-glass fallback until magic-link login is confirmed
// working, then it gets removed. Rotating the signing secret invalidates every
// cookie at once (cookies are HMAC-signed with it and carry no secrets).
// ───────────────────────────────────────────────────────────────────────────

// Constant-time string compare (length-guarded) to avoid a timing side-channel
// on the ?key= check. Exported for unit testing.
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// True when the request is (effectively) HTTPS — directly, or behind a
// proxy/tunnel that sets X-Forwarded-Proto. Drives the cookie's Secure flag so
// it's Secure in production (https) but still settable over http://localhost.
function isSecureRequest(request: Request): boolean {
  const fwd = request.headers.get("x-forwarded-proto");
  if (fwd) return fwd.split(",")[0]!.trim() === "https";
  return new URL(request.url).protocol === "https:";
}

// Signed cookie bound to the current token — built lazily so it reads the env
// at request time (not module load). `secure` is request-derived (above).
function accessCookie(token: string, secure: boolean) {
  return createCookie("qz_studio", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 60 * 60 * 24 * 7, // 7 days (BIC-2 A2b — was 30)
    secrets: [token],
  });
}

// Secret that signs the magic-link session cookie. Falls back to the legacy
// access token so no new env var is strictly required; rotating whichever
// secret is in use invalidates every session at once.
function sessionSecret(): string | undefined {
  return process.env.STUDIO_SESSION_SECRET ?? process.env.STUDIO_ACCESS_TOKEN;
}

// Signed session cookie set after a successful magic-link verify. The value is
// the allowlisted email the link was issued to.
function sessionCookie(secret: string, secure: boolean) {
  return createCookie("qz_studio_session", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 60 * 60 * 24 * 7, // 7 days (BIC-2 A2b — was 30)
    secrets: [secret],
  });
}

/**
 * Serialize the session cookie for `email` — called by /studio/verify after a
 * magic link is consumed. Returns the Set-Cookie header value.
 */
export async function grantStudioSession(email: string, request: Request): Promise<string> {
  const secret = sessionSecret();
  if (!secret) {
    throw new Response(
      "Studio login is not configured. Set STUDIO_SESSION_SECRET (or STUDIO_ACCESS_TOKEN).",
      { status: 503 },
    );
  }
  return sessionCookie(secret, isSecureRequest(request)).serialize(email);
}

/**
 * Email carried by a valid magic-link session cookie, or null. The HMAC
 * signature check (bound to sessionSecret) is what authenticates; the parsed
 * value just identifies who logged in. Exported for tests and for screens
 * that want to show the signed-in address.
 */
export async function studioSessionEmail(request: Request): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const parsed = await sessionCookie(secret, isSecureRequest(request)).parse(
    request.headers.get("Cookie"),
  );
  return typeof parsed === "string" && parsed.includes("@") ? parsed : null;
}

// True when the request carries the legacy break-glass token cookie.
async function hasLegacyTokenCookie(request: Request): Promise<boolean> {
  const token = process.env.STUDIO_ACCESS_TOKEN;
  if (!token) return false;
  const granted = await accessCookie(token, isSecureRequest(request)).parse(
    request.headers.get("Cookie"),
  );
  return granted === "granted";
}

/**
 * Gate a standalone /studio request. Returns void when access is granted;
 * otherwise throws a Response (redirect to /studio/login, or the legacy ?key=
 * cookie-set redirect). Call at the top of every /studio loader/action.
 */
export async function requireStudioAccess(request: Request): Promise<void> {
  if (!sessionSecret()) {
    throw new Response(
      "The standalone builder is not configured. Set STUDIO_SESSION_SECRET (or STUDIO_ACCESS_TOKEN).",
      { status: 503 },
    );
  }

  // Primary: magic-link session.
  if (await studioSessionEmail(request)) return;

  // Break-glass: legacy shared-token cookie / ?key= (remove once magic-link
  // login is confirmed working for everyone).
  if (await hasLegacyTokenCookie(request)) return;
  const token = process.env.STUDIO_ACCESS_TOKEN;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (token && key && safeEqual(key, token)) {
    // BIC-2 A2(b) — every break-glass use leaves an audit line (ip + path;
    // pino adds the timestamp; NEVER token values).
    logFor("studio-login").warn(
      { ip: clientIp(request), path: url.pathname, accepted: true },
      "legacy ?key= break-glass login",
    );
    // Valid key → set the signed cookie and redirect to the clean URL so the
    // token doesn't linger in the address bar / history.
    url.searchParams.delete("key");
    throw redirect(url.pathname + url.search, {
      headers: { "Set-Cookie": await accessCookie(token, isSecureRequest(request)).serialize("granted") },
    });
  }
  if (key !== null) {
    // A wrong key is a probe worth seeing in the logs too.
    logFor("studio-login").warn(
      { ip: clientIp(request), path: url.pathname, accepted: false },
      "legacy ?key= break-glass login rejected",
    );
  }

  throw redirect("/studio/login");
}

/**
 * BIC-2 A2(b) — Set-Cookie values that clear BOTH studio cookies (the
 * magic-link session and the legacy break-glass token cookie). Used by
 * POST /studio/logout. Expiring a cookie needs only name+path, so missing
 * secrets fall back to a placeholder rather than failing the sign-out.
 */
export async function clearStudioCookies(request: Request): Promise<string[]> {
  const secure = isSecureRequest(request);
  return Promise.all([
    sessionCookie(sessionSecret() ?? "unset", secure).serialize("", { maxAge: 0 }),
    accessCookie(process.env.STUDIO_ACCESS_TOKEN ?? "unset", secure).serialize("", { maxAge: 0 }),
  ]);
}

// Spin-off: the synthetic, non-myshopify domain that keys the single standalone
// workspace. Deliberately NOT a *.myshopify.com value, so any code path that
// slips a Shopify guard breaks visibly rather than hitting a real store.
export const STANDALONE_DOMAIN = "studio.local";

// True for a non-Shopify workspace. Gates the Shopify-only paths (catalog sync,
// discount creation, brand/theme signal reads, the funnel "resync" intent).
export function isStandalone(shop: Pick<Shop, "source">): boolean {
  return shop.source === "standalone";
}

/**
 * Resolve-or-create the single standalone workspace (source="standalone"),
 * keyed on STANDALONE_DOMAIN. Mirrors the catalogSync `ensureShop` upsert. No
 * Shopify session, no admin client — a pure local row.
 */
export async function resolveStandaloneShop(): Promise<Shop> {
  return prisma.shop.upsert({
    where: { shopDomain: STANDALONE_DOMAIN },
    update: {},
    create: { shopDomain: STANDALONE_DOMAIN, source: "standalone" },
  });
}

/**
 * Resolve the single shop the standalone /studio surface manages. With
 * STUDIO_MODE=standalone it's the non-Shopify workspace (no DEV_SHOP_DOMAIN, no
 * Shopify calls); otherwise it's the DEV_SHOP_DOMAIN dev store (the Shopify
 * live-verify path). Every /studio route + resolveApiShop calls this, so the
 * mode switch needs no route changes. Never trusts client input for identity.
 */
export async function resolveStudioShop(): Promise<Shop> {
  if (process.env.STUDIO_MODE === "standalone") {
    return resolveStandaloneShop();
  }
  const domain = process.env.DEV_SHOP_DOMAIN;
  if (!domain) {
    throw new Response(
      "DEV_SHOP_DOMAIN is not set. Point it at your installed dev store (e.g. my-store.myshopify.com).",
      { status: 503 },
    );
  }
  const shop = await prisma.shop.findUnique({ where: { shopDomain: domain } });
  if (!shop) {
    throw new Response(
      `No installed shop matches DEV_SHOP_DOMAIN (${domain}). Install the app on that store first.`,
      { status: 404 },
    );
  }
  return shop;
}

// Non-throwing variant of the gate: true when the request carries a valid
// magic-link session cookie OR the legacy signed token cookie. Used to
// dual-auth shared API endpoints (the builder's same-origin fetches carry the
// cookie). Exported for tests.
export async function hasStudioAccess(request: Request): Promise<boolean> {
  if (await studioSessionEmail(request)) return true;
  return hasLegacyTokenCookie(request);
}

// Resolve the shop for a shared API endpoint that must serve BOTH the embedded
// Shopify admin and the standalone /studio surface. Studio cookie first (the
// standalone path), else fall back to the embedded session. One helper lets the
// grouping endpoints work on both surfaces with no change to their callers.
export async function resolveApiShop(request: Request): Promise<Shop> {
  if (await hasStudioAccess(request)) {
    return resolveStudioShop();
  }
  // Lazy import: keeps shopify.server (which constructs shopifyApp() at module
  // load, validating SHOPIFY_APP_URL) out of the import graph for callers that
  // only need the studio-cookie path — notably the unit tests for
  // hasStudioAccess/safeEqual, which run without Shopify env configured.
  const { authenticate } = await import("../shopify.server");
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  return shop;
}
