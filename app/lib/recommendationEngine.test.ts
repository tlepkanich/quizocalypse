import { describe, expect, it } from "vitest";
import {
  pickBranchSlot,
  pickPointsWinner,
  recommendForResult,
  recommendForStage,
  recommendPreview,
  resolveNextStep,
  nextNodeFor,
  isSellable,
  type BranchContext,
  type IndexedProduct,
} from "./recommendationEngine";
import { Quiz } from "./quizSchema";

const baseProducts: IndexedProduct[] = [
  {
    product_id: "p1",
    title: "Oily Cleanser",
    handle: "oily-cleanser",
    price: "20.00",
    image_url: null,
    tags: ["oily", "oil-control"],
    collection_ids: ["c-cleansers"],
    inventory_in_stock: true,
  },
  {
    product_id: "p2",
    title: "Dry Cream",
    handle: "dry-cream",
    price: "30.00",
    image_url: null,
    tags: ["dry", "hydrating"],
    collection_ids: ["c-cleansers"],
    inventory_in_stock: true,
  },
  {
    product_id: "p3",
    title: "Balanced Wash",
    handle: "balanced-wash",
    price: "25.00",
    image_url: null,
    tags: ["balanced", "gentle"],
    collection_ids: ["c-cleansers"],
    inventory_in_stock: true,
  },
  {
    product_id: "p4",
    title: "Out of Stock Oily",
    handle: "out-of-stock-oily",
    price: "18.00",
    image_url: null,
    tags: ["oily"],
    collection_ids: ["c-cleansers"],
    inventory_in_stock: false,
  },
  {
    product_id: "p5",
    title: "Cheap Oily",
    handle: "cheap-oily",
    price: "12.00",
    image_url: null,
    tags: ["oily"],
    collection_ids: ["c-cleansers"],
    inventory_in_stock: true,
  },
];

const quizDoc = Quiz.parse({
  quiz_id: "q1",
  status: "draft",
  scope: { collection_ids: ["c-cleansers"] },
  nodes: [
    {
      id: "intro",
      type: "intro",
      position: { x: 0, y: 0 },
      data: { headline: "Welcome" },
    },
    {
      id: "q1",
      type: "question",
      position: { x: 200, y: 0 },
      data: {
        text: "What's your skin type?",
        question_type: "single_select",
        answers: [
          {
            id: "a-oily",
            text: "Oily",
            tags: ["oily", "oil-control"],
            edge_handle_id: "h1",
          },
          { id: "a-dry", text: "Dry", tags: ["dry"], edge_handle_id: "h2" },
          { id: "a-bal", text: "Balanced", tags: ["balanced"], edge_handle_id: "h3" },
        ],
      },
    },
    {
      id: "r1",
      type: "result",
      position: { x: 400, y: 0 },
      data: { headline: "Your match", fallback_collection_id: "c-cleansers" },
    },
  ],
  edges: [
    { id: "e1", source: "intro", target: "q1" },
    { id: "e2", source: "q1", target: "r1" },
  ],
  results_pages: [
    { id: "r1", headline: "Your match", product_ids: [] },
  ],
});

describe("recommendForResult", () => {
  it("ranks by tag overlap score", () => {
    const result = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.product_id).toBe("p1"); // 2 tag matches (oily, oil-control)
  });

  it("breaks ties by in-stock first, then price ascending", () => {
    const result = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    // p1 (score 2) wins. Then p4 (out of stock) vs p5 (in stock, cheaper):
    // both score 1. Tie-break: in-stock first → p5, then p4.
    expect(result.map((r) => r.product_id)).toEqual(["p1", "p5", "p4"]);
  });

  it("falls back to the fallback collection when no tags match", () => {
    const result = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: [], // no answers → no tags → all products score 0
      resultNodeId: "r1",
    });
    // Falls back to c-cleansers collection (all 5 products), sorted by in-stock + price.
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.inventory_in_stock).toBe(true);
  });

  it("caps results at the result node's slot_count", () => {
    const result = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    // Default slot_count from schema is 3.
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns empty array if the result node id is missing", () => {
    const result = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "does-not-exist",
    });
    expect(result).toEqual([]);
  });

  it("applies an answer's collection_filter to narrow the candidate pool", () => {
    const filteredProducts: IndexedProduct[] = [
      ...baseProducts,
      {
        product_id: "p99",
        title: "Wrong Collection",
        handle: "wrong-collection",
        price: "10.00",
        image_url: null,
        tags: ["oily", "oil-control"],
        collection_ids: ["other-collection"],
        inventory_in_stock: true,
      },
    ];
    const filteredQuiz = Quiz.parse({
      ...quizDoc,
      nodes: quizDoc.nodes.map((n) =>
        n.id === "q1" && n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a) =>
                  a.id === "a-oily"
                    ? { ...a, collection_filter: "c-cleansers" }
                    : a,
                ),
              },
            }
          : n,
      ),
    });
    const result = recommendForResult({
      quiz: filteredQuiz,
      productIndex: filteredProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    // p99 has higher tag score but is filtered out by collection.
    expect(result.find((p) => p.product_id === "p99")).toBeUndefined();
  });
});

