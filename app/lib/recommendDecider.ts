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
  // QZY-1 (quiz-logic spec §6.1) — when the winning rule carries a LIST
  // action (show / hide / prioritize), the base mapping still resolves the
  // target above and the action post-processes the ranked pool against the
  // rule's own target. Absent/null = the legacy replace-target rule.
  ruleAction?: "show" | "hide" | "prioritize" | null;
  ruleTargetId?: string | null;
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
    | "captureEmail"
    | "captureName"
    | "capturePhone"
    | "captureTermsOn"
    | "showPrice"
    | "showAtc"
    | "showAddAll"
    | "fallbackOn"
    | "showStars"
    | "showPerWhy"
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
  // §7.1 — email capture default-ON (mandatory when on); name/phone opt-in.
  captureEmail: true,
  captureName: false,
  capturePhone: false,
  // QZY-3 — the terms consent checkbox is opt-in. (captureHeadline/Subtext/
  // TermsText deliberately have NO defaults here — absent falls through to
  // the locale-aware chrome copy so translations keep working.)
  captureTermsOn: false,
  // QZY-5 — step-4 reveal toggles. Each default EQUALS the pre-QZY rendering
  // (price + ATC always showed; no add-all bar; fallback always rendered), so
  // published decider docs are unchanged. layout/imgFit/cardAspect/cardRadius
  // are deliberately NOT defaulted — absent means "today's exact markup".
  showPrice: true,
  showAtc: true,
  showAddAll: false,
  fallbackOn: true,
  // Results-page redesign — the Trust pair defaults OFF: existing published
  // decider docs render exactly as before until a merchant opts in.
  showStars: false,
  showPerWhy: false,
};

// ── Results-page redesign — displayable review stars ─────────────────────────
// Reads the BAKED product metafields for a real review rating; renders nothing
// when absent. Accepts the common Shopify reviews-app keys (`reviews.rating`
// arrives either as a bare number string or as the metafield JSON
// `{"value":"4.8","scale_max":"5"}`) plus bare `rating`/`rating_count`.
// Never invents a value — FTC fake-reviews exposure (strategy doc §D).
export function productRating(
  p: Pick<IndexedProduct, "metafields">,
): { value: number; count?: number } | null {
  const meta = p.metafields;
  if (!meta) return null;
  const raw = meta["reviews.rating"] ?? meta["rating"];
  if (!raw) return null;
  let value = Number(raw);
  if (!Number.isFinite(value)) {
    try {
      const parsed = JSON.parse(raw) as { value?: unknown };
      value = Number(parsed?.value);
    } catch {
      return null;
    }
  }
  if (!Number.isFinite(value) || value <= 0 || value > 5) return null;
  const rawCount = meta["reviews.rating_count"] ?? meta["rating_count"];
  const count = rawCount != null ? Number(rawCount) : NaN;
  return Number.isFinite(count) && count > 0
    ? { value, count: Math.round(count) }
    : { value };
}

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

  // First matching rule wins and evaluation stops (spec §6 precedence) —
  // whether it replaces the target (legacy, no action) or post-processes the
  // list (QZY-1 show/hide/prioritize).
  let actionRule: DecisionRuleT | null = null;
  for (const rule of doc.decision_rules ?? []) {
    if (rule.conditions.length === 0) continue; // half-built — never fires (V9)
    if (!ruleMatches(rule, selected)) continue;
    if (!rule.action) {
      return { targetId: rule.target_id, matchedRuleId: rule.id };
    }
    actionRule = rule;
    break;
  }

  const decider = doc.nodes.find(
    (n) => n.type === "question" && n.data.role === "decides",
  );
  const picked =
    decider && decider.type === "question"
      ? decider.data.answers.find((a) => selected.has(a.id) && a.target_id)
      : undefined;
  const baseTargetId = picked?.target_id ?? null;

  if (actionRule) {
    if (baseTargetId) {
      return {
        targetId: baseTargetId,
        matchedRuleId: actionRule.id,
        ruleAction: actionRule.action ?? null,
        ruleTargetId: actionRule.target_id,
      };
    }
    // No base mapping to act on: show/prioritize degrade to the rule's own
    // target (something must render); a bare hide has nothing to hide from.
    if (actionRule.action === "hide") return null;
    return { targetId: actionRule.target_id, matchedRuleId: actionRule.id };
  }

  if (!baseTargetId) return null;
  return { targetId: baseTargetId, matchedRuleId: null };
}

