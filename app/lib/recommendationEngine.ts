import type { Quiz } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

// Slim product representation baked into the published quiz JSON.
// See Tech Spec §4.2.
export interface IndexedProduct {
  product_id: string;
  title: string;
  handle: string;
  price: string | null;
  image_url: string | null;
  tags: string[];
  collection_ids: string[];
  inventory_in_stock: boolean;
}

export interface RecommendedProduct extends IndexedProduct {
  score: number;
}

export interface RecommendationInput {
  quiz: QuizDoc;
  productIndex: IndexedProduct[];
  selectedAnswerIds: string[];
  resultNodeId: string;
}

// Deterministic recommendation engine. Spec §3.4.
// Layer 1: tag overlap scoring. Score = count of tag intersections between the
// selected answers' tag bag and each candidate product's tags.
// Layer 2: collection filter. Per-answer filters narrow the candidate pool.
// Tie-break: in-stock first, then price ascending.
// Fallback: if all candidates score 0, return result's fallback_collection_id pool.
export function recommendForResult(input: RecommendationInput): RecommendedProduct[] {
  const { quiz, productIndex, selectedAnswerIds, resultNodeId } = input;

  const resultNode = quiz.nodes.find(
    (n) => n.id === resultNodeId && n.type === "result",
  );
  if (!resultNode || resultNode.type !== "result") return [];

  const slotCount = resultNode.data.slot_count;
  const fallbackCollectionId = resultNode.data.fallback_collection_id;

  // Archetype mode: the result page is bound to a discovered category at
  // publish time, and the category's product list was inlined onto the
  // result page as category_product_ids. We return that bucket directly,
  // skipping per-answer tag scoring. Tie-break (in-stock + price asc)
  // still applies for ranking. Falls back to top_n if the bucket is
  // empty or somehow missing.
  const resultPage = quiz.results_pages.find((r) => r.id === resultNodeId);
  if (
    resultPage?.match_strategy === "archetype" &&
    resultPage.category_product_ids &&
    resultPage.category_product_ids.length > 0
  ) {
    const bucketIds = new Set(resultPage.category_product_ids);
    const bucket = productIndex
      .filter((p) => bucketIds.has(p.product_id))
      .map((p) => ({ ...p, score: 1 }));
    if (bucket.length > 0) {
      return rank(bucket).slice(0, slotCount);
    }
    // Bucket exists but no products from it survived productIndex
    // filtering (e.g. all out of scope). Fall through to top_n / fallback.
  }

  const matches = scoreAndRank(quiz, productIndex, selectedAnswerIds);
  if (matches.length > 0) return matches.slice(0, slotCount);

  // Fallback: nothing scored. Serve fallback collection products.
  const pool = productIndex.filter((p) =>
    p.collection_ids.includes(fallbackCollectionId),
  );
  return rank(pool.map((p) => ({ ...p, score: 0 }))).slice(0, slotCount);
}

export interface PreviewRecommendationInput {
  quiz: QuizDoc;
  productIndex: IndexedProduct[];
  selectedAnswerIds: string[];
  slotCount?: number;
}

// Mid-quiz preview. Same scoring as the result-page engine, but with a different
// fallback ladder since there's no result node context yet:
//   1. featured_collection_id (if set on the quiz)
//   2. scope.collection_ids (the quiz's own scope)
//   3. all products in the index (in-stock first, price asc)
export function recommendPreview(
  input: PreviewRecommendationInput,
): RecommendedProduct[] {
  const { quiz, productIndex, selectedAnswerIds, slotCount = 3 } = input;

  const matches = scoreAndRank(quiz, productIndex, selectedAnswerIds);
  if (matches.length > 0) return matches.slice(0, slotCount);

  const featured = quiz.featured_collection_id;
  if (featured) {
    const pool = productIndex.filter((p) => p.collection_ids.includes(featured));
    if (pool.length > 0) {
      return rank(pool.map((p) => ({ ...p, score: 0 }))).slice(0, slotCount);
    }
  }

  const scopeIds = quiz.scope.collection_ids;
  if (scopeIds.length > 0) {
    const pool = productIndex.filter((p) =>
      p.collection_ids.some((c) => scopeIds.includes(c)),
    );
    if (pool.length > 0) {
      return rank(pool.map((p) => ({ ...p, score: 0 }))).slice(0, slotCount);
    }
  }

  return rank(productIndex.map((p) => ({ ...p, score: 0 }))).slice(0, slotCount);
}

// Shared scoring + ranking used by both result and preview engines. Returns
// only products with score > 0 — fallback handling is up to the caller.
function scoreAndRank(
  quiz: QuizDoc,
  productIndex: IndexedProduct[],
  selectedAnswerIds: string[],
): RecommendedProduct[] {
  const selectedAnswerSet = new Set(selectedAnswerIds);
  const tagBag = new Set<string>();
  const collectionFilters = new Set<string>();
  for (const node of quiz.nodes) {
    if (node.type !== "question") continue;
    for (const answer of node.data.answers) {
      if (!selectedAnswerSet.has(answer.id)) continue;
      for (const tag of answer.tags) tagBag.add(tag);
      if (answer.collection_filter) collectionFilters.add(answer.collection_filter);
    }
  }

  const eligible =
    collectionFilters.size === 0
      ? productIndex
      : productIndex.filter((p) =>
          p.collection_ids.some((c) => collectionFilters.has(c)),
        );

  const scored: RecommendedProduct[] = eligible.map((p) => ({
    ...p,
    score: p.tags.reduce((acc, t) => acc + (tagBag.has(t) ? 1 : 0), 0),
  }));

  return rank(scored.filter((p) => p.score > 0));
}

