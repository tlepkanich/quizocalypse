// Shared CORS seam for the public storefront endpoints.
//
// Most of them (events/captures/sessions/feedback/reward/referral/notify/
// inventory) already carry a hand-rolled copy of this header set — owner-
// confirmed 2026-07-03, explicitly "future non-iframe embeds". Three did not,
// because they were written when the iframe made every call same-origin:
// rec-copy, ai-chat, integration.
//
// Those three return from ~35 places between them. Spreading a CORS const
// into every `json(...)` call would be 35 chances to miss one — and a missed
// header on an ERROR path is the nastiest kind, because the happy path tests
// green while the browser silently blocks the client from reading why a
// request failed. So this wraps the Response instead: one seam, no return
// site untouched, impossible to half-apply.
//
// NOT a security boundary. These endpoints are unauthenticated and already
// POSTable with curl from anywhere; CORS only decides whether *browser JS on
// another origin* may READ the reply. The real controls are rateLimit() and
// checkAiBudget(), which rec-copy and ai-chat both enforce.

export const PUBLIC_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

/** 204 preflight reply. Also serves GET, matching q.$id.inventory.tsx:36. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

/**
 * Copy a Response, adding the public CORS headers. Existing headers survive
 * (Remix's json() sets content-type; rate-limit paths set retry-after).
 *
 * 204/304 carry a null body by spec — reconstructing one with `res.body`
 * throws in undici, so those are rebuilt bodyless.
 */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(PUBLIC_CORS)) headers.set(key, value);
  const bodyless = res.status === 204 || res.status === 304;
  return new Response(bodyless ? null : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
