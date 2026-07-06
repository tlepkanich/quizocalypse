// BIC-2 B2b — preload the intro hero image on /q via a
// `Link: <url>; rel=preload; as=image` RESPONSE HEADER. Header-only by design:
// `links()` is static (it runs without loader data, so it can't see the doc),
// and a <link> element would change the /q HTML, which must stay byte-stable.
// The route's `headers` export already passes loader headers through, so the
// Link header rides alongside the existing Cache-Control.

/** Refuse to emit absurdly long headers (proxies commonly cap ~4–8KB total). */
const MAX_PRELOAD_URL_LENGTH = 2000;

/**
 * Build a `Link` header value preloading `url` as an image, or null when the
 * URL is unusable. Guarantees: https only; the emitted value is printable
 * ASCII with no raw `<`, `>`, `"` or backslash inside the URI (encodeURI
 * percent-encodes those plus whitespace/control chars/non-ASCII), so the
 * header can never be broken or smuggle a second header. Anything weird →
 * null, meaning "no header" — the page is unaffected.
 */
export function imagePreloadLinkHeader(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PRELOAD_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const encoded = encodeURI(trimmed);
  // Defense in depth: encodeURI already percent-encodes these, but a header
  // must never contain them raw — reject outright if any survive, and require
  // printable ASCII end to end.
  if (!/^[\x21-\x7e]+$/.test(encoded) || /[<>"\\]/.test(encoded)) return null;

  return `<${encoded}>; rel=preload; as=image`;
}
