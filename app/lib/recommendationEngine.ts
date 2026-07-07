import type { Quiz, ResultData, MatchLadderStrategy } from "./quizSchema";
import type { z } from "zod";
import {
  applyRuleAction,
  resolveTarget,
  settingsForTarget,
  targetProducts,
  type ResolvedRecPageConfig,
} from "./recommendDecider";
import {
  filterQuestions,
  narrowIdsByFilters,
  type AppliedFilter,
} from "./filterMatching";

type QuizDoc = z.infer<typeof Quiz>;
type ResultDataT = z.infer<typeof ResultData>;
type LadderStrategy = z.infer<typeof MatchLadderStrategy>;

// Slim product representation baked into the published quiz JSON.
// See Tech Spec §4.2.
export interface IndexedProduct {
  product_id: string;
  title: string;
  handle: string;
  // Spin-off: the merchant's own product URL ("Shop now" click-through) for
  // standalone shops, where there's no Shopify PDP/cart. Baked from Product.url.
  url?: string;
  price: string | null;
  image_url: string | null;
  // Short plain-text product description, baked at publish (capped) — rendered
  // on result cards when the page's show_descriptions toggle is on.
  description?: string;
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
  // LOGIC v2 (L2-2) — the baked target data (publish-time fields, like
  // product_index/answer_weights), consumed ONLY when quiz.logic_model is
  // "decider". targetProductIdsMap: targetId → ORDERED member ids (the order
  // IS the merchant's Shopify collection sort — the collection_order signal).
  // targetIndex: targetId → shape metadata. Absent on every legacy call site.
  targetProductIdsMap?: Record<string, string[]>;
  targetIndex?: Record<string, { type: "product" | "collection" | "tag"; name?: string }>;
}

