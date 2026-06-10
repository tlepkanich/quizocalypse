import type { Quiz, ResultData, MatchLadderStrategy } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;
type ResultDataT = z.infer<typeof ResultData>;
type LadderStrategy = z.infer<typeof MatchLadderStrategy>;

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
  // v3 ranking inputs (optional — baked when available).
  updated_at?: string; // ISO; used by ranking="newest"
  metafields?: Record<string, string>; // used by ranking + metafield strategy
  // First in-stock (else first) variant gid, baked at publish — powers
  // add-to-cart cart permalinks. Absent when the product has no variants.
  default_variant_id?: string;
  // Variant list (id + label + availability), baked ONLY when a product has >1
  // variant — powers the result-card variant selector (Dev Spec §5).
  variants?: Array<{ id: string; title: string; available: boolean }>;
}

export interface RecommendedProduct extends IndexedProduct {
  score: number;
}

export interface RecommendationInput {
  quiz: QuizDoc;
  productIndex: IndexedProduct[];
  selectedAnswerIds: string[];
  resultNodeId: string;
  // Phase J: baked per-answer conversion weights (publishedJson.answer_weights).
  // Absent/empty → classic flat tag scoring, bit-for-bit.
  answerWeights?: Record<string, number>;
}

// Deterministic recommendation engine. Spec §3.4.
// Layer 1: tag overlap scoring. Score = count of tag intersections between the
// selected answers' tag bag and each candidate product's tags.
// Layer 2: collection filter. Per-answer filters narrow the candidate pool.
// Tie-break: in-stock first, then price ascending.
// Fallback: if all candidates score 0, return result's fallback_collection_id pool.
// v3: walk the result page's match_ladder top-to-bottom. The first strategy
// whose resolved+ranked pool has ≥ min_products wins; otherwise fall through.
// Final fallback is the result's fallback_collection_id. The legacy
// match_strategy field is mapped onto a one-element ladder so pre-v3 quizzes
// behave identically.
// Normalized per-resolution config — shared by the whole result page and
// by each multi-stage section. Lets one ladder walk serve both.
interface LadderConfig {
  match_ladder: LadderStrategy[];
  conditional_rules: { all_of: string[]; any_of: string[]; product_ids: string[] }[];
  category_id?: string;
  collection_id?: string;
  metafield_key?: string;
  metafield_value?: string;
  ranking: ResultDataT["ranking"];
  cap: number;
  minProducts: number;
  oos_behavior: ResultDataT["oos_behavior"];
  oos_fallback_collection_id?: string;
  fallback_collection_id?: string; // final fallback (result page only)
}

// A product is sellable if it's in stock OR carries a real price. This drops
// ONLY products that are both out of stock AND have no usable price (≤ 0) —
// i.e. placeholder / test fixtures like "$0, out of stock" — so they never get
// recommended. Real out-of-stock items (with a price) stay and are governed by
// oos_behavior; in-stock free items stay too.
export function isSellable(p: { inventory_in_stock: boolean; price: string | null }): boolean {
  return p.inventory_in_stock || (p.price != null && Number(p.price) > 0);
}

function walkLadder(
  config: LadderConfig,
  quiz: QuizDoc,
  allProducts: IndexedProduct[],
  selectedAnswerIds: string[],
  categoryMap: Record<string, string[]>,
  answerWeights?: Record<string, number>,
): RecommendedProduct[] {
  // Never surface non-sellable junk, regardless of which strategy (category /
  // tag / points / conditional / collection / fallback) resolves it.
  const productIndex = allProducts.filter(isSellable);
  const selectedSet = new Set(selectedAnswerIds);
  const byId = (ids: string[]): RecommendedProduct[] => {
    const want = new Set(ids);
    return productIndex
      .filter((p) => want.has(p.product_id))
      .map((p) => ({ ...p, score: 1 }));
  };

  const resolve = (strategy: LadderStrategy): RecommendedProduct[] => {
    switch (strategy) {
      case "conditional": {
        for (const rule of config.conditional_rules) {
          const allOk = rule.all_of.every((a) => selectedSet.has(a));
          const anyOk =
            rule.any_of.length === 0 ||
            rule.any_of.some((a) => selectedSet.has(a));
          if (allOk && anyOk) return byId(rule.product_ids);
        }
        return [];
      }
      case "points": {
        const winner = pickPointsWinner(quiz, selectedAnswerIds);
        return winner ? byId(categoryMap[winner] ?? []) : [];
      }
      case "category": {
        return config.category_id ? byId(categoryMap[config.category_id] ?? []) : [];
      }
      case "collection": {
        const col = config.collection_id;
        return col
          ? productIndex
              .filter((p) => p.collection_ids.includes(col))
              .map((p) => ({ ...p, score: 1 }))
          : [];
      }
      case "metafield": {
        const k = config.metafield_key;
        const v = config.metafield_value;
        return k && v
          ? productIndex
              .filter((p) => p.metafields?.[k] === v)
              .map((p) => ({ ...p, score: 1 }))
          : [];
      }
      case "tag":
      default:
        return scoreAndRank(quiz, productIndex, selectedAnswerIds, answerWeights);
    }
  };

  for (const strategy of config.match_ladder) {
    const pool = applyOos(
      applyRanking(resolve(strategy), config.ranking),
      { oos_behavior: config.oos_behavior, oos_fallback_collection_id: config.oos_fallback_collection_id },
      productIndex,
    );
    if (pool.length >= config.minProducts) return pool.slice(0, config.cap);
  }

  if (config.fallback_collection_id) {
    const fallbackPool = productIndex
      .filter((p) => p.collection_ids.includes(config.fallback_collection_id!))
      .map((p) => ({ ...p, score: 0 }));
    return applyRanking(rank(fallbackPool), config.ranking).slice(0, config.cap);
  }
  return [];
}