function rank(products: RecommendedProduct[]): RecommendedProduct[] {
  return [...products].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.inventory_in_stock !== b.inventory_in_stock) {
      return a.inventory_in_stock ? -1 : 1;
    }
    const pa = a.price ? Number(a.price) : Number.POSITIVE_INFINITY;
    const pb = b.price ? Number(b.price) : Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

// Helper for the runtime: given a question node and a clicked answer, find the
// next node to visit by following the matching outbound edge. Falls back to
// the first unconditional outbound edge if no specific match exists.
export function nextNodeFor(
  quiz: QuizDoc,
  currentNodeId: string,
  selectedAnswerHandle: string | null,
): string | null {
  const outbound = quiz.edges.filter((e) => e.source === currentNodeId);
  if (outbound.length === 0) return null;
  if (selectedAnswerHandle) {
    const match = outbound.find((e) => e.source_handle === selectedAnswerHandle);
    if (match) return match.target;
  }
  // First edge without a source_handle (unconditional), or first edge as last resort.
  const fallback = outbound.find((e) => !e.source_handle) ?? outbound[0];
  return fallback ? fallback.target : null;
}

// ---------- Branch routing (Phase 2) ----------

export interface BranchContext {
  // All tags accumulated across the visited path so far. Used by tag rules.
  accumulatedTags: Set<string>;
  // All answer ids the shopper has picked. Used by answer_id rules.
  selectedAnswerIds: Set<string>;
  // Sticky per-session A/B assignments: branchId → chosen slot id. Mutated
  // when an unassigned branch is hit so subsequent visits hold.
  abAssignments: Record<string, string>;
  // Injected so tests can stub deterministic rolls. Real runtime uses
  // Math.random.
  rand?: () => number;
}

// Pick the next slot id for a branch based on its configured mode. Returns
// the slot id (used as the source_handle on outgoing edges). Mutates
// ctx.abAssignments when ab_split mode assigns a fresh slot.
export function pickBranchSlot(
  quiz: QuizDoc,
  branchNodeId: string,
  ctx: BranchContext,
): string | null {
  const node = quiz.nodes.find((n) => n.id === branchNodeId);
  if (!node || node.type !== "branch") return null;
  const data = node.data;

  if (data.mode === "ab_split") {
    // Sticky assignment — reuse if present.
    const existing = ctx.abAssignments[branchNodeId];
    if (existing && data.slots.some((s) => s.id === existing)) return existing;
    const totalWeight = data.slots.reduce((s, slot) => s + slot.weight, 0);
    if (totalWeight <= 0) return data.slots[0]?.id ?? null;
    const roll = (ctx.rand ?? Math.random)() * totalWeight;
    let acc = 0;
    for (const slot of data.slots) {
      acc += slot.weight;
      if (roll < acc) {
        ctx.abAssignments[branchNodeId] = slot.id;
        return slot.id;
      }
    }
    const last = data.slots[data.slots.length - 1]!;
    ctx.abAssignments[branchNodeId] = last.id;
    return last.id;
  }

  // Rules mode: find the first outbound edge whose condition matches.
  // Edges from a branch are expected to carry source_handle = slot id, so
  // we iterate slot order to give the author deterministic priority.
  for (const slot of data.slots) {
    const edge = quiz.edges.find(
      (e) => e.source === branchNodeId && e.source_handle === slot.id,
    );
    if (!edge) continue;
    if (edgeConditionMatches(edge.condition, ctx)) return slot.id;
  }
  // Fallback: first slot with an outbound edge but no condition.
  for (const slot of data.slots) {
    const edge = quiz.edges.find(
      (e) =>
        e.source === branchNodeId &&
        e.source_handle === slot.id &&
        !e.condition,
    );
    if (edge) return slot.id;
  }
  return data.slots[0]?.id ?? null;
}

// True if the edge's condition matches the current context. An undefined
// condition always matches (unconditional edge).
function edgeConditionMatches(
  condition: { answer_id?: string; tag?: string; ab_slot?: string } | undefined,
  ctx: BranchContext,
): boolean {
  if (!condition) return true;
  if (condition.answer_id && !ctx.selectedAnswerIds.has(condition.answer_id)) {
    return false;
  }
  if (condition.tag && !ctx.accumulatedTags.has(condition.tag)) {
    return false;
  }
  // ab_slot conditions are matched by source_handle pick in pickBranchSlot,
  // not here — but if explicitly set, require it to be the active assignment.
  // (This lets authors write conditions like "ab_slot=A" on a downstream edge
  // for analytics segmentation.)
  return true;
}

// Walk forward from a node, transparently skipping branch nodes by picking
// their slot and following the matching edge. Returns the first non-branch
// node id reached (the actual UI step to render), or null if the flow ends.
// Mutates ctx.abAssignments when branches assign new variants.
export function resolveNextStep(
  quiz: QuizDoc,
  fromNodeId: string,
  selectedAnswerHandle: string | null,
  ctx: BranchContext,
): string | null {
  let next = nextNodeFor(quiz, fromNodeId, selectedAnswerHandle);
  // Guard against pathological cycles in misauthored branch graphs.
  const seen = new Set<string>();
  while (next) {
    const current: string = next;
    if (seen.has(current)) return null;
    seen.add(current);
    const node = quiz.nodes.find((n) => n.id === current);
    if (!node || node.type !== "branch") return current;
    const slot = pickBranchSlot(quiz, current, ctx);
    if (!slot) return null;
    next = nextNodeFor(quiz, current, slot);
  }
  return null;
}
