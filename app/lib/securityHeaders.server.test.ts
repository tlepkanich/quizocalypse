import { describe, expect, it } from "vitest";
import { applySecurityHeaders, routeClass } from "./securityHeaders.server";

// BIC-2 A2(a) — the per-route-class header matrix. The embeddability contract
// is the load-bearing part: /studio must never be frameable, /app must STAY
// Shopify-admin-frameable, and /q (+ launcher + results + compare) must stay
// storefront-frameable (NO frame-ancestors, NO CSP).

function headersFor(pathname: string, existing?: Record<string, string>): Headers {
  const headers = new Headers(existing);
  applySecurityHeaders(pathname, headers, { dev: false });
  return headers;
}

describe("routeClass", () => {
  it("classifies the three trees (and does not over-match prefixes)", () => {
    expect(routeClass("/studio")).toBe("studio");
    expect(routeClass("/studio/quizzes")).toBe("studio");
    expect(routeClass("/studio/login")).toBe("studio");
    expect(routeClass("/app")).toBe("app");
    expect(routeClass("/app/analytics")).toBe("app");
    expect(routeClass("/q/abc123")).toBe("public");
    expect(routeClass("/q/abc123/results")).toBe("public");
    expect(routeClass("/q/abc123/compare")).toBe("public");
    expect(routeClass("/")).toBe("public");
    // Prefix strings that are NOT the admin trees stay public.
    expect(routeClass("/studiofoo")).toBe("public");
    expect(routeClass("/apple")).toBe("public");
  });
});

describe("base headers (every route class)", () => {
  it("sets nosniff + referrer-policy everywhere", () => {
    for (const path of ["/studio", "/app", "/q/abc", "/"]) {
      const h = headersFor(path);
      expect(h.get("X-Content-Type-Options")).toBe("nosniff");
      expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    }
  });
});

describe("/studio — admin, never framed", () => {
  it("sets X-Frame-Options DENY and a CSP with frame-ancestors 'none'", () => {
    const h = headersFor("/studio/quizzes");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    const csp = h.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: https:");
    // Merchant quiz fonts preview from Google Fonts in the builder canvas —
    // the CSS origin in style-src, the font files in font-src, nothing wider.
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
  });
});

describe("/app — embedded admin, MUST stay Shopify-frameable", () => {
  it("never sets X-Frame-Options (DENY would blank the admin iframe)", () => {
    expect(headersFor("/app/analytics").get("X-Frame-Options")).toBeNull();
  });

  it("falls back to *.myshopify.com + admin.shopify.com frame-ancestors", () => {
    const csp = headersFor("/app").get("Content-Security-Policy")!;
    expect(csp).toContain(
      "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
    );
    expect(csp).not.toContain("'none'");
    // App Bridge loads from the Shopify CDN.
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.shopify.com");
  });

  it("preserves Shopify's exact-shop frame-ancestors when already set", () => {
    const shopify =
      "frame-ancestors https://my-store.myshopify.com https://admin.shopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev;";
    const csp = headersFor("/app", { "Content-Security-Policy": shopify }).get(
      "Content-Security-Policy",
    )!;
    expect(csp).toContain("frame-ancestors https://my-store.myshopify.com");
    expect(csp).not.toContain("*.myshopify.com"); // fallback NOT used
    expect(csp).toContain("default-src 'self'"); // full policy added around it
  });
});

describe("/q + everything public — storefront-frameable, CSP-free", () => {
  it("adds NO frame-ancestors, NO CSP, NO X-Frame-Options", () => {
    for (const path of ["/q/abc123", "/q/abc123/results", "/q/abc123/compare", "/"]) {
      const h = headersFor(path);
      expect(h.get("Content-Security-Policy")).toBeNull();
      expect(h.get("X-Frame-Options")).toBeNull();
    }
  });
});

describe("dev relaxation (HMR must keep working)", () => {
  it("appends ws:/wss: to connect-src and 'unsafe-eval' to script-src in dev only", () => {
    const dev = new Headers();
    applySecurityHeaders("/studio", dev, { dev: true });
    const devCsp = dev.get("Content-Security-Policy")!;
    expect(devCsp).toContain("connect-src 'self' https: ws: wss:");
    expect(devCsp).toContain("'unsafe-eval'");

    const prodCsp = headersFor("/studio").get("Content-Security-Policy")!;
    expect(prodCsp).not.toContain("ws:");
    expect(prodCsp).not.toContain("'unsafe-eval'");
  });
});