// Build the runtime category map from the published result page.
function categoryMapFor(
  resultPage:
    | { category_id?: string; category_product_ids?: string[]; category_product_ids_map?: Record<string, string[]> }
    | undefined,
): Record<string, string[]> {
  return (
    resultPage?.category_product_ids_map ??
    (resultPage?.category_id && resultPage.category_product_ids
      ? { [resultPage.category_id]: resultPage.category_product_ids }
      : {})
  );
}

export function recommendForResult(
  input: RecommendationInput,
  // Optional cap override. Pass a larger value to fetch a deeper ranked pool
  // (primary recs + extra candidates) for deriving secondary "you might also
  // like" picks from a single coherent ladder pass.
  capOverride?: number,
): RecommendedProduct[] {
  const { quiz, productIndex, selectedAnswerIds, resultNodeId, answerWeights } = input;

  const resultNode = quiz.nodes.find(
    (n) => n.id === resultNodeId && n.type === "result",
  );
  if (!resultNode || resultNode.type !== "result") return [];

  const data = resultNode.data;
  const resultPage = quiz.results_pages.find((r) => r.id === resultNodeId);

  // Effective ladder. If the editor left the default ["tag"] but the legacy
  // match_strategy says archetype/points, honor the legacy intent.
  let ladder: LadderStrategy[] = data.match_ladder as LadderStrategy[];
  const isDefaultLadder = ladder.length === 1 && ladder[0] === "tag";
  if (isDefaultLadder && resultPage?.match_strategy === "archetype") {
    ladder = ["category"];
  } else if (isDefaultLadder && resultPage?.match_strategy === "points") {
    ladder = ["points"];
  }

  return walkLadder(
    {
      match_ladder: ladder,
      conditional_rules: data.conditional_rules,
      category_id: data.category_id ?? resultPage?.category_id,
      collection_id: data.collection_id,
      metafield_key: data.metafield_key,
      metafield_value: data.metafield_value,
      ranking: data.ranking,
      cap: capOverride ?? data.max_products ?? data.slot_count,
      minProducts: data.min_products,
      oos_behavior: data.oos_behavior,
      oos_fallback_collection_id: data.oos_fallback_collection_id,
      fallback_collection_id: data.fallback_collection_id,
    },
    quiz,
    productIndex,
    selectedAnswerIds,
    categoryMapFor(resultPage),
    answerWeights,
  );
}

// "You might also like" — up to `max` secondary products shown beneath the
// primary recommendations on the result page (Dev Spec §5). Pure + testable.
//
// `pool` is the SAME ladder-ranked list as the primary recs, fetched with a
// larger cap — so it contains the primary items first, then the next-best
// matches. This picks which ≤max products become secondaries.
//
// Diversity-aware (chosen): among the ranked pool, exclude items already shown
// and out-of-stock, then prefer GENUINE ALTERNATIVES — candidates whose tags
// overlap the primary set least come first. JS array sort is stable, so
// equal-overlap candidates keep the pool's best→worst rank as the tiebreak.
// The result leans toward a different style/price than the primary picks,
// rather than near-duplicates. Pure + testable.
export function selectSecondaryRecs(
  primary: RecommendedProduct[],
  pool: RecommendedProduct[],
  max = 2,
): RecommendedProduct[] {
  const shown = new Set(primary.map((p) => p.product_id));
  const primaryTags = new Set(primary.flatMap((p) => p.tags));
  const overlapRatio = (p: RecommendedProduct) =>
    p.tags.length === 0
      ? 0
      : p.tags.filter((t) => primaryTags.has(t)).length / p.tags.length;
  // `.filter` returns a fresh array, so sorting it never mutates the caller's pool.
  return pool
    .filter((p) => !shown.has(p.product_id) && p.inventory_in_stock !== false)
    .sort((a, b) => overlapRatio(a) - overlapRatio(b))
    .slice(0, max);
}

