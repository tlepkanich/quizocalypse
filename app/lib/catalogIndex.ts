import type { Product, Collection } from "@prisma/client";

// Scoped product index passed to the AI generator. Spec §3.2: when the catalog
// summary exceeds the model's effective context budget, downgrade to attribute
// distribution rather than full product listings.

const FULL_LISTING_BUDGET = 80; // products
const SAMPLE_PER_BAND = 5;

export interface ScopedIndex {
  products: Product[];
  collections: Collection[];
  summary: string;
}

export function buildScopedIndex(
  allProducts: Product[],
  allCollections: Collection[],
  collectionIds: string[],
): ScopedIndex {
  const scopedCollections =
    collectionIds.length === 0
      ? allCollections
      : allCollections.filter((c) => collectionIds.includes(c.collectionId));

  const inScope = (p: Product) =>
    collectionIds.length === 0 ||
    p.collectionIds.some((id) => collectionIds.includes(id));

  const products = allProducts.filter(inScope);

  return {
    products,
    collections: scopedCollections,
    summary: buildSummary(products, scopedCollections),
  };
}

function buildSummary(products: Product[], collections: Collection[]): string {
  const lines: string[] = [];
  lines.push(`Total scoped products: ${products.length}`);
  lines.push(`Scoped collections: ${collections.length}`);

  lines.push("");
  lines.push("Collections (id — title):");
  for (const c of collections) {
    lines.push(`  ${c.collectionId} — ${c.title}`);
  }

  const tagCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const prices: number[] = [];
  for (const p of products) {
    for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    if (p.productType) {
      typeCounts.set(p.productType, (typeCounts.get(p.productType) ?? 0) + 1);
    }
    if (p.priceMin) prices.push(Number(p.priceMin));
  }

  lines.push("");
  lines.push("Top tags (real catalog tags — only use these in answer.tags):");
  const sortedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  for (const [tag, count] of sortedTags) lines.push(`  ${tag} (${count})`);

  lines.push("");
  lines.push("Product types:");
  for (const [type, count] of [...typeCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`  ${type} (${count})`);
  }

  if (prices.length) {
    prices.sort((a, b) => a - b);
    const min = prices[0]!;
    const max = prices[prices.length - 1]!;
    const mid = prices[Math.floor(prices.length / 2)]!;
    lines.push("");
    lines.push(`Price range: $${min.toFixed(2)} – $${max.toFixed(2)} (median $${mid.toFixed(2)})`);
  }

  lines.push("");
  if (products.length <= FULL_LISTING_BUDGET) {
    lines.push("Products (id | title | tags):");
    for (const p of products) {
      lines.push(`  ${p.productId} | ${p.title} | ${p.tags.join(",")}`);
    }
  } else {
    lines.push(
      `Catalog exceeds ${FULL_LISTING_BUDGET} products — showing a sample per collection:`,
    );
    for (const c of collections) {
      const sample = products
        .filter((p) => p.collectionIds.includes(c.collectionId))
        .slice(0, SAMPLE_PER_BAND);
      if (sample.length === 0) continue;
      lines.push(`  ${c.title}:`);
      for (const p of sample) {
        lines.push(`    ${p.productId} | ${p.title} | ${p.tags.join(",")}`);
      }
    }
  }

  return lines.join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// Catalog intelligence (Dev Spec §2–3) — pure, no IO.
// ───────────────────────────────────────────────────────────────────────────

export interface CatalogCompleteness {
  // Overall 0–100 readiness score (weighted: tags 50%, descriptions 30%, variants 20%).
  score: number;
  tagCoverage: number; // fraction of products with ≥1 tag (0–1)
  avgDescriptionChars: number;
  avgVariants: number;
  productCount: number;
  // Human-readable gaps to surface in onboarding ("only 40% tagged", …).
  flags: string[];
}

// Score how "quiz-ready" a catalog is — tag coverage drives recommendation
// quality, description length drives AI copy quality, variant depth drives the
// result-page selector. Surfaced in onboarding so a merchant sees what to fix.
export function scoreCatalogCompleteness(products: Product[]): CatalogCompleteness {
  const n = products.length;
  if (n === 0) {
    return {
      score: 0,
      tagCoverage: 0,
      avgDescriptionChars: 0,
      avgVariants: 0,
      productCount: 0,
      flags: ["No products synced yet — connect your store to begin."],
    };
  }

  let tagged = 0;
  let descChars = 0;
  let variantTotal = 0;
  for (const p of products) {
    if (p.tags.length > 0) tagged++;
    descChars += (p.descriptionText ?? "").trim().length;
    variantTotal += Array.isArray(p.variants) ? p.variants.length : 0;
  }

  const tagCoverage = tagged / n;
  const avgDescriptionChars = Math.round(descChars / n);
  const avgVariants = variantTotal / n;

  // Sub-scores normalized to 0–1 against "healthy" thresholds.
  const tagScore = tagCoverage;
  const descScore = Math.min(1, avgDescriptionChars / 200); // ~200 chars = healthy
  const variantScore = Math.min(1, avgVariants / 2); // ≥2 variants = good depth
  const score = Math.round((tagScore * 0.5 + descScore * 0.3 + variantScore * 0.2) * 100);

  const flags: string[] = [];
  if (tagCoverage < 0.6) {
    flags.push(
      `Only ${Math.round(tagCoverage * 100)}% of products are tagged — tags drive recommendations.`,
    );
  }
  if (avgDescriptionChars < 80) {
    flags.push("Product descriptions are short — richer copy improves AI quiz content.");
  }
  if (avgVariants < 1) {
    flags.push("Few product variants detected — variant pickers will be limited.");
  }

  return { score, tagCoverage, avgDescriptionChars, avgVariants, productCount: n, flags };
}

// First ~n non-trivial product descriptions, whitespace-normalized + capped, as
// a brand-voice STYLE REFERENCE for the AI (Dev Spec §3.1 "tone sample: first 5
// product descriptions fed as style reference"). This is NOT a Claude call —
// the sample is injected into generation/edit prompts as a tone cue. Returns ""
// when no usable descriptions exist (caller simply omits the cue).
export function toneSampleFromCatalog(
  products: Product[],
  n = 5,
  maxCharsEach = 400,
): string {
  return products
    .map((p) => (p.descriptionText ?? "").replace(/\s+/g, " ").trim())
    .filter((d) => d.length >= 20)
    .slice(0, n)
    .map((d) => (d.length > maxCharsEach ? `${d.slice(0, maxCharsEach)}…` : d))
    .join("\n---\n");
}

// Dev Spec §2 Phase 4 — AI pre-selects the storefront placement by catalog
// shape. Applied as the smart default on a freshly-built quiz; the merchant can
// override it in the editor's placement picker. Pure + testable.
export type QuizPlacement = "page" | "popup" | "inline" | "product_widget";
export function suggestPlacement(productCount: number): QuizPlacement {
  if (productCount <= 3) return "product_widget"; // single hero / tiny catalog
  if (productCount >= 10) return "popup"; // broad catalog → homepage popup
  return "page"; // mid-size → dedicated quiz page
}
