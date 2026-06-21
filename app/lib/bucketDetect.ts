import {
  resolveGroupsBySource,
  hydrateCollectionProducts,
  type GroupingProduct,
} from "./categoryGrouping";
import { scorePartition } from "./groupingDetect";

// ════════════════════════════════════════════════════════════════════════════
// Bucket-strategy suggestion (Recommendation Buckets, Step 1) — pick the
// AI-suggested bucketing TAB for the page banner, deterministically (no AI call).
// Wraps the partition math in categoryGrouping/groupingDetect and adds a
// data-backed reason + a strong/weak signal.
//
// The three tabs are Individual Products / Tags / Collections, so this only ever
// suggests "tag", "collection", or "product" (product_type is NOT a tab and never
// wins here). STRONG = one clear winner (beats the runner-up by a margin AND
// covers ≥80% of the catalog). WEAK = two viable options (names both). Small or
// unpartitionable catalogs fall back to "product" (each product its own bucket).
// ════════════════════════════════════════════════════════════════════════════

export type BucketTab = "product" | "tag" | "collection";

export interface BucketSuggestion {
  suggestedType: BucketTab;
  strength: "strong" | "weak" | null; // null = the "individual products" fallback
  reason: string; // merchant-facing, data-backed
  secondary?: BucketTab; // the runner-up — present only on a weak signal
}

// Below this product count, individual-product buckets give the most control
// (the spec's "fewer than ~25 products → Individual Products").
const SMALL_CATALOG = 25;
const MIN_USEFUL_SCORE = 0.2; // a partition below this isn't worth suggesting
const STRONG_MARGIN = 0.15; // the winner must beat the runner-up by this…
const STRONG_COVERAGE = 0.8; // …and cover this share of the catalog
const COLLECTION_BIAS = 0.1; // a tie favors the merchant's own taxonomy (matches groupingDetect)

const TAB_LABEL: Record<BucketTab, string> = {
  product: "individual products",
  tag: "tags",
  collection: "collections",
};

export function suggestBucketStrategy(
  products: GroupingProduct[],
  collections: Array<{ collectionId: string; title: string }>,
): BucketSuggestion {
  const total = products.length;

  if (total < SMALL_CATALOG) {
    return {
      suggestedType: "product",
      strength: null,
      reason:
        total === 0
          ? "Sync your Shopify catalog, then pick the products you want to recommend."
          : `With ${total} product${total === 1 ? "" : "s"}, picking them individually gives you the most control.`,
    };
  }

  const hydrated = hydrateCollectionProducts(collections, products);
  const tagGroups = resolveGroupsBySource("tag", products, hydrated);
  const colGroups = resolveGroupsBySource("collection", products, hydrated);

  const tagCovered = products.filter((p) => p.tags.length > 0).length;
  const colCovered = products.filter((p) => p.collectionIds.length > 0).length;

  const candidates = [
    { type: "tag" as const, score: scorePartition(tagGroups, total), coverage: tagCovered / total, covered: tagCovered, groups: tagGroups.length },
    { type: "collection" as const, score: scorePartition(colGroups, total) + COLLECTION_BIAS, coverage: colCovered / total, covered: colCovered, groups: colGroups.length },
  ].sort((a, b) => b.score - a.score);

  const [top, second] = candidates;

  if (!top || top.score < MIN_USEFUL_SCORE || top.groups < 2) {
    return {
      suggestedType: "product",
      strength: null,
      reason: `Your ${total} products don't split cleanly by tags or collections, so pick the ones you want to recommend.`,
    };
  }

  const strong = top.score - (second?.score ?? 0) >= STRONG_MARGIN && top.coverage >= STRONG_COVERAGE;

  if (strong) {
    return {
      suggestedType: top.type,
      strength: "strong",
      reason:
        top.type === "tag"
          ? `${top.covered} of your ${total} products use tags consistently — tags give clean, predictable buckets.`
          : `Your ${top.groups} collections cover ${top.covered} of ${total} products — they'll make clean, predictable buckets.`,
    };
  }

  return {
    suggestedType: top.type,
    strength: "weak",
    secondary: second?.type,
    reason: `Your catalog could work with ${TAB_LABEL[top.type]} or ${TAB_LABEL[second?.type ?? "product"]}. We've defaulted to ${TAB_LABEL[top.type]} — ${top.type === "collection" ? "the way you already organize your store" : "they cover the most products"}.`,
  };
}