// Deterministic recommendation engine. Spec §3.4.
// Layer 1: tag overlap scoring. Score = count of tag intersections between the
// selected answers' tag bag and each candidate product's tags.
// Layer 2: collection filter. Per-answer filters narrow the candidate pool.
// Tie-break: in-stock first, then price ascending.
// No generic fallback: if no rung resolves a real bucket, the result shows NO
// products (operator goal — never pad with an unrelated fallback collection).
// v3: walk the result page's match_ladder top-to-bottom. The first strategy
// whose resolved+ranked pool has ≥ min_products wins; otherwise the result is
// empty. The legacy match_strategy field is mapped onto a one-element ladder so
// pre-v3 quizzes behave identically (minus the removed generic fallback).
// Normalized per-resolution config — shared by the whole result page and
// by each multi-stage section. Lets one ladder walk serve both.
interface LadderConfig {
  match_ladder: LadderStrategy[];
  conditional_rules: { all_of: string[]; any_of: string[]; product_ids: string[] }[];
  category_id?: string;
  collection_id?: string;
  metafield_key?: string;
  metafield_value?: string;
  // Rec-Page spec §1 sub-filter — narrows the resolved pool to products that
  // ALSO carry this tag / sit in this collection (drawn from the bucket pool).
  sub_filter_tag?: string;
  sub_filter_collection_id?: string;
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

// ── Explained output (design-refinement D1) ─────────────────────────────────
// The engine's public answer to "WHY these products": every rung's pool is
// ordered by the shopper's answers, and the explained shape carries the
// evidence. recommendForResult delegates to the explained variant — ONE code
// path, so the Logic UI's trace can never drift from what shoppers see.

export interface ExplainedProduct extends RecommendedProduct {
  /** Product tags hit by this path's tag bag (may be empty on fixed rungs). */
  matched_tags: string[];
}

// "decider"/"decider_rule" are the LOGIC v2 resolution mechanisms (direct
// mapping vs an AND-rule override) — only ever produced for decider docs.
export type ResolvedRung = LadderStrategy | "fallback" | "decider" | "decider_rule";

export interface ExplainedRecommendation {
  /** Final capped order — exactly what recommendForResult returns. */
  products: ExplainedProduct[];
  rungUsed: ResolvedRung | null;
  /** Winning pool size after OOS handling, BEFORE the cap slice. */
  poolSize: number;
  /** applyOos "fallback" swapped the rung's pool for the OOS collection. */
  oosSwapped: boolean;
  /** tag → effective weight from the selected answers (Phase J aware). */
  tagBag: Record<string, number>;
  /** LOGIC v2 — present ONLY when the doc is a decider doc. Hands the runtime
   *  the ONE authoritative resolution (target + config + hero/grid split +
   *  the §5 all-OOS flag targetProducts computes) so no consumer duplicates
   *  resolveTarget/settingsForTarget. Absent on every legacy path. */
  decider?: {
    targetId: string;
    matchedRuleId: string | null;
    config: ResolvedRecPageConfig;
    hero: ExplainedProduct | null;
    grid: ExplainedProduct[];
    allOutOfStock: boolean;
    // QZY-1 (quiz-logic spec §3/§8) — which filter questions narrowed the
    // pool on this path, and whether they narrowed it to ZERO (the empty
    // case §9 fallback owns). Absent on docs with no filter-role questions.
    filters?: {
      applied: AppliedFilter[];
      zeroAfterFilters: boolean;
    };
  };
}

// The shopper's tag bag: tag → best contributing answer's weight (Phase J),
// plus any per-answer collection filters. Extracted from the old scoreAndRank
// so EVERY rung can use it.
function buildTagBag(
  quiz: QuizDoc,
  selectedAnswerIds: string[],
  answerWeights?: Record<string, number>,
): { tagWeight: Map<string, number>; collectionFilters: Set<string> } {
  const selectedAnswerSet = new Set(selectedAnswerIds);
  const tagWeight = new Map<string, number>();
  const collectionFilters = new Set<string>();
  for (const node of quiz.nodes) {
    if (node.type !== "question") continue;
    for (const answer of node.data.answers) {
      if (!selectedAnswerSet.has(answer.id)) continue;
      const w = answerWeights?.[answer.id] ?? 1;
      for (const tag of answer.tags) {
        // Case-insensitive: Shopify product tags are authored with inconsistent
        // case ("Acne" vs "acne"), so an answer tag must match regardless of
        // case or it silently scores nothing. Keys are lowercased here and at
        // every lookup; the product's original-case tag is preserved for display.
        const key = tag.toLowerCase();
        tagWeight.set(key, Math.max(tagWeight.get(key) ?? 0, w));
      }
      if (answer.collection_filter) collectionFilters.add(answer.collection_filter);
    }
  }
  return { tagWeight, collectionFilters };
}

// Score a rung's candidate pool by the path's tag bag. CRUCIALLY keeps
// score-0 items — for fixed rungs (category/points/conditional/collection/
// metafield) the pool IS the eligibility; answers decide ORDER, never
// membership. Zero-overlap pools fall through to rank()'s in-stock → price
// tie-break, which is byte-identical to the pre-D1 uniform-score order.
function scorePool(
  pool: IndexedProduct[],
  tagWeight: Map<string, number>,
): ExplainedProduct[] {
  return pool.map((p) => ({
    ...p,
    // Case-insensitive lookup (tagWeight keys are lowercased in buildTagBag);
    // matched_tags keeps the product's original-case tag for display.
    score: p.tags.reduce((acc, t) => acc + (tagWeight.get(t.toLowerCase()) ?? 0), 0),
    matched_tags: p.tags.filter((t) => tagWeight.has(t.toLowerCase())),
  }));
}

function walkLadder(
  config: LadderConfig,
  quiz: QuizDoc,
  allProducts: IndexedProduct[],
  selectedAnswerIds: string[],
  categoryMap: Record<string, string[]>,
  answerWeights?: Record<string, number>,
): ExplainedRecommendation {
  // Never surface non-sellable junk, regardless of which strategy (category /
  // tag / points / conditional / collection / fallback) resolves it.
  const productIndex = allProducts.filter(isSellable);
  const selectedSet = new Set(selectedAnswerIds);
  const { tagWeight, collectionFilters } = buildTagBag(
    quiz,
    selectedAnswerIds,
    answerWeights,
  );
  const tagBag = Object.fromEntries(tagWeight);

  const byId = (ids: string[]): IndexedProduct[] => {
    const want = new Set(ids);
    return productIndex.filter((p) => want.has(p.product_id));
  };

  // Rungs resolve ELIGIBILITY (raw candidate pools). Ordering happens once,
  // below, for every rung alike.
  const resolve = (strategy: LadderStrategy): IndexedProduct[] => {
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
        return col ? productIndex.filter((p) => p.collection_ids.includes(col)) : [];
      }
      case "metafield": {
        const k = config.metafield_key;
        const v = config.metafield_value;
        return k && v ? productIndex.filter((p) => p.metafields?.[k] === v) : [];
      }
      case "tag":
      default: {
        // The tag rung's >0 filter IS its eligibility semantics: only
        // products the path's answers point at qualify at all.
        const eligible =
          collectionFilters.size === 0
            ? productIndex
            : productIndex.filter((p) =>
                p.collection_ids.some((c) => collectionFilters.has(c)),
              );
        return eligible.filter((p) => p.tags.some((t) => tagWeight.has(t.toLowerCase())));
      }
    }
  };

  // Rec-Page spec §1 sub-filter: narrow a resolved pool to products that ALSO
  // match the section's tag / collection. Tag match is case-insensitive (like
  // the scoring lookups). Both empty → pool unchanged. When both are set, a
  // product must satisfy BOTH (intersection).
  const subFilter = (pool: IndexedProduct[]): IndexedProduct[] => {
    const tag = config.sub_filter_tag?.toLowerCase();
    const col = config.sub_filter_collection_id;
    if (!tag && !col) return pool;
    return pool.filter((p) => {
      const tagOk = !tag || p.tags.some((t) => t.toLowerCase() === tag);
      const colOk = !col || p.collection_ids.includes(col);
      return tagOk && colOk;
    });
  };

  const empty: ExplainedRecommendation = {
    products: [],
    rungUsed: null,
    poolSize: 0,
    oosSwapped: false,
    tagBag,
  };

  // D1 contract (unchanged): each rung resolves ELIGIBILITY (membership); the
  // shopper's answers decide ORDER. A bound bucket the answers routed to IS the
  // match for that outcome, so we keep score-0 members and let ranking surface
  // the best-fit first (caps then trim the off-fit tail).
  for (const strategy of config.match_ladder) {
    const scored = scorePool(subFilter(resolve(strategy)), tagWeight);
    const { products: pool, swapped } = applyOos(
      applyRanking(scored, config.ranking),
      { oos_behavior: config.oos_behavior, oos_fallback_collection_id: config.oos_fallback_collection_id },
      productIndex,
      tagWeight,
    );
    if (pool.length >= config.minProducts) {
      return {
        products: pool.slice(0, config.cap),
        rungUsed: strategy,
        poolSize: pool.length,
        oosSwapped: swapped,
        tagBag,
      };
    }
  }

  // No generic fallback collection. If no ladder rung resolves a real bucket,
  // show NO products rather than padding the result with an unrelated fallback
  // collection — operator goal: "if there are no products that fit the answers,
  // then no results should be given." The result page renders a graceful "no
  // match" state instead. (config.fallback_collection_id is intentionally ignored.)
  return empty;
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

