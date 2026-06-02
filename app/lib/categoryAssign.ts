// Deterministic product-to-bucket assignment. No Claude call. Each product is
// scored against every category, in three tiers, and assigned to its best
// match(es). Crucially, products with NO signal are *balanced* across buckets
// (round-robin to the least-full bucket) rather than dumped into the first one —
// otherwise a tag-poor catalog collapses into a single giant bucket (the
// "97 products in one bucket → only snowboards recommended" bug).
//
// Tiers, in priority:
//   1. Tag overlap (product tags ∩ category tags) — the richest signal.
//   2. Name/type/title token match — works even when tags are empty by
//      matching the product's title + product_type against the bucket's
//      NAME + tags (prefix-tolerant, so "snowboard" matches "Snowboards").
//   3. Balance — the least-full bucket, so noise distributes evenly.

const TOP_N_PER_PRODUCT = 2;

export interface AssignableCategory {
  // Stable key the caller uses to retrieve the bucket (category id, or name in
  // tests). Either works.
  key: string;
  // Human bucket name (e.g. "Snowboards"). Matched against product title +
  // product_type in tier 2 — the main signal when tags are empty.
  name?: string;
  tags: string[];
}

export interface AssignableProduct {
  productId: string;
  tags: string[];
  // Optional secondary signals (tier 2). Provide when available.
  title?: string;
  productType?: string;
}

// Returns categoryKey → productId[]. Every input product appears in at least
// one bucket. The same product may appear in up to TOP_N_PER_PRODUCT buckets
// when it overlaps multiple categories' tags.
export function assignProducts(
  categories: AssignableCategory[],
  products: AssignableProduct[],
): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const c of categories) buckets.set(c.key, []);
  if (categories.length === 0) return buckets;

  const cats = categories.map((c) => ({
    key: c.key,
    tagSet: new Set(c.tags.map(normalize)),
    // Tier-2 vocabulary: the bucket NAME plus its tags.
    tokens: tokenize([c.name ?? "", ...c.tags].join(" ")),
  }));

  // The least-full bucket right now (stable: ties resolve to input order).
  const leastFullKey = (): string => {
    let bestKey = cats[0]!.key;
    let bestN = buckets.get(bestKey)!.length;
    for (const c of cats) {
      const n = buckets.get(c.key)!.length;
      if (n < bestN) {
        bestN = n;
        bestKey = c.key;
      }
    }
    return bestKey;
  };

  for (const p of products) {
    const productTagSet = new Set(p.tags.map(normalize));

    // Tier 1 — tag overlap.
    const scored = cats.map((c) => {
      let score = 0;
      for (const t of c.tagSet) if (productTagSet.has(t)) score++;
      return { key: c.key, score };
    });
    const positives = scored.filter((s) => s.score > 0);
    if (positives.length > 0) {
      positives.sort((a, b) => b.score - a.score);
      for (const top of positives.slice(0, TOP_N_PER_PRODUCT)) {
        buckets.get(top.key)!.push(p.productId);
      }
      continue;
    }

    // Tier 2 — title + product_type tokens vs the bucket name+tags vocabulary.
    const secTokens = tokenize([p.title ?? "", p.productType ?? ""].join(" "));
    if (secTokens.size > 0) {
      let bestKey: string | null = null;
      let bestScore = 0;
      for (const c of cats) {
        let s = 0;
        for (const tok of secTokens) if (tokenMatches(tok, c.tokens)) s++;
        if (s > bestScore) {
          bestScore = s;
          bestKey = c.key;
        }
      }
      if (bestKey) {
        buckets.get(bestKey)!.push(p.productId);
        continue;
      }
    }

    // Tier 3 — no signal at all: balance, don't dump into the first bucket.
    buckets.get(leastFullKey())!.push(p.productId);
  }

  return buckets;
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\-:]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Split a phrase into lowercase word tokens. Keeps tokens ≥ 3 chars to drop
// articles and noise.
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}

// Prefix-tolerant token match so singular/plural and stems align
// ("snowboard" ↔ "snowboards", "serum" ↔ "serums").
function tokenMatches(token: string, vocab: Set<string>): boolean {
  if (vocab.has(token)) return true;
  for (const v of vocab) {
    if (v.length >= 4 && token.length >= 4 && (v.startsWith(token) || token.startsWith(v))) {
      return true;
    }
  }
  return false;
}
