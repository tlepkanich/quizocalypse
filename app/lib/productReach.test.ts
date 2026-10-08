import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { computeReachability } from "./quizReachability";
import { narrowFacts, productReachMap, ruleSentence, type ProductReach, type ReachWay } from "./productReach";
import { answerFilterValues } from "./filterMatching";
import type { IndexedProduct } from "./recommendationEngine";

// Published decider fixture (Filter Results + Rules):
//   intro → q1 Skin type (Picks):  Dry → Hydrating set · Oily → Mattifying set
//         → q2 Budget (Narrows):   "Under $30" tag under-30 · "$25–50" tag 25-50
//         → q3 Concern (multi):    Redness · Acne
//         → result
//   Rule 1: When they pick Redness AND Acne (all-of, multi-select), show Spot
//           Patch. Enumeration forks one answer per question, so it is
//           inferred statically. (Below rule 2 it would be shadowed: everyone
//           it catches, the Redness rule catches first.)
//   Rule 2: When they pick Redness, show Barrier Repair Cream (a product target).
// Products: p1 Hydra Serum $38 [25-50] · p2 Rich Cream $22 [under-30] (Hydrating)
//           p3 Matte Gel $45 [25-50] · p6 Luxe Oil (no budget tag) (Mattifying)
//           p4 Barrier Repair Cream (rule 2 only) · p7 Spot Patch (rule 1 only)
//           p5 Orphan (no target) · p8 Draft Serum (Hydrating, status draft)
const RAW = {
  quiz_id: "qz_reach",
  logic_model: "decider",
  logic_style: "attributes",
  scope: { collection_ids: [] },
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Welcome" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Skin type",
        question_type: "single_select",
        role: "decides",
        required: true,
        answers: [
          { id: "dry", text: "Dry", tags: [], edge_handle_id: "h_dry", target_id: "t_hyd" },
          { id: "oily", text: "Oily", tags: [], edge_handle_id: "h_oily", target_id: "t_mat" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "Budget",
        question_type: "single_select",
        role: "filter",
        answers: [
          { id: "low", text: "Under $30", tags: ["under-30"], edge_handle_id: "h_low" },
          { id: "mid", text: "$25–50", tags: ["25-50"], edge_handle_id: "h_mid" },
        ],
      },
    },
    {
      id: "q3",
      type: "question",
      position: { x: 3, y: 0 },
      data: {
        text: "Concern",
        question_type: "multi_select",
        max_selections: 2,
        answers: [
          { id: "red", text: "Redness", tags: [], edge_handle_id: "h_red" },
          { id: "acne", text: "Acne", tags: [], edge_handle_id: "h_acne" },
        ],
      },
    },
    { id: "res", type: "result", position: { x: 4, y: 0 }, data: { headline: "Your pick", fallback_collection_id: "gid://c/fallback" } },
  ],
  edges: [
    { id: "e0", source: "intro", target: "q1" },
    { id: "e1", source: "q1", target: "q2" },
    { id: "e2", source: "q2", target: "q3" },
    { id: "e3", source: "q3", target: "res" },
  ],
  decision_rules: [
    {
      id: "R2",
      conditions: [
        { question_id: "q3", answer_id: "red", op: "is" },
        { question_id: "q3", answer_id: "acne", op: "is" },
      ],
      target_id: "t_spot",
      action: "show",
    },
    {
      id: "R1",
      conditions: [{ question_id: "q3", answer_id: "red", op: "is" }],
      target_id: "t_barrier",
      action: "show",
    },
  ],
};

const product = (id: string, title: string, price: string, tags: string[], extra: Partial<IndexedProduct> = {}) => ({
  product_id: id,
  title,
  handle: id,
  price,
  image_url: null,
  tags,
  collection_ids: [],
  inventory_in_stock: true,
  ...extra,
});

const BAKE = {
  target_product_ids_map: {
    t_hyd: ["p1", "p2", "p8"],
    t_mat: ["p3", "p6"],
    t_barrier: ["p4"],
    t_spot: ["p7"],
  },
  target_index: {
    t_hyd: { type: "collection", name: "Hydrating" },
    t_mat: { type: "collection", name: "Mattifying" },
    t_barrier: { type: "product", name: "Barrier Repair Cream" },
    t_spot: { type: "product", name: "Spot Patch" },
  },
  product_index: [
    product("p1", "Hydra Serum", "38.00", ["25-50"]),
    product("p2", "Rich Cream", "22.00", ["Under-30"]),
    product("p3", "Matte Gel", "45.00", ["25-50"]),
    product("p4", "Barrier Repair Cream", "30.00", []),
    product("p5", "Orphan", "10.00", []),
    product("p6", "Luxe Oil", "90.00", ["luxury"]),
    product("p7", "Spot Patch", "12.00", []),
    product("p8", "Draft Serum", "40.00", ["25-50"], { status: "draft" }),
  ],
};

const published = (over: Record<string, unknown> = {}) => ({ ...structuredClone(RAW), ...structuredClone(BAKE), ...over });
const parse = (raw: unknown) => Quiz.parse(raw);

