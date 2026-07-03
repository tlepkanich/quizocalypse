import {
  resolveGroupsBySource,
  hydrateCollectionProducts,
  type GroupingProduct,
} from "./categoryGrouping";
import { scorePartition } from "./groupingDetect";
import { normalizeTags } from "./enrichTags";

// ════════════════════════════════════════════════════════════════════════════
// Bucket-strategy suggestion (Recommendations, Step 1) — pick the AI-suggested
// recommendation TYPE for the page banner, deterministically (no AI call).
// Wraps the partition math in categoryGrouping/groupingDetect and adds a
// data-backed reason + a strong/weak signal.
//
// Step-1 spec (quiz-step1-recommendations-spec §4): the banner is an ACTION,
// not advice — it must always name a concrete, one-click-applicable set. So
// beyond the suggested tab, this now emits `apply` (the exact keys "Use this"
// selects), an action `message`, and a `why` line with real catalog counts.
// Heuristic (a build-time decision per the spec): prefer collections when ≥2
// non-trivial collections exist; prefer tags when tagging is rich and
// collections are thin; fall back to a curated product set.
//
// The three tabs are Individual Products / Tags / Collections, so this only
// ever suggests "tag", "collection", or "product" (product_type is NOT a tab
// and never wins here). STRONG = one clear winner (beats the runner-up by a
// margin AND covers ≥80% of the catalog). WEAK = two viable options (names
// both). Small or unpartitionable catalogs fall back to "product".
// ════════════════════════════════════════════════════════════════════════════

export type BucketTab = "product" | "tag" | "collection";

export interface BucketApplySet {
  type: BucketTab;
  keys: string[]; // browser identities (product ids / normalized tag keys / collection ids)
  names: string[]; // parallel display names, for the optimistic client render
}

export interface BucketSuggestion {
  suggestedType: BucketTab;
  strength: "strong" | "weak" | null; // null = the "individual products" fallback
  reason: string; // merchant-facing, data-backed
  secondary?: BucketTab; // the runner-up — present only on a weak signal
  // §4 auto-apply — the concrete set "Use this" selects. Null only when the
  // catalog is empty (nothing sane to propose).
  apply: BucketApplySet | null;
  message: string; // the banner's action line ("Use your 4 collections — …")
  why: string; // the why-line with real catalog numbers
  counts: { products: number; collections: number; tags: number };
}

// Below this product count, individual-product buckets give the most control
// (the spec's "fewer than ~25 products → Individual Products").
const SMALL_CATALOG = 25;
const MIN_USEFUL_SCORE = 0.2; // a partition below this isn't worth suggesting
const STRONG_MARGIN = 0.15; // the winner must beat the runner-up by this…
const STRONG_COVERAGE = 0.8; // …and cover this share of the catalog
const COLLECTION_BIAS = 0.1; // a tie favors the merchant's own taxonomy (matches groupingDetect)
// Caps on the auto-applied set: a quiz with dozens of outcomes is unbuildable,
// so the one-click set proposes the biggest N groups (or a curated product
// handful). The merchant can always add more by hand.
const MAX_APPLY_GROUPS = 8;
const MAX_APPLY_PRODUCTS = 6;

const TAB_LABEL: Record<BucketTab, string> = {
  product: "individual products",
  tag: "tags",
  collection: "collections",
};

function applyFromGroups(
  type: "tag" | "collection",
  groups: Array<{ name: string; productIds: string[]; sourceRef?: string }>,
): BucketApplySet | null {
  const usable = groups
    .filter((g) => g.sourceRef && g.productIds.length > 0)
    .sort((a, b) => b.productIds.length - a.productIds.length)
    .slice(0, MAX_APPLY_GROUPS);
  if (usable.length < 2) return null;
  return {
    type,
    keys: usable.map((g) => g.sourceRef as string),
    names: usable.map((g) => g.name),
  };
}

function applyFromProducts(products: GroupingProduct[]): BucketApplySet | null {
  if (products.length === 0) return null;
  const picked = products.slice(0, MAX_APPLY_PRODUCTS);
  return {
    type: "product",
    keys: picked.map((p) => p.productId),
    names: picked.map((p) => p.title),
  };
}

function whyLine(counts: { products: number; collections: number; tags: number }): string {
  return `Your catalog has ${counts.products} product${counts.products === 1 ? "" : "s"} across ${counts.collections} collection${counts.collections === 1 ? "" : "s"} and ${counts.tags} tag${counts.tags === 1 ? "" : "s"}.`;
}

