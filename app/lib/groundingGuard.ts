// GEN-GROUND (owner incident 2026-08-16) — deterministic topical-overlap
// guards. A funnel build once shipped a "Pet Life Stage & Health Finder"
// title on an outdoor-gear quiz: the shop-level web research + brand identity
// were pet-flavored, the Haiku type pass anchored on them over the
// bucket-scoped catalog, and the picked card's title/angle were stamped onto
// the build unvalidated. These helpers are the pure text layer both fixes
// share: research relevance (shopWebResearch.server.ts) and the picked-
// direction guard (step2Build / step1Build).
//
// Design: cheap token overlap, biased to NOT firing. Quiz-domain generic
// words are stopworded so "Product Finder" or "matching answers" never count
// as topical overlap; sparse inputs (too few content tokens to judge) always
// pass. The guards gate a mild action — rename + drop the card's angle/seed
// context, or run fresh research — never a hard failure.

const STOPWORDS = new Set([
  // english function words
  "the", "and", "for", "with", "your", "you", "our", "their", "that",
  "this", "these", "those", "from", "into", "onto", "about", "across", "over",
  "under", "after", "before", "between", "through", "than", "then", "them",
  "they", "are", "was", "were", "will", "would", "could", "should", "can",
  "not", "all", "any", "each", "every", "one", "two", "three", "how", "what",
  "which", "who", "when", "where", "why", "its", "his", "her", "out", "off",
  "get", "got", "has", "have", "had", "does", "did", "most", "more", "less",
  "very", "just", "also", "only", "own", "same", "such", "too", "per", "via",
  // quiz-domain generics (would create false topical overlap on any quiz)
  "quiz", "quizzes", "question", "questions", "answer", "answers", "result",
  "results", "recommendation", "recommendations", "recommend", "recommends",
  "match", "matches", "matcher", "matching", "finder", "find", "finds",
  "guide", "builder", "build", "route", "routes", "shop", "store", "product",
  "products", "brand", "brands", "collection", "collections", "shopper",
  "shoppers", "customer", "customers", "need", "needs", "right", "best",
  "fit", "fits", "help", "helps", "pick", "picks", "choose", "choosing",
  "personalized", "perfect", "ideal", "discover", "profile",
]);

/** Lowercased content tokens: ≥3 chars, stopwords dropped, trailing plural
 *  "s" trimmed so "boots" and "boot" collide. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    const token = raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw;
    if (STOPWORDS.has(raw) || STOPWORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

function shareAToken(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/** Does a picked direction (card title + angle) plausibly describe the quiz's
 *  actual grounding (bucket names + routing tags + the merchant's goal)?
 *  True = keep the card's name and angle. Sparse inputs can't be judged and
 *  pass — the guard only fires on a confident, total mismatch. */
export function directionMatchesGrounding(direction: string, grounding: string): boolean {
  const d = contentTokens(direction);
  const g = contentTokens(grounding);
  if (d.size < 2 || g.size < 3) return true;
  return shareAToken(d, g);
}

/** Is a cached brand-level research text topically relevant to THIS quiz's
 *  focus (chosen bucket names + goal)? False → the caller runs fresh,
 *  focus-aware research instead of reusing a different category's cache. */
export function researchCoversFocus(
  researchText: string,
  focus: { goal: string; bucket_names: string[] },
): boolean {
  const f = contentTokens([...focus.bucket_names, focus.goal].join(" "));
  if (f.size === 0) return true;
  return shareAToken(f, contentTokens(researchText));
}
