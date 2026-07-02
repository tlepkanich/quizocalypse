import { describe, expect, it } from "vitest";
import {
  REC_PAGE_DEFAULTS,
  orderBySignal,
  resolveRecPageGlobal,
  resolveTarget,
  settingsForTarget,
  targetProducts,
  type ResolvedRecPageConfig,
} from "./recommendDecider";
import { recommendForResultExplained, type IndexedProduct } from "./recommendationEngine";
import { Quiz } from "./quizSchema";

// ── fixtures ────────────────────────────────────────────────────────────────

const P = (
  id: string,
  extra: Partial<IndexedProduct> = {},
): IndexedProduct => ({
  product_id: id,
  title: `Product ${id}`,
  handle: id,
  price: "10",
  image_url: null,
  tags: [],
  collection_ids: [],
  inventory_in_stock: true,
  ...extra,
});

const deciderDoc = (patch: Record<string, unknown> = {}) =>
  Quiz.parse({
    quiz_id: "qz1",
    scope: { collection_ids: [] },
    logic_model: "decider",
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Level?",
          question_type: "single_select",
          role: "qualifier",
          answers: [
            { id: "beginner", text: "Beginner", tags: [], edge_handle_id: "h1" },
            { id: "advanced", text: "Advanced", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Terrain?",
          question_type: "single_select",
          role: "decides",
          answers: [
            { id: "park", text: "Park", tags: [], edge_handle_id: "h3", target_id: "cat_park" },
            { id: "powder", text: "Powder", tags: [], edge_handle_id: "h4", target_id: "cat_powder" },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 0, y: 0 },
        data: { headline: "Match", fallback_collection_id: "c1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "r1" },
    ],
    results_pages: [],
    ...patch,
  });

const cfg = (patch: Partial<ResolvedRecPageConfig> = {}): ResolvedRecPageConfig => ({
  ...REC_PAGE_DEFAULTS,
  ...patch,
});

// ── resolveTarget (§2) ──────────────────────────────────────────────────────

describe("resolveTarget — rules → deciding mapping → null (§2)", () => {
  it("direct mapping: the picked decider answer's target wins when no rule matches", () => {
    const doc = deciderDoc();
    expect(resolveTarget(["beginner", "park"], doc)).toEqual({
      targetId: "cat_park",
      matchedRuleId: null,
    });
  });

  it("null when the decider is unanswered / absent / unmapped", () => {
    const doc = deciderDoc();
    expect(resolveTarget(["beginner"], doc)).toBeNull(); // decider unanswered
    // No decides-role question at all:
    const noDecider = deciderDoc();
    for (const n of noDecider.nodes) {
      if (n.type === "question") n.data.role = "qualifier";
    }
    expect(resolveTarget(["park"], noDecider)).toBeNull();
    // Picked answer carries no target_id:
    const unmapped = deciderDoc();
    for (const n of unmapped.nodes) {
      if (n.type === "question" && n.id === "q2") {
        for (const a of n.data.answers) delete (a as { target_id?: string }).target_id;
      }
    }
    expect(resolveTarget(["park"], unmapped)).toBeNull();
  });

  it("a matching AND-rule OVERRIDES the direct mapping; first match wins (priority = order)", () => {
    const doc = deciderDoc({
      decision_rules: [
        {
          id: "rule_low",
          conditions: [
            { question_id: "q1", answer_id: "advanced", op: "is" },
            { question_id: "q2", answer_id: "powder", op: "is" },
          ],
          target_id: "cat_backcountry",
        },
        {
          id: "rule_shadowed",
          conditions: [{ question_id: "q2", answer_id: "powder", op: "is" }],
          target_id: "cat_never",
        },
      ],
    });
    // Both rules match this path — the FIRST fires, evaluation stops.
    expect(resolveTarget(["advanced", "powder"], doc)).toEqual({
      targetId: "cat_backcountry",
      matchedRuleId: "rule_low",
    });
    // Partial AND match → falls through to the broader second rule.
    expect(resolveTarget(["beginner", "powder"], doc)).toEqual({
      targetId: "cat_never",
      matchedRuleId: "rule_shadowed",
    });
    // No rule matches → direct mapping.
    expect(resolveTarget(["advanced", "park"], doc)).toEqual({
      targetId: "cat_park",
      matchedRuleId: null,
    });
  });

  it("is_not: satisfied when the answer is NOT selected (incl. a skipped question)", () => {
    const doc = deciderDoc({
      decision_rules: [
        {
          id: "r1",
          conditions: [
            { question_id: "q2", answer_id: "park", op: "is" },
            { question_id: "q1", answer_id: "beginner", op: "is_not" },
          ],
          target_id: "cat_pro_park",
        },
      ],
    });
    expect(resolveTarget(["advanced", "park"], doc)?.targetId).toBe("cat_pro_park");
    // q1 skipped entirely — "answer is not beginner" holds vacuously.
    expect(resolveTarget(["park"], doc)?.targetId).toBe("cat_pro_park");
    // beginner selected → is_not fails → direct mapping.
    expect(resolveTarget(["beginner", "park"], doc)).toEqual({
      targetId: "cat_park",
      matchedRuleId: null,
    });
  });

  it("a half-built rule (zero conditions) never fires (V9)", () => {
    const doc = deciderDoc({
      decision_rules: [{ id: "empty", conditions: [], target_id: "cat_never" }],
    });
    expect(resolveTarget(["park"], doc)).toEqual({
      targetId: "cat_park",
      matchedRuleId: null,
    });
  });
});

// ── settings resolution (§2.2/§3) ───────────────────────────────────────────

describe("rec-page settings resolution — defaults + override-wins", () => {
  it("empty settings resolve to the spec defaults", () => {
    const g = resolveRecPageGlobal(undefined);
    expect(g.headline).toBe("Your perfect match");
    expect(g.heroLogic).toBe("collection_order");
    expect(g.gridMax).toBe(3);
    expect(g.gridSort).toBe("collection_order");
    expect(g.heroOos).toBe("next");
    expect(g.whyOn).toBe(true);
    expect(g.emptyFallback).toBe("collection");
    expect(g.incentiveOn).toBe(false);
  });

  it("per-target override wins; absent fields inherit global", () => {
    const settings = Quiz.parse(
      JSON.parse(
        JSON.stringify(
          deciderDoc({
            rec_page_settings: {
              global: { headline: "Global H", gridMax: 5, heroLogic: "bestseller" },
              overrides: { cat_park: { headline: "Park picks" } },
            },
          }),
        ),
      ),
    ).rec_page_settings;
    const forPark = settingsForTarget(settings, "cat_park");
    expect(forPark.headline).toBe("Park picks"); // override wins
    expect(forPark.gridMax).toBe(5); // inherited from global
    expect(forPark.heroLogic).toBe("bestseller"); // inherited
    const forOther = settingsForTarget(settings, "cat_powder");
    expect(forOther.headline).toBe("Global H");
  });
});

// ── targetProducts (§4/§5) ──────────────────────────────────────────────────

describe("targetProducts — hero + grid by real signals", () => {
  const index = [
    P("a", { updated_at: "2026-01-01", metafields: { __rank_bestseller: "5", __rank_rating: "3" } }),
    P("b", { updated_at: "2026-03-01", metafields: { __rank_bestseller: "9", __rank_rating: "1" } }),
    P("c", { updated_at: "2026-02-01", metafields: { __rank_bestseller: "1", __rank_rating: "8" } }),
    P("d", { inventory_in_stock: false, updated_at: "2026-04-01" }),
  ];
  const map = { t1: ["a", "b", "c", "d"] };

  it("collection_order (default): hero = first IN-STOCK product in map order; grid = the rest", () => {
    const out = targetProducts({ targetId: "t1", config: cfg(), productIndex: index, targetProductIdsMap: map });
    expect(out.hero?.product_id).toBe("a");
    expect(out.grid.map((p) => p.product_id)).toEqual(["b", "c"]); // d is OOS, excluded
    expect(out.poolSize).toBe(4);
    expect(out.allOutOfStock).toBe(false);
  });

  it("an OOS product ahead in map order never becomes the hero (§5 promote-next)", () => {
    const m = { t1: ["d", "a", "b"] }; // d (OOS) first
    const out = targetProducts({ targetId: "t1", config: cfg(), productIndex: index, targetProductIdsMap: m });
    expect(out.hero?.product_id).toBe("a");
  });

  it("bestseller / reviewed / newest signals order by their rank data", () => {
    const best = targetProducts({
      targetId: "t1", config: cfg({ heroLogic: "bestseller" }), productIndex: index, targetProductIdsMap: map,
    });
    expect(best.hero?.product_id).toBe("b"); // __rank_bestseller 9
    const rated = targetProducts({
      targetId: "t1", config: cfg({ heroLogic: "reviewed" }), productIndex: index, targetProductIdsMap: map,
    });
    expect(rated.hero?.product_id).toBe("c"); // __rank_rating 8
    const newest = targetProducts({
      targetId: "t1", config: cfg({ heroLogic: "newest" }), productIndex: index, targetProductIdsMap: map,
    });
    expect(newest.hero?.product_id).toBe("b"); // 2026-03-01 newest in-stock
  });

  it("missing signal data silently falls back to collection order (§11.2)", () => {
    const plain = [P("x"), P("y")];
    const out = targetProducts({
      targetId: "t", config: cfg({ heroLogic: "bestseller" }),
      productIndex: plain, targetProductIdsMap: { t: ["x", "y"] },
    });
    expect(out.hero?.product_id).toBe("x");
  });

  it("gridSort orders the grid independently of heroLogic; gridMax caps; never pads", () => {
    const out = targetProducts({
      targetId: "t1",
      config: cfg({ heroLogic: "collection_order", gridSort: "bestseller", gridMax: 2 }),
      productIndex: index, targetProductIdsMap: map,
    });
    expect(out.hero?.product_id).toBe("a");
    expect(out.grid.map((p) => p.product_id)).toEqual(["b", "c"]); // bestseller order, capped 2
    const roomy = targetProducts({
      targetId: "t1", config: cfg({ gridMax: 12 }), productIndex: index, targetProductIdsMap: map,
    });
    expect(roomy.grid).toHaveLength(2); // only 2 in-stock remain — never padded
  });

  it("individual-product target: hero only, no grid; OOS still shows, badged (§4.1/§5)", () => {
    const out = targetProducts({
      targetId: "t1", targetShape: "product", config: cfg(),
      productIndex: index, targetProductIdsMap: { t1: ["a", "b"] },
    });
    expect(out.hero?.product_id).toBe("a");
    expect(out.grid).toEqual([]);
    const oos = targetProducts({
      targetId: "t", targetShape: "product", config: cfg(),
      productIndex: index, targetProductIdsMap: { t: ["d"] },
    });
    expect(oos.hero?.product_id).toBe("d");
    expect(oos.allOutOfStock).toBe(true);
  });

  it("ENTIRE target OOS: heroOos 'next' → badged hero; 'grid' → grid only (§5.3)", () => {
    const allOos = [P("d", { inventory_in_stock: false }), P("e", { inventory_in_stock: false })];
    const m = { t: ["d", "e"] };
    const next = targetProducts({
      targetId: "t", config: cfg({ heroOos: "next" }), productIndex: allOos, targetProductIdsMap: m,
    });
    expect(next.hero?.product_id).toBe("d");
    expect(next.allOutOfStock).toBe(true);
    const gridOnly = targetProducts({
      targetId: "t", config: cfg({ heroOos: "grid" }), productIndex: allOos, targetProductIdsMap: m,
    });
    expect(gridOnly.hero).toBeNull();
    expect(gridOnly.grid.map((p) => p.product_id)).toEqual(["d", "e"]);
  });

  it("empty target → poolSize 0 (the §6 empty-result fallback case)", () => {
    const out = targetProducts({
      targetId: "gone", config: cfg(), productIndex: index, targetProductIdsMap: {},
    });
    expect(out).toEqual({ hero: null, grid: [], poolSize: 0, allOutOfStock: false });
  });

  it("orderBySignal never mutates its input", () => {
    const pool = [P("a", { metafields: { __rank_bestseller: "1" } }), P("b", { metafields: { __rank_bestseller: "9" } })];
    const snap = JSON.stringify(pool);
    orderBySignal(pool, "bestseller");
    expect(JSON.stringify(pool)).toBe(snap);
  });
});

// ── the engine dispatch (L2-2) ──────────────────────────────────────────────

describe("recommendForResultExplained dispatch — decider docs bypass the ladder", () => {
  const index = [P("a"), P("b"), P("c")];

  it("a decider doc resolves via the target path (rungUsed 'decider'/'decider_rule')", () => {
    const doc = deciderDoc({
      decision_rules: [
        {
          id: "r1",
          conditions: [{ question_id: "q1", answer_id: "advanced", op: "is" }],
          target_id: "cat_pro",
        },
      ],
    });
    const direct = recommendForResultExplained({
      quiz: doc, productIndex: index, selectedAnswerIds: ["beginner", "park"],
      resultNodeId: "r1",
      targetProductIdsMap: { cat_park: ["a", "b"], cat_pro: ["c"] },
      targetIndex: { cat_park: { type: "collection" }, cat_pro: { type: "product" } },
    });
    expect(direct.rungUsed).toBe("decider");
    expect(direct.products.map((p) => p.product_id)).toEqual(["a", "b"]);
    const ruled = recommendForResultExplained({
      quiz: doc, productIndex: index, selectedAnswerIds: ["advanced", "park"],
      resultNodeId: "r1",
      targetProductIdsMap: { cat_park: ["a", "b"], cat_pro: ["c"] },
      targetIndex: { cat_park: { type: "collection" }, cat_pro: { type: "product" } },
    });
    expect(ruled.rungUsed).toBe("decider_rule");
    expect(ruled.products.map((p) => p.product_id)).toEqual(["c"]);
  });

  it("an unresolved decider path returns empty (the fallback layer's case)", () => {
    const doc = deciderDoc();
    const out = recommendForResultExplained({
      quiz: doc, productIndex: index, selectedAnswerIds: [], resultNodeId: "r1",
      targetProductIdsMap: {},
    });
    expect(out.products).toEqual([]);
    expect(out.rungUsed).toBeNull();
  });
});