function messageFor(apply: BucketApplySet | null): string {
  if (!apply) return "Sync your catalog to get a one-click recommendation.";
  const n = apply.keys.length;
  if (apply.type === "collection")
    return `Use your ${n} collection${n === 1 ? "" : "s"} — they match how you already organize your store.`;
  if (apply.type === "tag")
    return `Use your top ${n} tag${n === 1 ? "" : "s"} — they cover most of your catalog.`;
  return `Start with ${n} hand-picked product${n === 1 ? "" : "s"} — adjust the set any time.`;
}

export function suggestBucketStrategy(
  products: GroupingProduct[],
  collections: Array<{ collectionId: string; title: string }>,
): BucketSuggestion {
  const total = products.length;

  const hydrated = hydrateCollectionProducts(collections, products);
  const tagGroups = resolveGroupsBySource("tag", products, hydrated);
  const colGroups = resolveGroupsBySource("collection", products, hydrated);
  const counts = {
    products: total,
    collections: colGroups.filter((g) => g.productIds.length > 0).length,
    // The TRUE distinct-tag count (review-caught: tagGroups is capped at
    // TOP_TAG_LIMIT, which understated the why-line vs the Tags tab count on
    // the same screen — the spec requires REAL catalog numbers).
    tags: new Set(products.flatMap((p) => normalizeTags(p.tags, new Set()))).size,
  };
  const why = whyLine(counts);

  const withAction = (
    base: Omit<BucketSuggestion, "apply" | "message" | "why" | "counts">,
    apply: BucketApplySet | null,
  ): BucketSuggestion => ({ ...base, apply, message: messageFor(apply), why, counts });

  if (total < SMALL_CATALOG) {
    return withAction(
      {
        suggestedType: "product",
        strength: null,
        reason:
          total === 0
            ? "Sync your Shopify catalog, then pick the products you want to recommend."
            : `With ${total} product${total === 1 ? "" : "s"}, picking them individually gives you the most control.`,
      },
      applyFromProducts(products),
    );
  }

  const tagCovered = products.filter((p) => p.tags.length > 0).length;
  const colCovered = products.filter((p) => p.collectionIds.length > 0).length;

  const candidates = [
    { type: "tag" as const, score: scorePartition(tagGroups, total), coverage: tagCovered / total, covered: tagCovered, groups: tagGroups.length },
    { type: "collection" as const, score: scorePartition(colGroups, total) + COLLECTION_BIAS, coverage: colCovered / total, covered: colCovered, groups: colGroups.length },
  ].sort((a, b) => b.score - a.score);

  const [top, second] = candidates;

  if (!top || top.score < MIN_USEFUL_SCORE || top.groups < 2) {
    return withAction(
      {
        suggestedType: "product",
        strength: null,
        reason: `Your ${total} products don't split cleanly by tags or collections, so pick the ones you want to recommend.`,
      },
      applyFromProducts(products),
    );
  }

  const strong = top.score - (second?.score ?? 0) >= STRONG_MARGIN && top.coverage >= STRONG_COVERAGE;
  // The winner's concrete set; if it degenerates (<2 usable groups) fall back
  // to the runner-up's, then to curated products — the banner NEVER proposes
  // an unapplyable set.
  const winnerApply =
    applyFromGroups(top.type, top.type === "tag" ? tagGroups : colGroups) ??
    (second ? applyFromGroups(second.type, second.type === "tag" ? tagGroups : colGroups) : null) ??
    applyFromProducts(products);

  if (strong) {
    return withAction(
      {
        suggestedType: top.type,
        strength: "strong",
        reason:
          top.type === "tag"
            ? `${top.covered} of your ${total} products use tags consistently — tags give clean, predictable groups.`
            : `Your ${top.groups} collections cover ${top.covered} of ${total} products — they'll make clean, predictable groups.`,
      },
      winnerApply,
    );
  }

  return withAction(
    {
      suggestedType: top.type,
      strength: "weak",
      secondary: second?.type,
      reason: `Your catalog could work with ${TAB_LABEL[top.type]} or ${TAB_LABEL[second?.type ?? "product"]}. We've defaulted to ${TAB_LABEL[top.type]} — ${top.type === "collection" ? "the way you already organize your store" : "they cover the most products"}.`,
    },
    winnerApply,
  );
}
