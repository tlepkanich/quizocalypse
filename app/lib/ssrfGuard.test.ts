import { describe, expect, it } from "vitest";
import { isPrivateIp, screenUrl, assertPublicHttpsUrl } from "./ssrfGuard.server";

describe("isPrivateIp", () => {
  it("flags private / reserved / loopback / link-local IPv4", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("flags private IPv6 and IPv4-mapped, allows public IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  it("treats unparseable input as unsafe", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("")).toBe(true);
  });
});

describe("screenUrl", () => {
  it("rejects non-https, loopback, internal, and private literals", () => {
    expect(screenUrl("http://example.com").ok).toBe(false);
    expect(screenUrl("ftp://example.com").ok).toBe(false);
    expect(screenUrl("https://localhost/x").ok).toBe(false);
    expect(screenUrl("https://foo.internal").ok).toBe(false);
    expect(screenUrl("https://10.0.0.1").ok).toBe(false);
    expect(screenUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(screenUrl("not a url").ok).toBe(false);
  });

  it("accepts public hostnames and public IP literals", () => {
    const h = screenUrl("https://hooks.example.com/abc");
    expect(h.ok).toBe(true);
    expect(h.isIp).toBe(false);
    const ip = screenUrl("https://8.8.8.8/x");
    expect(ip.ok).toBe(true);
    expect(ip.isIp).toBe(true);
  });
});

describe("assertPublicHttpsUrl", () => {
  it("rejects a hostname that resolves to a private IP (rebinding guard)", async () => {
    const r = await assertPublicHttpsUrl("https://evil.example.com", async () => [
      { address: "10.0.0.5" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("allows a hostname that resolves only to public IPs", async () => {
    const r = await assertPublicHttpsUrl("https://hooks.example.com", async () => [
      { address: "93.184.216.34" },
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects when any resolved address is private", async () => {
    const r = await assertPublicHttpsUrl("https://mixed.example.com", async () => [
      { address: "93.184.216.34" },
      { address: "127.0.0.1" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("public IP literal needs no DNS lookup", async () => {
    let called = false;
    const r = await assertPublicHttpsUrl("https://1.1.1.1", async () => {
      called = true;
      return [];
    });
    expect(r.ok).toBe(true);
    expect(called).toBe(false);
  });

  it("rejects non-https without lookup", async () => {
    const r = await assertPublicHttpsUrl("http://example.com");
    expect(r.ok).toBe(false);
  });
});
