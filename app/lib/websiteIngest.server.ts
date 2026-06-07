// Brand-website ingestion for richer AI quiz content (Dev Spec §3.2).
//
// Fetches a merchant-supplied URL and extracts readable text to feed quiz
// generation (brand language, mission, FAQ patterns). Dependency-free and
// deliberately conservative: STATIC HTML only (no JS rendering), strips
// script/style/nav/footer/header/form chrome, removes tags, collapses
// whitespace, and caps length. Enrichment is OPTIONAL — every failure path
// returns "" so generation never breaks because a site was slow or malformed.

// ~8k tokens (Dev Spec cap) ≈ 32k chars. Keeps the generation prompt bounded.
const MAX_CHARS = 8000 * 4;
const FETCH_TIMEOUT_MS = 8000;

// Pure: strip a raw HTML string down to readable body text. Exported for tests.
export function extractReadableText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Drop non-content regions entirely (with their inner text).
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|form|template)\b[\s\S]*?<\/\1>/gi, " ")
    // Remove any remaining tags.
    .replace(/<[^>]+>/g, " ")
    // Decode the few entities that matter for readability.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Fetch + extract. Server-only (network IO). Returns "" on any problem
// (bad URL, non-HTML, non-2xx, timeout, network error) — callers treat the
// result as an optional enrichment cue.
export async function ingestWebsite(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";

  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "QuizocalypseBot/1.0 (+https://quizocalypse.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return "";
    }
    const html = await res.text();
    return extractReadableText(html).slice(0, MAX_CHARS);
  } catch {
    // Timeout / DNS / TLS / abort — enrichment is optional, swallow.
    return "";
  }
}
