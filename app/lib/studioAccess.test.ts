import { describe, it, expect } from "vitest";
import { createCookie } from "@remix-run/node";
import { safeEqual, hasStudioAccess } from "./studioAccess.server";

// The constant-time compare backs the standalone /studio access gate's ?key=
// check. We can't unit-test the cookie/redirect flow without a live Request,
// but this guards the comparison logic (the security-sensitive part).
describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(safeEqual("abcdef", "abcxyz")).toBe(false);
  });

  it("returns false for different lengths (no throw)", () => {
    expect(safeEqual("short", "a-much-longer-token")).toBe(false);
  });

  it("returns false when one side is empty", () => {
    expect(safeEqual("", "token")).toBe(false);
  });

  it("handles unicode without throwing", () => {
    expect(safeEqual("kéy-✓", "kéy-✓")).toBe(true);
    expect(safeEqual("kéy-✓", "key-x")).toBe(false);
  });
});

// hasStudioAccess is the non-throwing cookie check that dual-auths the shared
// /api/categories/* endpoints (studio-cookie path vs. embedded Shopify session).
// The signed cookie is HMAC-bound to STUDIO_ACCESS_TOKEN, so we forge a valid
// one with Remix's own createCookie + matching secret. Only the value + secret
// drive the signature (not the Secure/SameSite attrs), so a localhost-style
// cookie verifies fine.
describe("hasStudioAccess", () => {
  const TOKEN = "studio-token-under-test";

  async function grantedCookieHeader(signingToken: string): Promise<string> {
    const cookie = createCookie("qz_studio", { secrets: [signingToken], path: "/" });
    return cookie.serialize("granted");
  }

  function requestWith(header?: string): Request {
    return new Request("http://localhost/api/categories/group", {
      headers: header ? { Cookie: header } : {},
    });
  }

  it("returns false when STUDIO_ACCESS_TOKEN is unset", async () => {
    delete process.env.STUDIO_ACCESS_TOKEN;
    expect(await hasStudioAccess(requestWith(await grantedCookieHeader(TOKEN)))).toBe(false);
  });

  it("returns false with no cookie present", async () => {
    process.env.STUDIO_ACCESS_TOKEN = TOKEN;
    expect(await hasStudioAccess(requestWith())).toBe(false);
  });

  it("returns true for a cookie signed with the current token", async () => {
    process.env.STUDIO_ACCESS_TOKEN = TOKEN;
    expect(await hasStudioAccess(requestWith(await grantedCookieHeader(TOKEN)))).toBe(true);
  });

  it("returns false once the token has rotated (old cookie no longer verifies)", async () => {
    const stale = await grantedCookieHeader("previous-token");
    process.env.STUDIO_ACCESS_TOKEN = "rotated-token";
    expect(await hasStudioAccess(requestWith(stale))).toBe(false);
  });
});

// Magic-link session cookie path: qz_studio_session is HMAC-signed with
// STUDIO_SESSION_SECRET (falling back to STUDIO_ACCESS_TOKEN) and carries the
// allowlisted email. Forged the same way as above — value + secret drive the
// signature.
describe("hasStudioAccess (magic-link session)", () => {
  const SECRET = "session-secret-under-test";

  async function sessionCookieHeader(email: string, secret: string): Promise<string> {
    const cookie = createCookie("qz_studio_session", { secrets: [secret], path: "/" });
    return cookie.serialize(email);
  }

  function requestWith(header?: string): Request {
    return new Request("http://localhost/api/categories/group", {
      headers: header ? { Cookie: header } : {},
    });
  }

  it("returns true for a session cookie signed with STUDIO_SESSION_SECRET", async () => {
    delete process.env.STUDIO_ACCESS_TOKEN;
    process.env.STUDIO_SESSION_SECRET = SECRET;
    const header = await sessionCookieHeader("owner@example.com", SECRET);
    expect(await hasStudioAccess(requestWith(header))).toBe(true);
    delete process.env.STUDIO_SESSION_SECRET;
  });

  it("falls back to STUDIO_ACCESS_TOKEN as the signing secret", async () => {
    delete process.env.STUDIO_SESSION_SECRET;
    process.env.STUDIO_ACCESS_TOKEN = SECRET;
    const header = await sessionCookieHeader("owner@example.com", SECRET);
    expect(await hasStudioAccess(requestWith(header))).toBe(true);
    delete process.env.STUDIO_ACCESS_TOKEN;
  });

  it("rejects a session cookie signed with the wrong secret", async () => {
    delete process.env.STUDIO_ACCESS_TOKEN;
    process.env.STUDIO_SESSION_SECRET = SECRET;
    const header = await sessionCookieHeader("owner@example.com", "some-other-secret");
    expect(await hasStudioAccess(requestWith(header))).toBe(false);
    delete process.env.STUDIO_SESSION_SECRET;
  });

  it("rejects a signed value that is not an email", async () => {
    delete process.env.STUDIO_ACCESS_TOKEN;
    process.env.STUDIO_SESSION_SECRET = SECRET;
    const header = await sessionCookieHeader("granted", SECRET);
    expect(await hasStudioAccess(requestWith(header))).toBe(false);
    delete process.env.STUDIO_SESSION_SECRET;
  });
});
