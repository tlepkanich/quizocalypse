import {
  resolveGroupsBySource,
  hydrateCollectionProducts,
  type GroupingProduct,
  type ProposedGroup,
} from "./categoryGrouping";

// ════════════════════════════════════════════════════════════════════════════
// Grouping detection (Step 1 S1) — pick the DEFAULT grouping dimension for the
// "here's how we see your products grouped" screen, deterministically (no AI).
//
//  · <5 products → "all": recommend from the whole catalog (no buckets).
//  · else: score each candidate dimension (collection / tag / product_type) by
//    partition quality — buckets in the 3–8 sweet spot, coverage, and balance —
//    with a default-bias toward the merchant's OWN Collections. A tag/type
//    dimension only wins when it partitions meaningfully better (e.g. the whole
//    catalog sits in one giant collection but has clean product types).
//
// This is the "AI detects a better mechanism" requirement satisfied by partition
// math — faster, free, and deterministic for live-verify. The heavy AI-archetype
// path (discoverAndPersistBuckets) stays opt-in, not the default.
// ════════════════════════════════════════════════════════════════════════════

export type GroupingDimension = "collection" | "tag" | "product_type" | "all";

const ALL_THRESHOLD = 5; // < this → recommend from the whole catalog
const COLLECTION_BIAS = 0.1; // tie/near-tie favors the merchant's taxonomy
const MIN_USEFUL_SCORE = 0.2; // below this, fall back to "all"

export interface DetectResult {
  dimension: GroupingDimension;
  rationale: string; // merchant-facing one-liner
  proposed: ProposedGroup[]; // resolved groups ready to confirm as cards ([] for "all")
}

// Partition quality in [0,1]: coverage (most products land somewhere) + a
// bucket-count sweet spot + balance (no single bucket dominates, few singletons).
export function scorePartition(groups: ProposedGroup[], total: number): number {
  if (total === 0 || groups.length < 2) return 0;
  const sizes = groups.map((g) => g.productIds.length).filter((n) => n > 0);
  if (sizes.length < 2) return 0;

  const covered = new Set(groups.flatMap((g) => g.productIds)).size;
  const coverage = covered / total;

  const count = sizes.length;
  const countScore =
    count >= 3 && count <= 8 ? 1 : count === 2 ? 0.6 : count <= 12 ? 0.5 : 0.25;

  const maxShare = Math.max(...sizes) / total;
  // 1.0 while the biggest bucket is ≤60% of the catalog, →0 as it approaches 100%.
  const balance = 1 - Math.max(0, maxShare - 0.6) / 0.4;

  const singletonShare = sizes.filter((n) => n === 1).length / count;
  const singletonPenalty = 1 - singletonShare * 0.5;

  return coverage * 0.4 + countScore * 0.3 + balance * 0.2 + singletonPenalty * 0.1;
}

function rationaleFor(dim: GroupingDimension, count: number): string {
  switch (dim) {
    case "collection":
      return `We grouped your catalog by your ${count} collection${count === 1 ? "" : "s"} — the way you already organize it.`;
    case "tag":
      return `Your products group most cleanly by ${count} tags.`;
    case "product_type":
      return `We grouped by your ${count} product types.`;
    case "all":
      return "Your catalog is small, so we'll recommend from all of your products.";
  }
}

export function detectGroupingDimension(
  products: GroupingProduct[],
  collections: Array<{ collectionId: string; title: string }>,
): DetectResult {
  if (products.length < ALL_THRESHOLD) {
    return { dimension: "all", rationale: rationaleFor("all", 0), proposed: [] };
  }

  const total = products.length;
  const hydrated = hydrateCollectionProducts(collections, products);
  const sources: Array<{ dim: GroupingDimension; bias: number; groups: ProposedGroup[] }> = [
    { dim: "collection", bias: COLLECTION_BIAS, groups: resolveGroupsBySource("collection", products, hydrated) },
    { dim: "tag", bias: 0, groups: resolveGroupsBySource("tag", products, hydrated) },
    { dim: "product_type", bias: 0, groups: resolveGroupsBySource("product_type", products, hydrated) },
  ];
  const candidates = sources.map((c) => ({
    dim: c.dim,
    groups: c.groups,
    score: scorePartition(c.groups, total) + c.bias,
  }));

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < MIN_USEFUL_SCORE || best.groups.length < 2) {
    return { dimension: "all", rationale: rationaleFor("all", 0), proposed: [] };
  }
  return {
    dimension: best.dim,
    rationale: rationaleFor(best.dim, best.groups.length),
    proposed: best.groups,
  };
}