describe("recommendForResult — v3 match ladder", () => {
  // Helper: build a quiz whose result node uses a custom ladder + config.
  function ladderQuiz(resultData: Record<string, unknown>) {
    return Quiz.parse({
      quiz_id: "lq",
      scope: { collection_ids: ["c-cleansers"] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 200, y: 0 },
          data: {
            text: "?",
            question_type: "single_select",
            answers: [
              { id: "a-oily", text: "Oily", tags: ["oily"], edge_handle_id: "h1", points: { "cat-oily": 2 } },
              { id: "a-dry", text: "Dry", tags: ["dry"], edge_handle_id: "h2", points: { "cat-dry": 3 } },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 400, y: 0 },
          data: { headline: "Match", fallback_collection_id: "c-cleansers", ...resultData },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
      results_pages: resultData.__page
        ? [resultData.__page as Record<string, unknown>]
        : [{ id: "r1", headline: "Match", product_ids: [] }],
    });
  }

  it("conditional strategy: if-all-of-answers returns the mapped products", () => {
    const quiz = ladderQuiz({
      match_ladder: ["conditional", "tag"],
      conditional_rules: [{ all_of: ["a-oily"], any_of: [], product_ids: ["p2"] }],
    });
    const out = recommendForResult({
      quiz,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    expect(out.map((p) => p.product_id)).toEqual(["p2"]);
  });

  it("never recommends a non-sellable junk product ($0 + out of stock)", () => {
    const junk: IndexedProduct = {
      product_id: "p_junk",
      title: "Points Logic (Tags)",
      handle: "points-logic-tags",
      price: "0.00",
      image_url: null,
      tags: ["oily"],
      collection_ids: ["c-cleansers"],
      inventory_in_stock: false,
    };
    const quiz = ladderQuiz({
      match_ladder: ["category"],
      category_id: "cat-junk",
      oos_behavior: "show_with_badge", // even when the page would SHOW oos items
      __page: {
        id: "r1",
        headline: "Match",
        product_ids: [],
        match_strategy: "archetype",
        category_id: "cat-junk",
        category_product_ids_map: { "cat-junk": ["p_junk", "p2"] },
      },
    });
    const out = recommendForResult({
      quiz,
      productIndex: [...baseProducts, junk],
      selectedAnswerIds: [],
      resultNodeId: "r1",
    });
    expect(out.some((p) => p.product_id === "p_junk")).toBe(false);
    expect(out.map((p) => p.product_id)).toContain("p2");
  });

  it("isSellable drops $0 + OOS, keeps real OOS-with-price and in-stock free items", () => {
    expect(isSellable({ inventory_in_stock: false, price: "0.00" })).toBe(false);
    expect(isSellable({ inventory_in_stock: false, price: null })).toBe(false);
    expect(isSellable({ inventory_in_stock: false, price: "24.00" })).toBe(true);
    expect(isSellable({ inventory_in_stock: true, price: "0.00" })).toBe(true);
  });

  it("falls through to the next strategy when conditional has no match", () => {
    const quiz = ladderQuiz({
      match_ladder: ["conditional", "tag"],
      conditional_rules: [{ all_of: ["a-dry"], any_of: [], product_ids: ["p2"] }],
    });
    const out = recommendForResult({
      quiz,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"], // a-dry not picked → conditional misses → tag wins
      resultNodeId: "r1",
    });
    // tag "oily" matches p1/p4/p5 equally (score 1); cheapest in-stock wins.
    expect(out[0]!.product_id).toBe("p5");
    expect(out.some((p) => p.product_id === "p1")).toBe(true);
  });

  it("points strategy: returns the winning category's baked bucket", () => {
    const quiz = ladderQuiz({
      match_ladder: ["points"],
      __page: {
        id: "r1",
        headline: "Match",
        product_ids: [],
        category_product_ids_map: { "cat-oily": ["p1"], "cat-dry": ["p2"] },
      },
    });
    // a-dry contributes 3 to cat-dry; a-oily contributes 2 to cat-oily → dry wins.
    const out = recommendForResult({
      quiz,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily", "a-dry"],
      resultNodeId: "r1",
    });
    expect(out.map((p) => p.product_id)).toEqual(["p2"]);
  });

  it("collection strategy returns products in the bound collection", () => {
    const withCol: IndexedProduct[] = [
      ...baseProducts,
      { product_id: "px", title: "X", handle: "x", price: "9", image_url: null, tags: [], collection_ids: ["c-special"], inventory_in_stock: true },
    ];
    const quiz = ladderQuiz({ match_ladder: ["collection"], collection_id: "c-special" });
    const out = recommendForResult({
      quiz,
      productIndex: withCol,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    expect(out.map((p) => p.product_id)).toEqual(["px"]);
  });

  it("ranking=newest orders by updated_at desc", () => {
    const dated: IndexedProduct[] = baseProducts.map((p, i) => ({
      ...p,
      updated_at: `2026-01-0${i + 1}T00:00:00Z`,
    }));
    const quiz = ladderQuiz({ match_ladder: ["collection"], collection_id: "c-cleansers", ranking: "newest" });
    const out = recommendForResult({
      quiz,
      productIndex: dated,
      selectedAnswerIds: [],
      resultNodeId: "r1",
    });
    // p5 has the latest updated_at (index 4) → first.
    expect(out[0]!.product_id).toBe("p5");
  });

  it("oos_behavior=hide drops out-of-stock products", () => {
    const quiz = ladderQuiz({ match_ladder: ["tag"], oos_behavior: "hide" });
    const out = recommendForResult({
      quiz,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    expect(out.find((p) => p.product_id === "p4")).toBeUndefined(); // p4 is OOS
  });

  it("max_products caps the result count; falls back to slot_count when unset", () => {
    const capped = ladderQuiz({ match_ladder: ["collection"], collection_id: "c-cleansers", max_products: 2 });
    const out = recommendForResult({
      quiz: capped,
      productIndex: baseProducts,
      selectedAnswerIds: [],
      resultNodeId: "r1",
    });
    expect(out.length).toBe(2);
  });
});

describe("pickPointsWinner", () => {
  function pointsQuiz() {
    return Quiz.parse({
      quiz_id: "pq",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 100, y: 0 },
          data: {
            text: "?",
            question_type: "single_select",
            answers: [
              { id: "a1", text: "A", tags: [], edge_handle_id: "h1", points: { x: 1, y: 5 } },
              { id: "a2", text: "B", tags: [], edge_handle_id: "h2", points: { x: 4 } },
            ],
          },
        },
        { id: "end", type: "end", position: { x: 200, y: 0 }, data: { headline: "Bye" } },
      ],
      edges: [{ id: "e1", source: "intro", target: "q1" }],
    });
  }

  it("returns the highest-tally category across picked answers", () => {
    // a1: x+1, y+5; a2: x+4 → x total 5, y total 5; tie broken by first-seen (x).
    expect(pickPointsWinner(pointsQuiz(), ["a1", "a2"])).toBe("x");
  });

  it("returns null when no picked answer carries points", () => {
    expect(pickPointsWinner(pointsQuiz(), [])).toBeNull();
  });
});

describe("recommendPreview", () => {
  it("returns featured-collection products when no answers have been picked", () => {
    const products: IndexedProduct[] = [
      ...baseProducts,
      {
        product_id: "p-feat-1",
        title: "Featured Hero",
        handle: "featured-hero",
        price: "40.00",
        image_url: null,
        tags: [],
        collection_ids: ["c-featured"],
        inventory_in_stock: true,
      },
      {
        product_id: "p-feat-2",
        title: "Featured Sidekick",
        handle: "featured-sidekick",
        price: "35.00",
        image_url: null,
        tags: [],
        collection_ids: ["c-featured"],
        inventory_in_stock: true,
      },
    ];
    const quiz = Quiz.parse({
      ...quizDoc,
      featured_collection_id: "c-featured",
    });
    const result = recommendPreview({
      quiz,
      productIndex: products,
      selectedAnswerIds: [],
    });
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every((r) => r.collection_ids.includes("c-featured")),
    ).toBe(true);
  });

  it("falls back to scope products when no featured collection set", () => {
    const result = recommendPreview({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: [],
    });
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every((r) => r.collection_ids.includes("c-cleansers")),
    ).toBe(true);
  });

  it("ranks by tag overlap when answers have tags", () => {
    const result = recommendPreview({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
    });
    // a-oily tags: ["oily", "oil-control"]. p1 has both → score 2.
    expect(result[0]!.product_id).toBe("p1");
    expect(result[0]!.score).toBe(2);
  });

  it("respects slotCount cap", () => {
    const result = recommendPreview({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      slotCount: 2,
    });
    expect(result.length).toBe(2);
  });
});

describe("nextNodeFor", () => {
  it("follows the edge matching the selected handle", () => {
    const branchedQuiz = Quiz.parse({
      ...quizDoc,
      nodes: [
        ...quizDoc.nodes,
        {
          id: "r2",
          type: "result",
          position: { x: 400, y: 100 },
          data: { headline: "Dry match", fallback_collection_id: "c-cleansers" },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1", source_handle: "h1" },
        { id: "e3", source: "q1", target: "r2", source_handle: "h2" },
      ],
    });
    expect(nextNodeFor(branchedQuiz, "q1", "h1")).toBe("r1");
    expect(nextNodeFor(branchedQuiz, "q1", "h2")).toBe("r2");
  });

  it("falls back to first unconditional edge when no handle match", () => {
    expect(nextNodeFor(quizDoc, "q1", "no-such-handle")).toBe("r1");
  });

  it("returns null when no outbound edges exist", () => {
    expect(nextNodeFor(quizDoc, "r1", null)).toBeNull();
  });
});

// ---------- Branch routing (Phase 2) ----------

// Builds a quiz with a question, a branch, and two terminal results.
// Intro -> q1 -> branch -> (slot A -> r1) / (slot B -> r2).
function branchQuiz(opts: {
  mode: "rules" | "ab_split";
  weightA?: number;
  weightB?: number;
  condA?: { answer_id?: string; tag?: string };
  condB?: { answer_id?: string; tag?: string };
}) {
  return Quiz.parse({
    quiz_id: "bq",
    scope: { collection_ids: [] },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Hi" },
      },
      {
        id: "q1",
        type: "question",
        position: { x: 100, y: 0 },
        data: {
          text: "?",
          question_type: "single_select",
          answers: [
            { id: "ans-oily", text: "Oily", tags: ["oily"], edge_handle_id: "ho" },
            { id: "ans-dry", text: "Dry", tags: ["dry"], edge_handle_id: "hd" },
          ],
        },
      },
      {
        id: "br1",
        type: "branch",
        position: { x: 200, y: 0 },
        data: {
          label: "Skin route",
          mode: opts.mode,
          slots: [
            { id: "slot-a", label: "A", weight: opts.weightA ?? 1 },
            { id: "slot-b", label: "B", weight: opts.weightB ?? 1 },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 300, y: 0 },
        data: { headline: "Oily kit", fallback_collection_id: "c1" },
      },
      {
        id: "r2",
        type: "result",
        position: { x: 300, y: 100 },
        data: { headline: "Dry kit", fallback_collection_id: "c1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "br1" },
      {
        id: "e3",
        source: "br1",
        target: "r1",
        source_handle: "slot-a",
        ...(opts.condA ? { condition: opts.condA } : {}),
      },
      {
        id: "e4",
        source: "br1",
        target: "r2",
        source_handle: "slot-b",
        ...(opts.condB ? { condition: opts.condB } : {}),
      },
    ],
    results_pages: [],
  });
}

function emptyCtx(): BranchContext {
  return {
    selectedAnswerIds: new Set(),
    accumulatedTags: new Set(),
    abAssignments: {},
  };
}

describe("Branch routing", () => {
  it("rules mode: picks the slot whose answer_id condition matches", () => {
    const q = branchQuiz({
      mode: "rules",
      condA: { answer_id: "ans-oily" },
      condB: { answer_id: "ans-dry" },
    });
    const ctx = emptyCtx();
    ctx.selectedAnswerIds.add("ans-oily");
    expect(pickBranchSlot(q, "br1", ctx)).toBe("slot-a");
    ctx.selectedAnswerIds.clear();
    ctx.selectedAnswerIds.add("ans-dry");
    expect(pickBranchSlot(q, "br1", ctx)).toBe("slot-b");
  });

  it("rules mode: picks the slot whose tag condition matches", () => {
    const q = branchQuiz({
      mode: "rules",
      condA: { tag: "oily" },
      condB: { tag: "dry" },
    });
    const ctx = emptyCtx();
    ctx.accumulatedTags.add("dry");
    expect(pickBranchSlot(q, "br1", ctx)).toBe("slot-b");
  });

  it("rules mode: falls back to first unconditional slot when nothing matches", () => {
    const q = branchQuiz({
      mode: "rules",
      condA: { tag: "missing" },
      // condB undefined → unconditional fallback
    });
    expect(pickBranchSlot(q, "br1", emptyCtx())).toBe("slot-b");
  });

  it("ab_split: stable across re-rolls thanks to sticky assignments", () => {
    const q = branchQuiz({ mode: "ab_split", weightA: 1, weightB: 1 });
    const ctx = emptyCtx();
    ctx.rand = () => 0.1; // would roll A on first call
    const first = pickBranchSlot(q, "br1", ctx);
    expect(first).toBe("slot-a");
    expect(ctx.abAssignments.br1).toBe("slot-a");
    // Even if a later call would roll B, the sticky assignment holds.
    ctx.rand = () => 0.99;
    const second = pickBranchSlot(q, "br1", ctx);
    expect(second).toBe("slot-a");
  });

  it("ab_split: weights skew the roll", () => {
    const q = branchQuiz({ mode: "ab_split", weightA: 9, weightB: 1 });
    // 0.85 * 10 = 8.5 → still inside slot A range (0..9)
    const ctxA = emptyCtx();
    ctxA.rand = () => 0.85;
    expect(pickBranchSlot(q, "br1", ctxA)).toBe("slot-a");
    // 0.95 * 10 = 9.5 → slot B
    const ctxB = emptyCtx();
    ctxB.rand = () => 0.95;
    expect(pickBranchSlot(q, "br1", ctxB)).toBe("slot-b");
  });

  it("resolveNextStep auto-advances through a branch to the target", () => {
    const q = branchQuiz({
      mode: "rules",
      condA: { tag: "oily" },
      condB: { tag: "dry" },
    });
    const ctx = emptyCtx();
    ctx.accumulatedTags.add("oily");
    // After q1, the next renderable step should skip the branch and land on r1.
    expect(resolveNextStep(q, "q1", null, ctx)).toBe("r1");
  });

  it("resolveNextStep returns the target directly when no branch in the way", () => {
    const q = branchQuiz({ mode: "rules" });
    expect(resolveNextStep(q, "intro", null, emptyCtx())).toBe("q1");
  });
});

describe("recommendForStage — multi-stage results", () => {
  function stageQuiz(stages: Array<Record<string, unknown>>) {
    return Quiz.parse({
      quiz_id: "sq",
      scope: { collection_ids: ["c-cleansers"] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 200, y: 0 },
          data: {
            text: "?",
            question_type: "single_select",
            answers: [
              { id: "a-oily", text: "Oily", tags: ["oily"], edge_handle_id: "h1" },
              { id: "a-dry", text: "Dry", tags: ["dry"], edge_handle_id: "h2" },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 400, y: 0 },
          data: { headline: "Match", fallback_collection_id: "c-cleansers", stages },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
      results_pages: [{ id: "r1", headline: "Match", product_ids: [] }],
    });
  }

  it("resolves a stage's own ladder independently of the page", () => {
    const quiz = stageQuiz([
      { id: "s1", headline: "Cleansers", match_ladder: ["tag"], min_products: 1, max_products: 2 },
    ]);
    const stage = quiz.nodes.find((n) => n.id === "r1")!;
    const stageData = stage.type === "result" ? stage.data.stages[0]! : undefined;
    const out = recommendForStage(
      quiz,
      baseProducts,
      ["a-oily"],
      "r1",
      stageData!,
    );
    // tag "oily" → p1/p4/p5; capped at 2.
    expect(out.length).toBe(2);
    expect(out.every((p) => p.tags.includes("oily"))).toBe(true);
  });

  it("returns empty for a stage with no matches and no fallback", () => {
    const quiz = stageQuiz([
      { id: "s1", headline: "X", match_ladder: ["collection"], collection_id: "c-none", min_products: 1, max_products: 3 },
    ]);
    const stage = quiz.nodes.find((n) => n.id === "r1")!;
    const stageData = stage.type === "result" ? stage.data.stages[0]! : undefined;
    const out = recommendForStage(quiz, baseProducts, [], "r1", stageData!);
    expect(out).toEqual([]);
  });
});
