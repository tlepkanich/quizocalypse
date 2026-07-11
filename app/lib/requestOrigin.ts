// Absolute origin for building public-facing URLs (SEO artifacts, share links).
// Fly terminates TLS at the edge and proxies to the app over plain HTTP, so
// `new URL(request.url).origin` is "http://…" in production. Honor
// X-Forwarded-Proto (first hop only; values other than http/https fall back to
// the request URL's own scheme) + the Host header — the same proxy-aware
// pattern as the studio magic-link path.
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const fwd = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = fwd === "https" || fwd === "http" ? fwd : url.protocol.replace(":", "");
  const host = request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}