// The rich variant: products + WHY (rung used, matched tags, the path's tag
// bag). Powers the Logic view's trace; recommendForResult delegates so the
// two can never disagree.
export function recommendForResultExplained(
  input: RecommendationInput,
  // Optional cap override. Pass a larger value to fetch a deeper ranked pool
  // (primary recs + extra candidates) for deriving secondary "you might also
  // like" picks from a single coherent ladder pass.
  capOverride?: number,
): ExplainedRecommendation {
  const { quiz, productIndex, selectedAnswerIds, resultNodeId, answerWeights } = input;

  const resultNode = quiz.nodes.find(
    (n) => n.id === resultNodeId && n.type === "result",
  );
  if (!resultNode || resultNode.type !== "result") {
    return { products: [], rungUsed: null, poolSize: 0, oosSwapped: false, tagBag: {} };
  }

  // ── LOGIC v2 dispatch (L2-2) ──────────────────────────────────────────────
  // Decider docs resolve ONE target (rules → the deciding answer's mapping)
  // and rank WITHIN it by real signals — no tag scoring, no ladder. Gated on a
  // field NO legacy doc possesses, so every existing quiz takes the walkLadder
  // path below verbatim. capOverride doesn't apply (gridMax caps the grid;
  // there is no "deeper pool" concept in the 1:1 model).
  if (quiz.logic_model === "decider") {
    const resolved = resolveTarget(selectedAnswerIds, quiz);
    if (!resolved) {
      // No rule matched + no decider answer mapping → the rec-page fallback
      // layer owns what renders (§6). Impossible post-validation (V1/V2).
      return { products: [], rungUsed: null, poolSize: 0, oosSwapped: false, tagBag: {} };
    }
    const config = settingsForTarget(quiz.rec_page_settings, resolved.targetId);
    // The same junk filter walkLadder applies (L2-9 review): $0+OOS
    // placeholders never surface. Real OOS items keep their price and stay —
    // the §5 OOS handling governs them.
    const sellable = productIndex.filter(isSellable);
    // ── QZY-1 — the "Filters results" stage (rules → decider → FILTERS →
    // fallback). Path-aware by construction: only the shopper's selected
    // answers on filter-role questions narrow the target's pool; no legacy
    // doc carries the role, so pre-QZY docs resolve byte-identically.
    const baseIds = input.targetProductIdsMap?.[resolved.targetId] ?? [];
    const hasFilters = filterQuestions(quiz).length > 0;
    const narrowed = hasFilters
      ? narrowIdsByFilters(
          baseIds,
          new Map(sellable.map((p) => [p.product_id, p])),
          quiz,
          selectedAnswerIds,
        )
      : null;
    // ── QZY-1 — pipeline order per spec: rules(action) run on the pool the
    // base mapping + filters produced. Only the FIRST matching rule fired
    // (resolveTarget); an action-less rule already replaced the target above.
    let poolIds =
      narrowed && narrowed.applied.length > 0 ? narrowed.ids : baseIds;
    if (resolved.ruleAction && resolved.ruleTargetId) {
      poolIds = applyRuleAction(
        poolIds,
        input.targetProductIdsMap?.[resolved.ruleTargetId] ?? [],
        resolved.ruleAction,
      );
    }
    const poolAdjusted =
      poolIds !== baseIds ||
      (narrowed !== null && narrowed.applied.length > 0) ||
      Boolean(resolved.ruleAction);
    const split = targetProducts({
      targetId: resolved.targetId,
      targetShape: input.targetIndex?.[resolved.targetId]?.type,
      config,
      productIndex: sellable,
      targetProductIdsMap: poolAdjusted
        ? { ...(input.targetProductIdsMap ?? {}), [resolved.targetId]: poolIds }
        : (input.targetProductIdsMap ?? {}),
    });
    const asExplained = (p: IndexedProduct): ExplainedProduct => ({
      ...p,
      score: 0,
      matched_tags: [],
    });
    const ordered = split.hero ? [split.hero, ...split.grid] : split.grid;
    return {
      products: ordered.map(asExplained),
      rungUsed: resolved.matchedRuleId ? "decider_rule" : "decider",
      poolSize: split.poolSize,
      oosSwapped: false,
      tagBag: {},
      decider: {
        targetId: resolved.targetId,
        matchedRuleId: resolved.matchedRuleId,
        config,
        hero: split.hero ? asExplained(split.hero) : null,
        grid: split.grid.map(asExplained),
        allOutOfStock: split.allOutOfStock,
        ...(narrowed
          ? {
              filters: {
                applied: narrowed.applied,
                zeroAfterFilters: narrowed.zeroAfterFilters,
              },
            }
          : {}),
      },
    };
  }
  // ──────────────────────────────────────────────────────────────────────────

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
      sub_filter_tag: data.sub_filter_tag,
      sub_filter_collection_id: data.sub_filter_collection_id,
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

export function recommendForResult(
  input: RecommendationInput,
  capOverride?: number,
): RecommendedProduct[] {
  return recommendForResultExplained(input, capOverride).products;
}

// Rec-Page spec §7 — the quiz-level GLOBAL FALLBACK (no-bucket-match). This is
// SEPARATE from bucket matching: the engine still returns NO products when a
// bucket's answers don't fit (the "no fit → empty" rule holds for the match,
// per [[recs-binding-is-the-match]]). When the merchant OPTS IN
// (global_fallback.enabled, default off → behavior unchanged), the runtime
// renders these as a distinct "Our most-loved products" section beneath an
// empty result. Best-seller sorted (spec: not configurable), capped to `count`.
// Answer-independent — a true "everything else failed" safety net.
export function resolveGlobalFallbackProducts(
  gf: QuizDoc["global_fallback"] | undefined,
  productIndex: IndexedProduct[],
): RecommendedProduct[] {
  if (!gf?.enabled) return [];
  const idx = productIndex.filter(isSellable);
  let pool: IndexedProduct[];
  // QZY-1 (quiz-logic spec §9) — an explicit mode wins. best_sellers = the
  // whole sellable catalog, best-seller ranked below ("always populated —
  // safe default"). Absent mode keeps the legacy field inference exactly.
  if (gf.mode === "best_sellers") {
    pool = idx;
  } else if (gf.mode === "collection") {
    if (!gf.collection_id) return [];
    pool = idx.filter((p) => p.collection_ids.includes(gf.collection_id!));
  } else if (gf.mode === "featured") {
    if (!gf.product_ids.length) return [];
    const want = new Set(gf.product_ids);
    pool = idx.filter((p) => want.has(p.product_id));
  } else if (gf.collection_id) {
    pool = idx.filter((p) => p.collection_ids.includes(gf.collection_id!));
  } else if (gf.tag) {
    const t = gf.tag.toLowerCase();
    pool = idx.filter((p) => p.tags.some((x) => x.toLowerCase() === t));
  } else if (gf.product_ids.length) {
    const want = new Set(gf.product_ids);
    pool = idx.filter((p) => want.has(p.product_id));
  } else {
    return [];
  }
  // No answer scoring — best-seller order per the spec (not configurable here).
  const scored = scorePool(pool, new Map());
  return applyRanking(scored, "best_seller").slice(0, gf.count);
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
  // No inventory guard here: the pool already reflects the result's oos_behavior
  // (applyOos drops OOS under `hide`, keeps them under `show_with_badge`). Filtering
  // OOS out again would empty the "you might also like" row even though the primary
  // list shows the same badge-eligible OOS products.
  return pool
    .filter((p) => !shown.has(p.product_id))
    .sort((a, b) => overlapRatio(a) - overlapRatio(b))
    .slice(0, max);
}

// Resolve one multi-stage section's products. Stages don't carry the
// node's final fallback collection — an empty stage simply renders empty.
export function recommendForStageExplained(
  quiz: QuizDoc,
  productIndex: IndexedProduct[],
  selectedAnswerIds: string[],
  resultNodeId: string,
  stage: ResultDataT["stages"][number],
  answerWeights?: Record<string, number>,
): ExplainedRecommendation {
  const resultPage = quiz.results_pages.find((r) => r.id === resultNodeId);
  return walkLadder(
    {
      match_ladder: stage.match_ladder as LadderStrategy[],
      conditional_rules: stage.conditional_rules,
      category_id: stage.category_id,
      collection_id: stage.collection_id,
      metafield_key: stage.metafield_key,
      metafield_value: stage.metafield_value,
      sub_filter_tag: stage.sub_filter_tag,
      sub_filter_collection_id: stage.sub_filter_collection_id,
      ranking: stage.ranking,
      cap: stage.max_products,
      minProducts: stage.min_products,
      oos_behavior: "show_with_badge",
    },
    quiz,
    productIndex,
    selectedAnswerIds,
    categoryMapFor(resultPage),
    answerWeights,
  );
}

export function recommendForStage(
  quiz: QuizDoc,
  productIndex: IndexedProduct[],
  selectedAnswerIds: string[],
  resultNodeId: string,
  stage: ResultDataT["stages"][number],
  answerWeights?: Record<string, number>,
): RecommendedProduct[] {
  return recommendForStageExplained(
    quiz,
    productIndex,
    selectedAnswerIds,
    resultNodeId,
    stage,
    answerWeights,
  ).products;
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
// we re-sort by the requested key; JS sort is stable, so the answer-scored
// base order survives as the tie-break — explicit merchant ranking wins,
// answer-scoring is the default. Generic so ExplainedProduct flows through.
function applyRanking<T extends RecommendedProduct>(
  products: T[],
  ranking: ResultDataT["ranking"],
): T[] {
  const base = rank(products);
  if (ranking === "relevance") return base;
  // "manual" respects the resolved pool's own order (a collection's Shopify
  // sort, or catalog order otherwise). We re-rank on top of `base` only by the
  // in-stock → price tie-break that every mode shares, but keep score order
  // out of it — there is no merchant order baked per-collection today, so the
  // resolved pool order IS the manual order. (Data gap flagged in the spec
  // pass: per-collection position isn't baked yet.)
  if (ranking === "manual") return [...products];
  if (ranking === "newest") {
    return [...base].sort((a, b) => {
      const ta = a.updated_at ? Date.parse(a.updated_at) : 0;
      const tb = b.updated_at ? Date.parse(b.updated_at) : 0;
      return tb - ta;
    });
  }
  // Price / title sorts read the baked price/title. JS sort is stable, so the
  // answer-scored base order survives as the tie-break (e.g. equal-price items
  // keep best-fit-first). Null/empty prices sort last.
  if (ranking === "price_asc" || ranking === "price_desc") {
    const dir = ranking === "price_asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const pa = a.price != null && a.price !== "" ? Number(a.price) : null;
      const pb = b.price != null && b.price !== "" ? Number(b.price) : null;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return (pa - pb) * dir;
    });
  }
  if (ranking === "title_az" || ranking === "title_za") {
    const dir = ranking === "title_az" ? 1 : -1;
    return [...base].sort(
      (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) * dir,
    );
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
// in the OOS fallback collection (scored by the path's tag bag, like every
// other pool). Reports the swap so the explained API can surface it.
function applyOos(
  products: ExplainedProduct[],
  cfg: { oos_behavior: ResultDataT["oos_behavior"]; oos_fallback_collection_id?: string },
  productIndex: IndexedProduct[],
  tagWeight: Map<string, number>,
): { products: ExplainedProduct[]; swapped: boolean } {
  // show_with_badge + notify_me both KEEP out-of-stock products visible; the
  // storefront card decides how to render them (badge vs "Notify Me" capture).
  if (cfg.oos_behavior === "show_with_badge" || cfg.oos_behavior === "notify_me") {
    return { products, swapped: false };
  }
  const inStock = products.filter((p) => p.inventory_in_stock);
  if (cfg.oos_behavior === "hide") return { products: inStock, swapped: false };
  // fallback: everything's OOS → swap in the merchant's OOS fallback collection
  // (a deliberate binding), scored by the path's tag bag like every other pool.
  if (inStock.length > 0) return { products: inStock, swapped: false };
  if (cfg.oos_fallback_collection_id) {
    const swap = scorePool(
      productIndex.filter((p) =>
        p.collection_ids.includes(cfg.oos_fallback_collection_id!),
      ),
      tagWeight,
    );
    return { products: rank(swap), swapped: swap.length > 0 };
  }
  return { products: inStock, swapped: false };
}

export interface PreviewRecommendationInput {
  quiz: QuizDoc;
  productIndex: IndexedProduct[];
  selectedAnswerIds: string[];
  slotCount?: number;
}

// NOTE (history): the quiz-level "global fallback" (legacy Rec-Page spec §7) was
// originally NOT implemented ("no fit → no products"), then OWNER-APPROVED and
// shipped via resolveGlobalFallbackProducts above (60fa80c/516b7a7) — it fires
// only when global_fallback.enabled is explicitly set. LOGIC v2 decider docs use
// their own §6 fallback chain (emptyFallback/safetyNetCol) instead.

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
  const { tagWeight, collectionFilters } = buildTagBag(
    quiz,
    selectedAnswerIds,
    answerWeights,
  );
  const eligible =
    collectionFilters.size === 0
      ? productIndex
      : productIndex.filter((p) =>
          p.collection_ids.some((c) => collectionFilters.has(c)),
        );
  return rank(scorePool(eligible, tagWeight).filter((p) => p.score > 0));
}

function rank<T extends RecommendedProduct>(products: T[]): T[] {
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

  if (data.mode === "points") {
    // Plurality routing: send the shopper to the slot bound to the category
    // that WINS the per-answer points tally (argmax over the whole path). This
    // is the counterpart to a result page's `points` ladder, so the page the
    // shopper lands on always matches the products that page resolves — and,
    // unlike a first-match-priority tag union, every outcome stays reachable in
    // proportion to how often it was picked (a tag offered on every question no
    // longer wins by mere presence). Ties resolve via pickPointsWinner's own
    // first-seen rule (earliest-picked among the tied leaders).
    const winner = pickPointsWinner(quiz, [...ctx.selectedAnswerIds]);
    if (winner) {
      for (const slot of data.slots) {
        const edge = quiz.edges.find(
          (e) => e.source === branchNodeId && e.source_handle === slot.id,
        );
        if (edge?.condition?.points_category === winner) return slot.id;
      }
    }
    // Nothing scored (or the winner has no slot) → first unconditioned slot
    // (the author's catch-all), else the first slot.
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
