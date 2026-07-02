import type { z } from "zod";
import type {
  Quiz,
  DecisionRule,
  RecPageGlobal,
  RecPageSettings,
} from "./quizSchema";
import type { IndexedProduct } from "./recommendationEngine";

type QuizDoc = z.infer<typeof Quiz>;
type DecisionRuleT = z.infer<typeof DecisionRule>;
type RecPageGlobalT = z.infer<typeof RecPageGlobal>;
type RecPageSettingsT = z.infer<typeof RecPageSettings>;

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 engine (quiz-questions-logic-spec §2 + quiz-recommendation-page-
// spec-V2 §4/§5) — the one-decider model's PURE resolution core.
//
// A shopper's result is ONE resolved target (a Step-1 Category: an individual
// product, a collection, or a tag bucket), produced by exactly two mechanisms
// in order: (1) the first AND-rule whose conditions all match (priority =
// array order, evaluation stops); (2) the deciding question's direct answer→
// target mapping. There is NO per-product relevance score — hero/grid rank the
// resolved target's own products by real signals (collection_order default |
// bestseller | reviewed | newest).
//
// Everything here is pure + deterministic; only docs with logic_model ===
// "decider" ever reach it (the dispatch in recommendationEngine.ts). Legacy
// docs take walkLadder verbatim.
// ════════════════════════════════════════════════════════════════════════════

export type TargetShape = "product" | "collection" | "tag";

export interface ResolvedTarget {
  targetId: string;
  /** The rule that overrode the direct mapping, or null when the deciding
   *  answer's own mapping produced the target. */
  matchedRuleId: string | null;
}

/** Rec-page-spec-V2 §3.1 — the spec defaults, applied at READ time so stored
 *  docs stay sparse (only merchant-set fields are persisted). */
export const REC_PAGE_DEFAULTS: Required<
  Pick<
    RecPageGlobalT,
    | "headline"
    | "whyOn"
    | "whyCopy"
    | "heroLogic"
    | "showDesc"
    | "heroOos"
    | "gridMax"
    | "gridSort"
    | "incentiveOn"
    | "incentiveAutoApply"
    | "incentivePos"
    | "emptyFallback"
  >
> = {
  headline: "Your perfect match",
  whyOn: true,
  whyCopy:
    "Based on your quiz answers, we matched you with products tailored to your specific needs.",
  heroLogic: "collection_order",
  showDesc: true,
  heroOos: "next",
  gridMax: 3,
  gridSort: "collection_order",
  incentiveOn: false,
  incentiveAutoApply: true,
  incentivePos: "banner",
  emptyFallback: "collection",
};

export type ResolvedRecPageConfig = RecPageGlobalT & typeof REC_PAGE_DEFAULTS;

/** The global config with spec defaults filled in. */
export function resolveRecPageGlobal(
  settings: RecPageSettingsT | undefined,
): ResolvedRecPageConfig {
  return { ...REC_PAGE_DEFAULTS, ...(settings?.global ?? {}) };
}

/** The effective config for ONE target: global + its sparse override
 *  (override-wins; absent override fields inherit global — §2.2/§3.2). */
export function settingsForTarget(
  settings: RecPageSettingsT | undefined,
  targetId: string,
): ResolvedRecPageConfig {
  const global = resolveRecPageGlobal(settings);
  const override = settings?.overrides?.[targetId];
  if (!override) return global;
  // Only copy PRESENT override fields — an explicit undefined must not shadow.
  const sparse: Partial<RecPageGlobalT> = {};
  for (const [k, v] of Object.entries(override)) {
    if (v !== undefined) (sparse as Record<string, unknown>)[k] = v;
  }
  return { ...global, ...sparse };
}

/** Spec §2 — resolve the shopper's ONE target: rules top→bottom (first full
 *  AND-match wins), else the deciding answer's direct mapping, else null
 *  (→ the rec-page fallback layer; §2 "if neither produces a result").
 *
 *  Condition semantics: op "is" = the answer id IS among the shopper's
 *  selections; "is_not" = it is NOT (an unanswered/skipped question satisfies
 *  "is_not" — the shopper's answer is not X because there is no answer).
 *  A rule with zero conditions is half-built (V9) and never fires. */
export function resolveTarget(
  selectedAnswerIds: readonly string[],
  doc: Pick<QuizDoc, "nodes" | "decision_rules">,
): ResolvedTarget | null {
  const selected = new Set(selectedAnswerIds);

  for (const rule of doc.decision_rules ?? []) {
    if (rule.conditions.length === 0) continue; // half-built — never fires (V9)
    if (ruleMatches(rule, selected)) {
      return { targetId: rule.target_id, matchedRuleId: rule.id };
    }
  }

  const decider = doc.nodes.find(
    (n) => n.type === "question" && n.data.role === "decides",
  );
  if (!decider || decider.type !== "question") return null;
  const picked = decider.data.answers.find(
    (a) => selected.has(a.id) && a.target_id,
  );
  if (!picked?.target_id) return null;
  return { targetId: picked.target_id, matchedRuleId: null };
}

function ruleMatches(rule: DecisionRuleT, selected: ReadonlySet<string>): boolean {
  return rule.conditions.every((c) =>
    c.op === "is" ? selected.has(c.answer_id) : !selected.has(c.answer_id),
  );
}

// ── Target → products (§4 hero & grid, §5 OOS) ─────────────────────────────

export interface TargetProductsInput {
  targetId: string;
  /** The target's shape (from the baked target_index). Individual products are
   *  hero-only — no ranking, no grid (§4.1). Unknown → treated as collection. */
  targetShape?: TargetShape;
  /** The effective (override-merged) config for this target. */
  config: ResolvedRecPageConfig;
  productIndex: readonly IndexedProduct[];
  /** targetId → ORDERED member product ids (baked at publish; the order IS
   *  the merchant's Shopify collection sort — the collection_order signal). */
  targetProductIdsMap: Record<string, string[]>;
}

export interface TargetProducts {
  hero: IndexedProduct | null;
  grid: IndexedProduct[];
  /** Target membership size (before stock filtering / caps). 0 = the empty-
   *  result fallback case (§6) — the caller renders emptyFallback/safetyNet. */
  poolSize: number;
  /** True when the whole target (or an individual product) is out of stock —
   *  the runtime renders OOS badges + disabled Add-to-Cart (§5). */
  allOutOfStock: boolean;
}

const inStock = (p: IndexedProduct): boolean => p.inventory_in_stock !== false;

/** Order a pool by a hero/grid signal. collection_order keeps the baked map
 *  order (the merchant's own Shopify sort — the manual lever, §4.2); signals
 *  with missing data silently fall back to collection_order (§11.2). */
export function orderBySignal(
  pool: readonly IndexedProduct[],
  signal: ResolvedRecPageConfig["heroLogic"],
): IndexedProduct[] {
  if (signal === "collection_order") return [...pool];
  if (signal === "newest") {
    const hasData = pool.some((p) => p.updated_at);
    if (!hasData) return [...pool];
    return [...pool].sort((a, b) => {
      const ta = a.updated_at ? Date.parse(a.updated_at) : 0;
      const tb = b.updated_at ? Date.parse(b.updated_at) : 0;
      return tb - ta;
    });
  }
  // bestseller / reviewed read the merchant-mapped metafield ranks (the same
  // convention the legacy engine's applyRanking uses).
  const key = signal === "bestseller" ? "__rank_bestseller" : "__rank_rating";
  const hasData = pool.some((p) => p.metafields?.[key] !== undefined);
  if (!hasData) return [...pool];
  return [...pool].sort(
    (a, b) => Number(b.metafields?.[key] ?? 0) - Number(a.metafields?.[key] ?? 0),
  );
}

/** §4/§5 — split the resolved target's products into hero + grid.
 *  1. Filter to in-stock, then apply the hero signal to what remains (an OOS
 *     "hero" is never chosen while an in-stock product exists).
 *  2. Entire target OOS → heroOos: "next" shows the best product OOS-badged;
 *     "grid" skips the hero and shows only the (badged) grid.
 *  3. Individual-product targets are hero-only — no grid, no ranking; an OOS
 *     product still shows, badged (§5 "no next product exists to promote").
 *  Grid: remaining products ordered by gridSort, capped at gridMax; never
 *  padded with unrelated products (§11.2). */
export function targetProducts(input: TargetProductsInput): TargetProducts {
  const { targetId, targetShape, config, productIndex, targetProductIdsMap } = input;
  const byId = new Map(productIndex.map((p) => [p.product_id, p]));
  // Map order is preserved — it IS the collection_order signal.
  const pool = (targetProductIdsMap[targetId] ?? [])
    .map((id) => byId.get(id))
    .filter((p): p is IndexedProduct => p !== undefined);

  if (pool.length === 0) {
    return { hero: null, grid: [], poolSize: 0, allOutOfStock: false };
  }

  if (targetShape === "product") {
    const hero = pool[0]!;
    return { hero, grid: [], poolSize: pool.length, allOutOfStock: !inStock(hero) };
  }

  const stocked = pool.filter(inStock);

  if (stocked.length > 0) {
    const hero = orderBySignal(stocked, config.heroLogic)[0]!;
    const rest = stocked.filter((p) => p.product_id !== hero.product_id);
    const grid = orderBySignal(rest, config.gridSort).slice(0, config.gridMax);
    return { hero, grid, poolSize: pool.length, allOutOfStock: false };
  }

  // Entire target out of stock (§5.3).
  if (config.heroOos === "grid") {
    const grid = orderBySignal(pool, config.gridSort).slice(0, config.gridMax);
    return { hero: null, grid, poolSize: pool.length, allOutOfStock: true };
  }
  const hero = orderBySignal(pool, config.heroLogic)[0]!;
  const rest = pool.filter((p) => p.product_id !== hero.product_id);
  const grid = orderBySignal(rest, config.gridSort).slice(0, config.gridMax);
  return { hero, grid, poolSize: pool.length, allOutOfStock: true };
}
