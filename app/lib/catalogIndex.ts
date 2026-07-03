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

// Narrow a catalog to a chosen set of product ids — the products in those ids
// plus only the collections at least one chosen product belongs to. When the
// chosen set is empty (nothing selected yet) or resolves to ZERO catalog matches
// (stale/unsynced ids), fall back to the FULL catalog — a broad summary always
// beats an empty one. Pure; used to scope the funnel's AI grounding to the
// merchant's confirmed recommendation buckets (their chosen products) at BOTH
// generation layers: the Shape stage (quiz type/template framing, step2Build) and
// the question-flow build (the questions + answers themselves, onboardingBuild).
export function scopeCatalogToChosen(
  products: Product[],
  collections: Collection[],
  chosenProductIds: ReadonlySet<string>,
): { products: Product[]; collections: Collection[] } {
  if (chosenProductIds.size === 0) return { products, collections };
  const scopedProducts = products.filter((p) => chosenProductIds.has(p.productId));
  if (scopedProducts.length === 0) return { products, collections };
  const scopedCollections = collections.filter((c) =>
    scopedProducts.some((p) => p.collectionIds.includes(c.collectionId)),
  );
  return { products: scopedProducts, collections: scopedCollections };
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

// ───────────────────────────────────────────────────────────────────────────
// Brand Identity corpus selection (Builder Re-work Step 0). Picks WHICH products
// the identity digest reads, honoring the two merchant rules:
//   · <5 products  → WIDEN: read every description (longer cap) and flag the
//                     catalog as low-volume/educational (positioning biases to
//                     "explainer" — tiny catalogs rarely mean a product-finder).
//   · >100 products → read only the top 100 ACTIVE by revenue (the "cheat code":
//                     digest the products that matter, not the long tail). When
//                     no revenue ranking is available yet, fall back to a cheap
//                     deterministic proxy (has-image, then description richness).
//   · 5–100        → the whole catalog as-is.
// Pure + no IO — the build (P3) feeds `products` into buildScopedIndex for the
// summary and stamps `note` onto an IdentitySource.
// ───────────────────────────────────────────────────────────────────────────

export const IDENTITY_LOW_VOLUME = 5;
export const IDENTITY_MAX_CORPUS = 100;

export interface IdentityCorpus {
  products: Product[];
  toneSample: string;
  lowVolumeEducationalHint: boolean;
  note: string; // human detail for IdentitySource: "top 100 of 1,240 by revenue"
}

const isActive = (p: Product): boolean => (p.status ?? "").toUpperCase() === "ACTIVE";

// Deterministic richness proxy when revenue ranking is absent: an image is the
// strongest "this is a real, merchandised product" signal, then description depth.
const proxyScore = (p: Product): number =>
  (p.imageUrl ? 1_000_000 : 0) + (p.descriptionText ?? "").trim().length;

export function selectIdentityCorpus(
  allProducts: Product[],
  bestSellerIds?: string[],
): IdentityCorpus {
  const n = allProducts.length;

  if (n < IDENTITY_LOW_VOLUME) {
    return {
      products: allProducts,
      // Widen: every description, longer per-item cap.
      toneSample: toneSampleFromCatalog(allProducts, allProducts.length, 600),
      lowVolumeEducationalHint: true,
      note: `${n} product${n === 1 ? "" : "s"} — widened (low-volume, likely educational)`,
    };
  }

  if (n <= IDENTITY_MAX_CORPUS) {
    return {
      products: allProducts,
      toneSample: toneSampleFromCatalog(allProducts),
      lowVolumeEducationalHint: false,
      note: `${n} products`,
    };
  }

  // >100 — rank and take the top 100. Prefer active products, but never let an
  // empty/unknown-status catalog filter everything out (fall back to all).
  const active = allProducts.filter(isActive);
  const pool = active.length >= IDENTITY_MAX_CORPUS ? active : allProducts;

  let ranked: Product[];
  let basis: string;
  if (bestSellerIds && bestSellerIds.length > 0) {
    const rank = new Map(bestSellerIds.map((id, i) => [id, i]));
    ranked = [...pool].sort((a, b) => {
      const ra = rank.get(a.productId) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(b.productId) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb; // lower rank index = higher revenue
      return proxyScore(b) - proxyScore(a); // tie-break: unranked by proxy
    });
    basis = "revenue";
  } else {
    ranked = [...pool].sort((a, b) => proxyScore(b) - proxyScore(a));
    basis = "image + description richness";
  }

  const top = ranked.slice(0, IDENTITY_MAX_CORPUS);
  return {
    products: top,
    toneSample: toneSampleFromCatalog(top),
    lowVolumeEducationalHint: false,
    note: `top ${IDENTITY_MAX_CORPUS} of ${n} by ${basis}`,
  };
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