function reach(): Map<string, ProductReach> {
  const raw = published();
  const report = productReachMap(parse(raw), raw);
  expect(report).not.toBeNull();
  return report!.products;
}
const kinds = (ways: readonly ReachWay[]) => ways.map((w) => w.kind);

describe("productReachMap", () => {
  it("returns every product_index product in one pass", () => {
    const raw = published();
    const report = productReachMap(parse(raw), raw)!;
    expect([...report.products.keys()]).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
    expect(report.truncated).toBe(false);
    // Dry/Oily × Under $30/$25–50 × Redness/Acne
    expect(report.pathCount).toBe(8);
  });

  it("starting set + narrowing, each pointing to its result", () => {
    const p1 = reach().get("p1")!;
    expect(p1.reachable).toBe(true);
    expect(p1.noLogic).toBe(false);
    expect(p1.price).toBe("38.00");
    expect(kinds(p1.ways)).toEqual(["starting_set", "narrows"]);
    const [start, narrow] = p1.ways;
    expect(start).toMatchObject({
      kind: "starting_set",
      questionText: "Skin type",
      answerText: "Dry",
      targetId: "t_hyd",
      targetName: "Hydrating",
      results: [{ targetId: "t_hyd", name: "Hydrating" }],
      pathCount: 2,
      sentence: "Dry opens the Hydrating set, which includes this product.",
    });
    expect(narrow).toMatchObject({
      kind: "narrows",
      questionText: "Budget",
      answerText: "$25–50",
      facts: [{ kind: "tag", value: "25-50" }],
      results: [{ targetId: "t_hyd", name: "Hydrating" }],
      sentence: "$25–50 keeps it: tagged 25-50.",
    });
    expect(p1.pathCount).toBe(2);
  });

  it("keeps the product's own tag casing in the narrowing reason", () => {
    const p2 = reach().get("p2")!;
    const narrow = p2.ways.find((w) => w.kind === "narrows")!;
    expect(narrow.sentence).toBe("Under $30 keeps it: tagged Under-30.");
  });

  it("a product only a rule reaches", () => {
    const p4 = reach().get("p4")!;
    expect(p4.reachable).toBe(true);
    expect(kinds(p4.ways)).toEqual(["rule"]);
    expect(p4.ways[0]).toMatchObject({
      kind: "rule",
      ruleId: "R1",
      ruleNumber: 2,
      verb: "show",
      groups: [{ questionText: "Concern", not: false, answers: [{ answerId: "red", text: "Redness" }] }],
      targets: [{ targetId: "t_barrier", name: "Barrier Repair Cream" }],
      results: [{ targetId: "t_barrier", name: "Barrier Repair Cream" }],
      // Redness on every Skin type × Budget pair; Show appends after narrowing.
      pathCount: 4,
      sentence: "When they pick Redness, show Barrier Repair Cream.",
    });
    expect(p4.ways[0]).not.toHaveProperty("inferred");
  });

  it("infers a runnable rule enumeration cannot exercise (multi-select all-of)", () => {
    const p7 = reach().get("p7")!;
    expect(p7.reachable).toBe(true);
    expect(p7.ways).toHaveLength(1);
    expect(p7.ways[0]).toMatchObject({
      kind: "rule",
      ruleNumber: 1,
      inferred: true,
      pathCount: 0,
      sentence: "When they pick (Redness and Acne), show Spot Patch.",
    });
  });

  it("never infers a rule that cannot run (shadowed by an earlier rule)", () => {
    const raw = published();
    raw.decision_rules.reverse(); // the all-of rule now sits under "Redness"
    const p7 = productReachMap(parse(raw), raw)!.products.get("p7")!;
    expect(p7.noLogic).toBe(true);
  });

  it("flags products nothing reaches: unmapped, narrowed out, not sellable", () => {
    const m = reach();
    for (const id of ["p5", "p6", "p8"]) {
      const p = m.get(id)!;
      expect(p.reachable).toBe(false);
      expect(p.noLogic).toBe(true);
      expect(p.ways).toEqual([]);
      expect(p.pathCount).toBe(0);
    }
    // The more accurate answer: computeReachability ignores narrowing and
    // counts p6 (in the Mattifying set, no budget answer keeps it) reachable.
    expect(computeReachability(published())!.stateById.get("p6")).toBe("reachable");
  });

  it("a no-preference answer passes p6 through, so it becomes reachable", () => {
    const raw = published();
    const q2 = raw.nodes.find((n) => n.id === "q2")!;
    (q2.data as { answers: unknown[] }).answers.push({
      id: "any",
      text: "No preference",
      tags: [],
      edge_handle_id: "h_any",
      no_preference: true,
    });
    const p6 = productReachMap(parse(raw), raw)!.products.get("p6")!;
    expect(p6.reachable).toBe(true);
    expect(kinds(p6.ways)).toEqual(["starting_set"]);
    expect(p6.ways[0]!.sentence).toBe("Oily opens the Mattifying set, which includes this product.");
  });

  it("a replace rule (no action) is the starting point and narrowing still applies", () => {
    const raw = published({
      decision_rules: [
        { id: "RX", conditions: [{ question_id: "q1", answer_id: "oily", op: "is" }], target_id: "t_hyd" },
      ],
    });
    const m = productReachMap(parse(raw), raw)!.products;
    // Oily now lands in Hydrating via rule 1; the Oily starting set is never used.
    expect(m.get("p3")!.reachable).toBe(false);
    const p1 = m.get("p1")!;
    expect(kinds(p1.ways)).toEqual(["starting_set", "narrows", "rule"]);
    expect(p1.ways[2]).toMatchObject({
      ruleNumber: 1,
      results: [{ targetId: "t_hyd", name: "Hydrating" }],
      sentence: "When they pick Oily, show Hydrating.",
    });
  });

  it("Rules only: no starting sets, no narrowing; hide rules show nothing", () => {
    const raw = published({
      logic_style: "rules",
      decision_rules: [
        { id: "H", conditions: [{ question_id: "q1", answer_id: "oily", op: "is" }], target_id: "t_mat", action: "hide" },
        { id: "S", conditions: [{ question_id: "q1", answer_id: "dry", op: "is" }], target_id: "t_hyd", action: "show" },
      ],
    });
    const m = productReachMap(parse(raw), raw)!.products;
    const p6 = m.get("p6")!; // no narrowing in Rules only, but only a hide names Mattifying
    expect(p6.reachable).toBe(false);
    const p1 = m.get("p1")!;
    expect(kinds(p1.ways)).toEqual(["rule"]);
    expect(p1.ways[0]).toMatchObject({ ruleNumber: 2, sentence: "When they pick Dry, show Hydrating." });
    // Rules only ignores the Budget role, so the tagless Rich Cream is in too.
    expect(m.get("p2")!.reachable).toBe(true);
  });

  it("collection facts use supplied collection names", () => {
    const raw = published();
    const q2 = raw.nodes.find((n) => n.id === "q2")!;
    const ans = (q2.data as { answers: Array<Record<string, unknown>> }).answers;
    ans[0] = { ...ans[0], tags: [], collection_filter: "gid://c/budget" };
    const idx = raw.product_index.map((p) =>
      p.product_id === "p2" ? { ...p, collection_ids: ["gid://c/budget"] } : p,
    );
    const raw2 = { ...raw, product_index: idx };
    const report = productReachMap(parse(raw2), raw2, {
      collectionNames: { "gid://c/budget": "Budget picks" },
    })!;
    const narrow = report.products.get("p2")!.ways.find((w) => w.kind === "narrows")!;
    expect(narrow.sentence).toBe("Under $30 keeps it: in Budget picks.");
  });

  it("legacy docs and unbaked decider docs return null without throwing", () => {
    const legacyRaw: Record<string, unknown> = { ...published() };
    delete legacyRaw.logic_model;
    delete legacyRaw.logic_style;
    expect(productReachMap(parse(legacyRaw), legacyRaw)).toBeNull();

    const unbaked: Record<string, unknown> = structuredClone(RAW);
    expect(productReachMap(parse(unbaked), unbaked)).toBeNull();
    expect(productReachMap(parse(unbaked), null)).toBeNull();
  });
});

