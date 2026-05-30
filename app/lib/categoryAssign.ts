// Deterministic product-to-category bucketing via lowercase tag overlap.
// No Claude call — once discovery returns the categories + their
// embodying tags, every product is scored against every category and
// assigned to its top N matches. Products with zero overlap fall back to
// the category whose tags share the most root words with the product's
// title so nothing is orphaned.

const TOP_N_PER_PRODUCT = 2;

export interface AssignableCategory {
  // Stable key the caller uses to retrieve the bucket. The discovery
  // route uses category id (cuid). Tests use name. Either works.
  key: string;
  tags: string[];
}

export interface AssignableProduct {
  productId: string;
  tags: string[];
  // Optional — used only by the zero-overlap fallback to find a sensible
  // home. Skip if you don't have it.
  title?: string;
}

// Returns categoryKey → productId[]. Every input product appears in at
// least one bucket (zero-overlap fallback). The same product may appear
// in up to TOP_N_PER_PRODUCT buckets when it overlaps multiple categories.
export function assignProducts(
  categories: AssignableCategory[],
  products: AssignableProduct[],
): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const c of categories) buckets.set(c.key, []);
  if (categories.length === 0) return buckets;

  // Normalize once. Match is case-insensitive after this point.
  const catTagSets = categories.map((c) => ({
    key: c.key,
    tagSet: new Set(c.tags.map(normalize)),
    tokens: tokenize(c.tags.join(" ")),
  }));

  for (const p of products) {
    const productTags = p.tags.map(normalize);
    const productTagSet = new Set(productTags);

    // Score = number of category tags this product matches.
    const scored = catTagSets.map((c) => {
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

    // Zero-overlap fallback: pick the category whose vocabulary shares the
    // most tokens with the product's title. If we have no title or every
    // score is still zero, default to the first category — better than
    // orphaning.
    if (p.title) {
      const titleTokens = tokenize(p.title);
      let bestKey: string | null = null;
      let bestScore = 0;
      for (const c of catTagSets) {
        let s = 0;
        for (const tok of titleTokens) if (c.tokens.has(tok)) s++;
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
    buckets.get(catTagSets[0]!.key)!.push(p.productId);
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

// Split a phrase into lowercase word tokens for fuzzy matching during
// the zero-overlap fallback. Keeps tokens ≥ 3 chars to drop articles and
// noise.
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}
