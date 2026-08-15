// DOM-embed transport seam. The runtime posts to ~14 absolute paths
// (/events, /captures, /sessions, /q/:id/rec-copy, …). Inside the theme app
// extension's iframe those are same-origin by construction: the iframe
// document IS our origin. A DOM embed mounts the same React tree into the
// MERCHANT's document, where every one of those paths resolves against
// their storefront and 404s.
//
// The base defaults to "" so `apiUrl("/events") === "/events"` — every
// existing caller is byte-identical and the /q path is untouched. ONLY the
// embed entry calls setApiBase(), and only in the browser.
//
// Module-level (not context/prop) on purpose: the fetches live in leaf
// components, engagement widgets, and a non-React helper (analytics.ts,
// postQuizSession.ts). Threading a prop to all of them would touch far more
// of the highest-risk edit class than this does.
//
// SSR safety: the server never calls setApiBase, so `base` stays "" for the
// life of the process. That matters because module state on the server is
// shared across ALL requests — a per-request write here would leak one
// shopper's origin into another's render.

let base = "";

/**
 * Point the runtime's API calls at an absolute origin. Browser-only —
 * calling this during SSR would poison every subsequent request on the
 * server (shared module state), so it no-ops there.
 *
 * Trailing slashes are stripped so `apiUrl` can always concatenate a
 * leading-slash path without producing a double slash.
 */
export function setApiBase(origin: string): void {
  if (typeof window === "undefined") return;
  base = origin.replace(/\/+$/, "");
}

/** Current base ("" when same-origin). Exposed for the embed's own probes. */
export function getApiBase(): string {
  return base;
}

/**
 * Resolve a runtime API path. Returns `path` unchanged when no base is set,
 * which is the /q (iframe + direct link) case.
 */
export function apiUrl(path: string): string {
  return base ? `${base}${path}` : path;
}