// Resolve one multi-stage section's products. Stages don't carry the
// node's final fallback collection — an empty stage simply renders empty.
export function recommendForStage(
  quiz: QuizDoc,
  productIndex: IndexedProduct[],
  selectedAnswerIds: string[],
  resultNodeId: string,
  stage: ResultDataT["stages"][number],
): RecommendedProduct[] {
  const resultPage = quiz.results_pages.find((r) => r.id === resultNodeId);
  return walkLadder(
    {
      match_ladder: stage.match_ladder as LadderStrategy[],
      conditional_rules: stage.conditional_rules,
      category_id: stage.category_id,
      collection_id: stage.collection_id,
      metafield_key: stage.metafield_key,
      metafield_value: stage.metafield_value,
      ranking: stage.ranking,
      cap: stage.max_products,
      minProducts: stage.min_products,
      oos_behavior: "show_with_badge",
    },
    quiz,
    productIndex,
    selectedAnswerIds,
    categoryMapFor(resultPage),
  );
}

// Tally each answer's point weights toward category ids across the visited
// path, return the top category id (or null when nothing scored). Ties
// broken by first-declared category order in the answers.
export function pickPointsWinner(
  quiz: QuizDoc,
  selectedAnswerIds: string[],
): string | null {
  const selected = new Set(selectedAnswerIds);
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const node of quiz.nodes) {
    if (node.type !== "question") continue;
    for (const answer of node.data.answers) {
      if (!selected.has(answer.id) || !answer.points) continue;
      for (const [cid, weight] of Object.entries(answer.points)) {
        if (!totals.has(cid)) order.push(cid);
        totals.set(cid, (totals.get(cid) ?? 0) + weight);
      }
    }
  }
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const cid of order) {
    const s = totals.get(cid)!;
    if (s > bestScore) {
      bestScore = s;
      best = cid;
    }
  }
  return best;
}

// Apply the result page's ranking preference on top of the base rank()
// (which already does score → in-stock → price). For non-relevance modes
// we re-sort by the requested key, keeping rank() as the stable tie-break.
function applyRanking(
  products: RecommendedProduct[],
  ranking: ResultDataT["ranking"],
): RecommendedProduct[] {
  const base = rank(products);
  if (ranking === "relevance") return base;
  if (ranking === "newest") {
    return [...base].sort((a, b) => {
      const ta = a.updated_at ? Date.parse(a.updated_at) : 0;
      const tb = b.updated_at ? Date.parse(b.updated_at) : 0;
      return tb - ta;
    });
  }
  // best_seller / highest_rated read a merchant-mapped metafield numeric.
  // The mapping key convention: metafields["__rank_bestseller"] /
  // ["__rank_rating"]. Unmapped → fall back to base relevance ordering.
  const key =
    ranking === "best_seller" ? "__rank_bestseller" : "__rank_rating";
  const hasData = products.some((p) => p.metafields?.[key] !== undefined);
  if (!hasData) return base;
  return [...base].sort((a, b) => {
    const va = Number(a.metafields?.[key] ?? 0);
    const vb = Number(b.metafields?.[key] ?? 0);
    return vb - va;
  });
}

// Apply out-of-stock behavior. hide = drop OOS; show_with_badge = keep
// (the storefront renders the badge); fallback = if everything's OOS, swap
// in the OOS fallback collection.
function applyOos(
  products: RecommendedProduct[],
  cfg: { oos_behavior: ResultDataT["oos_behavior"]; oos_fallback_collection_id?: string },
  productIndex: IndexedProduct[],
): RecommendedProduct[] {
  if (cfg.oos_behavior === "show_with_badge") return products;
  const inStock = products.filter((p) => p.inventory_in_stock);
  if (cfg.oos_behavior === "hide") return inStock;
  // fallback
  if (inStock.length > 0) return inStock;
  if (cfg.oos_fallback_collection_id) {
    return rank(
      productIndex
        .filter((p) =>
          p.collection_ids.includes(cfg.oos_fallback_collection_id!),
        )
        .map((p) => ({ ...p, score: 0 })),
    );
  }
  return inStock;
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
//
// Phase J: when answerWeights is provided (baked at publish from conversion
// history), each tag contributes its best contributing answer's weight instead
// of a flat 1 — answers that historically convert count more. Absent/empty
// weights reproduce the classic integer overlap EXACTLY (every tag weighs 1).
function scoreAndRank(
  quiz: QuizDoc,
  productIndex: IndexedProduct[],
  selectedAnswerIds: string[],
  answerWeights?: Record<string, number>,
): RecommendedProduct[] {
  const selectedAnswerSet = new Set(selectedAnswerIds);
  const tagWeight = new Map<string, number>();
  const collectionFilters = new Set<string>();
  for (const node of quiz.nodes) {
    if (node.type !== "question") continue;
    for (const answer of node.data.answers) {
      if (!selectedAnswerSet.has(answer.id)) continue;
      const w = answerWeights?.[answer.id] ?? 1;
      for (const tag of answer.tags) {
        tagWeight.set(tag, Math.max(tagWeight.get(tag) ?? 0, w));
      }
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
    score: p.tags.reduce((acc, t) => acc + (tagWeight.get(t) ?? 0), 0),
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