describe("narrowFacts", () => {
  it("names every attribute kind the narrowing filter checks", () => {
    const values = answerFilterValues({
      id: "x",
      text: "x",
      tags: ["sale"],
      edge_handle_id: "hx",
      collection_filters: ["c1"],
      metafield_filters: [{ key: "custom.skin_type", value: "oily" }],
      variant_filters: [{ name: "Size", value: "m" }],
      product_type_filters: ["serum"],
    })!;
    const p: IndexedProduct = {
      ...product("p", "P", "1.00", ["Sale"]),
      collection_ids: ["c1"],
      metafields: { "custom.skin_type": "Dry, Oily" },
      variant_options: { Size: ["S", "M"] },
      product_type: "Serum",
    };
    expect(narrowFacts(p, values, (id) => (id === "c1" ? "Serums" : null))).toEqual([
      { kind: "collection", collectionId: "c1", name: "Serums" },
      { kind: "tag", value: "Sale" },
      { kind: "metafield", key: "custom.skin_type", value: "Oily" },
      { kind: "variant", name: "Size", value: "M" },
      { kind: "product_type", value: "Serum" },
    ]);
  });
});

describe("ruleSentence", () => {
  it("reads negated groups and the rule's own joins", () => {
    expect(
      ruleSentence({
        verb: "pin",
        across: "and",
        targets: [{ targetId: "t", name: "Barrier Repair Cream" }],
        groups: [
          { questionId: "a", questionText: "", not: false, join: "or", answers: [{ answerId: "1", text: "Redness" }] },
          {
            questionId: "b",
            questionText: "",
            not: true,
            join: "or",
            answers: [
              { answerId: "2", text: "Oily" },
              { answerId: "3", text: "Combination" },
            ],
          },
        ],
      }),
    ).toBe("When they pick Redness and not (Oily or Combination), pin Barrier Repair Cream.");
  });
});
