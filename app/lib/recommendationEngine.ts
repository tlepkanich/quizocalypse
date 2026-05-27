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
