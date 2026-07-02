import type { TargetShape } from "./recommendDecider";

// LOGIC v2 (L2-10a) — the DRAFT-time analog of the publish bake. The decider
// engine pools EXCLUSIVELY from targetProductIdsMap (a publish-time field a
// draft lacks), so builder previews derive it from the quiz's live buckets —
// the same trick Step5Preview's bakeResultPages plays for legacy result pages.
// Member order is the bucket's stored order; publishing swaps in the true
// Shopify collection sort (the same caveat RecPageV2Preview states in-frame).
// Pure + client-safe; consumed only by preview mounts, never persisted.

export interface DraftDeciderBake {
  targetProductIdsMap: Record<string, string[]>;
  targetIndex: Record<string, { type: TargetShape; name?: string }>;
}

// Category.source values are "product" | "tag" | "collection" |
// "smart_collection" | "product_type" | "metafield" | "manual" | AI-discovery
// labels. The engine only distinguishes product (hero-only, §4.1) vs
// everything else, so unknown sources map to "collection" (the general case).
const shapeFromSource = (source: string | null | undefined): TargetShape =>
  source === "product" ? "product" : source === "tag" ? "tag" : "collection";

export function draftDeciderBake(
  categories: readonly {
    id: string;
    name: string;
    source?: string | null;
    productIds: string[];
  }[],
): DraftDeciderBake {
  const targetProductIdsMap: Record<string, string[]> = {};
  const targetIndex: Record<string, { type: TargetShape; name?: string }> = {};
  for (const c of categories) {
    targetProductIdsMap[c.id] = c.productIds;
    targetIndex[c.id] = { type: shapeFromSource(c.source), name: c.name };
  }
  return { targetProductIdsMap, targetIndex };
}
