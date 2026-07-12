// BIC-2 A2(a) — app-wide security headers for DOCUMENT responses, applied in
// entry.server's handleRequest AFTER Shopify's addDocumentResponseHeaders (so
// the embedded admin's exact-shop frame-ancestors, when Shopify sets it, can
// be preserved rather than clobbered).
//
// Route-class contract (the load-bearing part — verified by unit test + curl):
//   /studio* — admin, NEVER framed:  X-Frame-Options: DENY + CSP with
//              frame-ancestors 'none'.
//   /app*    — admin, but runs INSIDE the Shopify admin iframe: CSP whose
//              frame-ancestors comes from Shopify's header when present (the
//              exact shop domain), else the *.myshopify.com/admin.shopify.com
//              fallback. NO X-Frame-Options (XFO has no multi-origin allow
//              form — DENY here would blank the embedded admin).
//   everything else (/q*, the launcher, /q/:id/results, /q/:id/compare, /) —
//              nosniff + Referrer-Policy ONLY. No frame-ancestors, no CSP:
//              storefront iframes (launcher embed + Theme App Extension) must
//              keep framing /q, and merchant-injected content/fonts must not
//              be broken by a CSP this phase.
//
// Resource routes (/q/:id.json, /events, /sessions, /health, the launcher JS)
// do not pass through handleRequest and are untouched — the byte-pinned
// /q/:id.json wire cannot be affected by construction.

// Remix streams HTML with inline hydration scripts and React uses inline
// style attributes, hence 'unsafe-inline' in both script-src and style-src.
// Product imagery is served from Shopify's CDN (img-src https:); the ADMIN
// CHROME's fonts are self-hosted (font-src 'self', data: for inline glyph
// fallbacks) — but the builder canvas previews MERCHANT quiz fonts, which
// load from Google Fonts (googleFontsUrl → fonts.googleapis.com CSS →
// fonts.gstatic.com files). Without those two origins every canvas heading
// silently fell back to Times, so the builder could never show a quiz's real
// typography. Allow exactly that origin pair, nothing wider.
const STUDIO_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https:",
  "frame-ancestors 'none'",
];

// The embedded admin additionally loads App Bridge from cdn.shopify.com (the
// AppProvider injects the script tag; addDocumentResponseHeaders preloads it).
const APP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.shopify.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https:",
];

// Used when Shopify's addDocumentResponseHeaders did NOT set frame-ancestors
// (it only does so when the request carries a valid ?shop= param).
const APP_FRAME_ANCESTORS_FALLBACK =
  "frame-ancestors https://*.myshopify.com https://admin.shopify.com";

export type RouteClass = "studio" | "app" | "public";

/** Classify a pathname into the three header regimes above. */
export function routeClass(pathname: string): RouteClass {
  if (pathname === "/studio" || pathname.startsWith("/studio/")) return "studio";
  if (pathname === "/app" || pathname.startsWith("/app/")) return "app";
  return "public";
}

// Pull the frame-ancestors directive out of an existing CSP header value
// (Shopify's addDocumentResponseHeaders emits a frame-ancestors-only policy
// for the exact shop — more precise than our wildcard fallback, so keep it).
function frameAncestorsFrom(existingCsp: string | null): string | null {
  if (!existingCsp) return null;
  const match = existingCsp.match(/frame-ancestors[^;]*/i);
  return match ? match[0].trim() : null;
}

// Dev builds need the Vite HMR websocket (connect-src ws:) and dev-mode React
// refresh (script-src 'unsafe-eval'); production stays strict. Injected as an
// option so the relaxation is unit-testable and never accidental.
function buildCsp(directives: readonly string[], dev: boolean): string {
  if (!dev) return directives.join("; ");
  return directives
    .map((d) => {
      if (d.startsWith("connect-src")) return `${d} ws: wss:`;
      if (d.startsWith("script-src")) return `${d} 'unsafe-eval'`;
      return d;
    })
    .join("; ");
}

/**
 * Set the security headers for one document response. Call after Shopify's
 * addDocumentResponseHeaders. Mutates `headers` in place; never throws.
 */
export function applySecurityHeaders(
  pathname: string,
  headers: Headers,
  opts?: { dev?: boolean },
): void {
  const dev = opts?.dev ?? process.env.NODE_ENV !== "production";
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const cls = routeClass(pathname);
  if (cls === "public") return;

  if (cls === "studio") {
    headers.set("X-Frame-Options", "DENY");
    headers.set("Content-Security-Policy", buildCsp(STUDIO_DIRECTIVES, dev));
    return;
  }

  // Embedded /app: preserve Shopify's exact-shop frame-ancestors when set.
  const preserved = frameAncestorsFrom(headers.get("Content-Security-Policy"));
  headers.set(
    "Content-Security-Policy",
    buildCsp([...APP_DIRECTIVES, preserved ?? APP_FRAME_ANCESTORS_FALLBACK], dev),
  );
}