/** QZY-1 (spec §6.1) — apply the winning rule's list action to the resolved
 *  ordered id pool. `ruleMemberIds` are the rule target's baked members.
 *    show       → ensure the members are present (missing ones append, in
 *                 their own baked order — they were not ranked by the pool).
 *    hide       → remove the members from the pool.
 *    prioritize → stable-move members already in the pool to the front.
 *  Pure; order of untouched ids is preserved. */
export function applyRuleAction(
  poolIds: readonly string[],
  ruleMemberIds: readonly string[],
  action: "show" | "hide" | "prioritize",
): string[] {
  const members = new Set(ruleMemberIds);
  if (action === "hide") return poolIds.filter((id) => !members.has(id));
  if (action === "prioritize") {
    const first = poolIds.filter((id) => members.has(id));
    const rest = poolIds.filter((id) => !members.has(id));
    return [...first, ...rest];
  }
  // show
  const present = new Set(poolIds);
  const missing = ruleMemberIds.filter((id) => !present.has(id));
  return [...poolIds, ...missing];
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

// ── QZY-5 §3 — the archetype lineup ─────────────────────────────────────────

export type RevealLayout = "hero_grid" | "grid" | "list" | "single_hero";

export interface RevealLineup<P extends IndexedProduct = IndexedProduct> {
  /** The featured hero (with badge) — hero_grid / single_hero only. */
  heroBlock: P | null;
  /** What renders in the grid/list body. grid/list archetypes fold the hero
   *  in as the first item (no hero treatment). */
  bodyItems: P[];
  /** Everything visible, in order — the add-all pool and the analytics
   *  shown-ids source. */
  shown: P[];
}

/** results-step4 §3 — split the resolved hero+grid into what each archetype
 *  actually RENDERS. `layout` absent (every pre-QZY doc) resolves to
 *  hero_grid, which is byte-for-byte today's markup. */
export function revealLineup<P extends IndexedProduct>(
  layout: RevealLayout | undefined,
  hero: P | null,
  grid: readonly P[],
): RevealLineup<P> {
  const mode: RevealLayout = layout ?? "hero_grid";
  if (mode === "single_hero") {
    const heroBlock = hero ?? grid[0] ?? null;
    return { heroBlock, bodyItems: [], shown: heroBlock ? [heroBlock] : [] };
  }
  if (mode === "grid" || mode === "list") {
    const bodyItems = [...(hero ? [hero] : []), ...grid];
    return { heroBlock: null, bodyItems, shown: bodyItems };
  }
  const bodyItems = [...grid];
  return {
    heroBlock: hero,
    bodyItems,
    shown: [...(hero ? [hero] : []), ...bodyItems],
  };
}

// ── §6 fallback chain (empty resolved target) ───────────────────────────────

export interface DeciderFallback {
  /** Which named fallback produced the products; null = nothing to show (the
   *  runtime renders the graceful no-match state). "global_fallback" = the
   *  QZY-1 logic-build chooser (preferred when it resolves products). */
  source: "global_fallback" | "empty_fallback" | "safety_net" | null;
  products: IndexedProduct[];
}

/** §6 — what renders when the RESOLVED target has nothing showable. Two named
 *  fallbacks, tried in order: emptyFallbackCol (unless the merchant explicitly
 *  chose "hide" — respected, the safety net does not override an explicit
 *  hide), then safetyNetCol as the global last resort. Members come from
 *  product_index (publish unions both collections in — no live fetch); only
 *  in-stock products qualify (a fallback of sold-out items helps nobody).
 *  The no-target-RESOLVED case is prevented at build time by V1/V2 and is
 *  deliberately not handled here. */
export function deciderFallbackProducts(
  config: ResolvedRecPageConfig,
  productIndex: readonly IndexedProduct[],
): DeciderFallback {
  if (config.emptyFallback === "hide") return { source: null, products: [] };
  const fromCollection = (collectionId: string | undefined): IndexedProduct[] =>
    collectionId
      ? productIndex.filter(
          (p) => inStock(p) && p.collection_ids.includes(collectionId),
        )
      : [];
  const primary = fromCollection(config.emptyFallbackCol).slice(0, config.gridMax);
  if (primary.length > 0) return { source: "empty_fallback", products: primary };
  const net = fromCollection(config.safetyNetCol).slice(0, config.gridMax);
  if (net.length > 0) return { source: "safety_net", products: net };
  return { source: null, products: [] };
}
