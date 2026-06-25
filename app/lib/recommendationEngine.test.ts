import { describe, expect, it } from "vitest";
import {
  pickBranchSlot,
  pickPointsWinner,
  recommendForResult,
  recommendForStage,
  recommendForResultExplained,
  recommendForStageExplained,
  recommendPreview,
  resolveNextStep,
  nextNodeFor,
  isSellable,
  selectSecondaryRecs,
  type BranchContext,
  type IndexedProduct,
  type RecommendedProduct,
} from "./recommendationEngine";
import { Quiz, type QuizNode } from "./quizSchema";

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

  it("shows NO products when nothing fits the answers (no generic fallback)", () => {
    const result = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: [], // no answers → no tags → the tag rung resolves nothing
      resultNodeId: "r1",
    });
    // Operator goal: if no rung resolves a real bucket, give NO results — never
    // pad the page with an unrelated fallback collection.
    expect(result).toHaveLength(0);
  });

  it("a matching path returns ONLY the products that fit (not the whole fallback collection)", () => {
    // Picking "Dry" must surface the dry product alone — never flood the page
    // with the rest of c-cleansers just because a fallback collection is set.
    const result = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-dry"],
      resultNodeId: "r1",
    });
    expect(result.map((r) => r.product_id)).toEqual(["p2"]);
  });

  it("an answer whose tags match no product → empty, even with a fallback collection set", () => {
    const products: IndexedProduct[] = [
      { product_id: "px", title: "Powder Board", handle: "px", price: "100", image_url: null, tags: ["powder"], collection_ids: ["all"], inventory_in_stock: true },
      { product_id: "py", title: "Park Board", handle: "py", price: "100", image_url: null, tags: ["park"], collection_ids: ["all"], inventory_in_stock: true },
    ];
    const quiz = Quiz.parse({
      quiz_id: "qt",
      status: "draft",
      scope: { collection_ids: ["all"] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Where do you ride?",
            question_type: "single_select",
            answers: [
              { id: "a-powder", text: "Powder", tags: ["powder"], edge_handle_id: "h1" },
              { id: "a-race", text: "Racing", tags: ["race"], edge_handle_id: "h2" }, // no product carries "race"
            ],
          },
        },
        { id: "r1", type: "result", position: { x: 2, y: 0 }, data: { headline: "Match", fallback_collection_id: "all" } },
      ],
      edges: [
        { id: "e0", source: "intro", target: "q1" },
        { id: "e1", source: "q1", target: "r1" },
      ],
    });
    // A fitting answer → only the fitting product.
    expect(
      recommendForResult({ quiz, productIndex: products, selectedAnswerIds: ["a-powder"], resultNodeId: "r1" }).map((p) => p.product_id),
    ).toEqual(["px"]);
    // A non-fitting answer → nothing, despite fallback_collection_id "all".
    expect(
      recommendForResult({ quiz, productIndex: products, selectedAnswerIds: ["a-race"], resultNodeId: "r1" }),
    ).toHaveLength(0);
  });

  it("matches tags case-insensitively (answer 'acne' fits a product tagged 'Acne')", () => {
    // Shopify product tags are authored with inconsistent case; an answer tag
    // must still match or it silently scores nothing.
    const products: IndexedProduct[] = [
      { product_id: "pc", title: "Clarifying Serum", handle: "pc", price: "40", image_url: null, tags: ["Acne", "Oil-Control"], collection_ids: ["c"], inventory_in_stock: true },
      { product_id: "pd", title: "Rich Cream", handle: "pd", price: "40", image_url: null, tags: ["Dry"], collection_ids: ["c"], inventory_in_stock: true },
    ];
    const quiz = Quiz.parse({
      quiz_id: "qc",
      status: "draft",
      scope: { collection_ids: ["c"] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Main concern?",
            question_type: "single_select",
            answers: [
              { id: "a-acne", text: "Breakouts", tags: ["acne"], edge_handle_id: "h1" }, // lowercase
              { id: "a-dry", text: "Dryness", tags: ["dry"], edge_handle_id: "h2" },
            ],
          },
        },
        { id: "r1", type: "result", position: { x: 2, y: 0 }, data: { headline: "Match", fallback_collection_id: "c" } },
      ],
      edges: [
        { id: "e0", source: "intro", target: "q1" },
        { id: "e1", source: "q1", target: "r1" },
      ],
    });
    const exp = recommendForResultExplained({ quiz, productIndex: products, selectedAnswerIds: ["a-acne"], resultNodeId: "r1" });
    // The "Acne"-tagged product matches the lowercase "acne" answer tag.
    expect(exp.products.map((p) => p.product_id)).toEqual(["pc"]);
    expect(exp.products[0]!.score).toBeGreaterThan(0);
    // matched_tags preserves the product's ORIGINAL case for display.
    expect(exp.products[0]!.matched_tags).toContain("Acne");
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

  it("the just-selected answer must be in the context to route the branch (runtime threads it)", () => {
    // Contract behind the QuizRuntime fix: when a shopper answers a question
    // whose NEXT node is a conditional branch, the branch must see the answer
    // they JUST picked. resolveNextStep walks q1 → branch → result.
    const q = branchQuiz({
      mode: "rules",
      condA: { answer_id: "ans-oily" },
      condB: { answer_id: "ans-dry" },
    });
    // Fresh context (the picked answer IS recorded) → routes to the Dry result.
    const fresh = emptyCtx();
    fresh.selectedAnswerIds.add("ans-dry");
    expect(resolveNextStep(q, "q1", "hd", fresh)).toBe("r2");
    // Stale context (the bug: setPath is async, so the answer isn't in `path`
    // yet) cannot match either conditional slot → it never reaches "r2".
    expect(resolveNextStep(q, "q1", "hd", emptyCtx())).not.toBe("r2");
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

// A points-mode branch: two questions seed per-answer category points, the
// branch routes to the slot whose `points_category` wins the tally (argmax),
// with an unconditioned default catch-all when nothing scored.
function pointsBranchQuiz() {
  return Quiz.parse({
    quiz_id: "pbq",
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
            { id: "a-x", text: "X", tags: [], edge_handle_id: "hx", points: { "cat-x": 1 } },
            { id: "a-y", text: "Y", tags: [], edge_handle_id: "hy", points: { "cat-y": 1 } },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 150, y: 0 },
        data: {
          text: "??",
          question_type: "single_select",
          answers: [
            { id: "b-x", text: "X", tags: [], edge_handle_id: "hbx", points: { "cat-x": 1 } },
            { id: "b-y", text: "Y", tags: [], edge_handle_id: "hby", points: { "cat-y": 1 } },
          ],
        },
      },
      {
        id: "br1",
        type: "branch",
        position: { x: 200, y: 0 },
        data: {
          label: "Best match",
          mode: "points",
          slots: [
            { id: "slot-x", label: "X", weight: 1 },
            { id: "slot-y", label: "Y", weight: 1 },
            { id: "slot-def", label: "Other", weight: 1 },
          ],
        },
      },
      { id: "rx", type: "result", position: { x: 300, y: 0 }, data: { headline: "X kit", fallback_collection_id: "c1" } },
      { id: "ry", type: "result", position: { x: 300, y: 100 }, data: { headline: "Y kit", fallback_collection_id: "c1" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "br1" },
      { id: "e4", source: "br1", target: "rx", source_handle: "slot-x", condition: { points_category: "cat-x" } },
      { id: "e5", source: "br1", target: "ry", source_handle: "slot-y", condition: { points_category: "cat-y" } },
      { id: "e6", source: "br1", target: "rx", source_handle: "slot-def" },
    ],
    results_pages: [],
  });
}

describe("Branch routing — points mode (plurality)", () => {
  it("routes to the slot whose points_category wins the tally", () => {
    const q = pointsBranchQuiz();
    const ctxX = emptyCtx();
    ctxX.selectedAnswerIds = new Set(["a-x", "b-x"]); // cat-x: 2, cat-y: 0
    expect(pickBranchSlot(q, "br1", ctxX)).toBe("slot-x");

    const ctxY = emptyCtx();
    ctxY.selectedAnswerIds = new Set(["a-y", "b-y"]); // cat-y: 2
    expect(pickBranchSlot(q, "br1", ctxY)).toBe("slot-y");
  });

  it("ties resolve by the engine's first-seen winner (earliest-picked)", () => {
    const q = pointsBranchQuiz();
    const ctx = emptyCtx();
    ctx.selectedAnswerIds = new Set(["a-x", "b-y"]); // 1–1 tie; a-x seen first → cat-x
    expect(pickBranchSlot(q, "br1", ctx)).toBe("slot-x");
  });

  it("falls back to the unconditioned default slot when nothing scored", () => {
    const q = pointsBranchQuiz();
    expect(pickBranchSlot(q, "br1", emptyCtx())).toBe("slot-def");
  });

  it("resolveNextStep auto-advances a points branch to the winner's page", () => {
    const q = pointsBranchQuiz();
    const ctx = emptyCtx();
    ctx.selectedAnswerIds = new Set(["a-y", "b-y"]);
    expect(resolveNextStep(q, "q2", null, ctx)).toBe("ry");
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

describe("selectSecondaryRecs (diversity-aware)", () => {
  const mk = (
    id: string,
    tags: string[],
    extra: Partial<RecommendedProduct> = {},
  ): RecommendedProduct => ({
    product_id: id,
    title: id,
    handle: id,
    price: "10.00",
    image_url: null,
    tags,
    collection_ids: [],
    inventory_in_stock: true,
    score: 0,
    ...extra,
  });

  it("excludes products already shown in primary", () => {
    const primary = [mk("p1", ["a"])];
    const pool = [mk("p1", ["a"]), mk("p2", ["b"]), mk("p3", ["c"])];
    const ids = selectSecondaryRecs(primary, pool, 2).map((p) => p.product_id);
    expect(ids).not.toContain("p1");
    expect(ids).toHaveLength(2);
  });

  it("prefers low tag-overlap with the primary set (genuine alternatives)", () => {
    const primary = [mk("p1", ["sporty", "blue"])];
    const pool = [
      mk("hi", ["sporty", "blue"]), // overlap 1.0
      mk("lo", ["formal", "black"]), // overlap 0.0
      mk("mid", ["sporty", "red"]), // overlap 0.5
    ];
    expect(selectSecondaryRecs(primary, pool, 2).map((p) => p.product_id)).toEqual([
      "lo",
      "mid",
    ]);
  });

  it("breaks overlap ties by incoming pool rank (stable sort)", () => {
    const primary = [mk("p1", ["x"])];
    // all zero-overlap → keep the pre-ranked best→worst order
    const pool = [mk("first", ["a"]), mk("second", ["b"]), mk("third", ["c"])];
    expect(selectSecondaryRecs(primary, pool, 2).map((p) => p.product_id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("keeps OOS candidates the pool already includes (pool reflects oos_behavior)", () => {
    // The pool is OOS-treated upstream by applyOos: under `hide` it has no OOS;
    // under `show_with_badge` it keeps them. An OOS product reaching here means
    // the result wants it shown (with a badge), so secondary must NOT re-drop it
    // — else the "you might also like" row empties while primary shows the item.
    const primary = [mk("p1", ["a"])];
    const pool = [mk("oos", ["z"], { inventory_in_stock: false }), mk("ok", ["y"])];
    expect(selectSecondaryRecs(primary, pool, 2).map((p) => p.product_id)).toEqual([
      "oos",
      "ok",
    ]);
  });

  it("does not mutate the input pool", () => {
    const primary = [mk("p1", ["a"])];
    const pool = [mk("b", ["sporty", "blue"]), mk("a", ["formal"])];
    const before = pool.map((p) => p.product_id);
    selectSecondaryRecs(primary, pool, 2);
    expect(pool.map((p) => p.product_id)).toEqual(before);
  });
});

describe("answer weights (Phase J)", () => {
  it("absent/empty weights reproduce classic flat scoring exactly", () => {
    const classic = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    const neutral = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
      answerWeights: {},
    });
    expect(neutral.map((r) => [r.product_id, r.score])).toEqual(
      classic.map((r) => [r.product_id, r.score]),
    );
  });

  it("a converting answer's weight scales its tags' contribution", () => {
    const weighted = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
      answerWeights: { "a-oily": 2 },
    });
    const classic = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily"],
      resultNodeId: "r1",
    });
    // Same single answer selected → ORDER unchanged, but every tag now counts
    // double (p1's 2 matches → 4).
    expect(weighted.map((r) => r.product_id)).toEqual(classic.map((r) => r.product_id));
    expect(weighted[0]!.score).toBe(classic[0]!.score * 2);
  });

  it("weights can flip the ranking between two answers' product affinities", () => {
    // Select BOTH answers: p1 matches a-oily's tags, p2 matches a-dry's.
    const neutral = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily", "a-dry"],
      resultNodeId: "r1",
    });
    const boosted = recommendForResult({
      quiz: quizDoc,
      productIndex: baseProducts,
      selectedAnswerIds: ["a-oily", "a-dry"],
      resultNodeId: "r1",
      answerWeights: { "a-dry": 2, "a-oily": 0.5 },
    });
    // With a-dry's tags doubled and a-oily's halved, the dry-skin product must
    // outrank whatever led neutrally (or at minimum the scores must diverge).
    expect(boosted.map((r) => r.product_id)).not.toEqual(neutral.map((r) => r.product_id));
  });
});

// ─── Design refinement D1: answers order EVERY rung ─────────────────────────
// Eligibility (which products are candidates) stays with the rung; ordering
// belongs to the path's answers. Under max_products caps that changes which
// top-N render — "the logic actually changes results".
describe("answer-ordered rungs + explained API (D1)", () => {
  const P = (
    id: string,
    tags: string[],
    price: string,
    extra: Partial<IndexedProduct> = {},
  ): IndexedProduct => ({
    product_id: id,
    title: id,
    handle: id,
    price,
    image_url: null,
    tags,
    collection_ids: ["c-all"],
    inventory_in_stock: true,
    ...extra,
  });
  // One bucket of four: two oily, one dry, one both, one untagged.
  const bucket = [
    P("pA", ["oily"], "30.00"),
    P("pB", ["dry"], "10.00"),
    P("pC", ["oily", "dry"], "20.00"),
    P("pD", [], "5.00"),
  ];
  const catQuiz = (resultData: Record<string, unknown> = {}) =>
    Quiz.parse({
      quiz_id: "d1",
      scope: { collection_ids: ["c-all"] },
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
          data: {
            headline: "Match",
            match_ladder: ["category"],
            category_id: "cat-x",
            max_products: 2,
            fallback_collection_id: "c-none",
            ...resultData,
          },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
      results_pages: [
        {
          id: "r1",
          headline: "Match",
          product_ids: [],
          category_id: "cat-x",
          category_product_ids_map: { "cat-x": ["pA", "pB", "pC", "pD"] },
        },
      ],
    });

  it("(a) same node + category ladder: two paths → DIFFERENT top-N", () => {
    const quiz = catQuiz();
    const oily = recommendForResult({ quiz, productIndex: bucket, selectedAnswerIds: ["a-oily"], resultNodeId: "r1" });
    const dry = recommendForResult({ quiz, productIndex: bucket, selectedAnswerIds: ["a-dry"], resultNodeId: "r1" });
    // oily path: pA/pC score 1 (price tie-break: pC $20 < pA $30) → [pC, pA]
    expect(oily.map((p) => p.product_id)).toEqual(["pC", "pA"]);
    // dry path: pB/pC score 1 → [pB, pC] — the user's complaint, fixed.
    expect(dry.map((p) => p.product_id)).toEqual(["pB", "pC"]);
  });

  it("(b) explicit ranking still wins within the pool", () => {
    const dated = bucket.map((p) =>
      p.product_id === "pB" ? { ...p, updated_at: "2026-06-01T00:00:00Z" } : { ...p, updated_at: "2025-01-01T00:00:00Z" },
    );
    const quiz = catQuiz({ ranking: "newest" });
    const out = recommendForResult({ quiz, productIndex: dated, selectedAnswerIds: ["a-oily"], resultNodeId: "r1" });
    expect(out[0]!.product_id).toBe("pB"); // newest first despite score 0
  });

  it("(c+e) zero-overlap pool: nothing dropped, order = in-stock → price asc (pre-D1 byte-identical)", () => {
    const quiz = catQuiz({ max_products: 10 });
    const out = recommendForResult({ quiz, productIndex: bucket, selectedAnswerIds: [], resultNodeId: "r1" });
    expect(out.map((p) => p.product_id)).toEqual(["pD", "pB", "pC", "pA"]); // price asc
    expect(out).toHaveLength(4); // score-0 items retained — membership invariant
  });

  it("(d) answerWeights reorder within a category pool (Phase J alive on fixed rungs)", () => {
    const quiz = catQuiz({ max_products: 10 });
    const both = { quiz, productIndex: bucket, selectedAnswerIds: ["a-oily", "a-dry"], resultNodeId: "r1" };
    const flat = recommendForResult(both);
    const weighted = recommendForResult({ ...both, answerWeights: { "a-oily": 2 } });
    // flat: pC(2) → pB(1,$10) → pA(1,$30); weighted: oily=2 → pC(3) → pA(2) → pB(1)
    expect(flat.map((p) => p.product_id).indexOf("pB")).toBeLessThan(flat.map((p) => p.product_id).indexOf("pA"));
    expect(weighted.map((p) => p.product_id).indexOf("pA")).toBeLessThan(weighted.map((p) => p.product_id).indexOf("pB"));
  });

  it("(f) explained shape + delegation invariant + no generic fallback", () => {
    const quiz = catQuiz();
    const explained = recommendForResultExplained({ quiz, productIndex: bucket, selectedAnswerIds: ["a-oily"], resultNodeId: "r1" });
    expect(explained.rungUsed).toBe("category");
    expect(explained.poolSize).toBe(4); // pre-cap — fixed-rung membership keeps score-0 members
    expect(explained.products[0]!.matched_tags).toEqual(["oily"]);
    expect(explained.tagBag).toEqual({ oily: 1 });
    expect(
      recommendForResult({ quiz, productIndex: bucket, selectedAnswerIds: ["a-oily"], resultNodeId: "r1" }),
    ).toEqual(explained.products);

    // A ladder that resolves nothing + a configured fallback collection now
    // returns EMPTY — the generic fallback_collection_id is intentionally ignored
    // (operator goal: no fit → no results).
    const fbQuiz = catQuiz({ match_ladder: ["conditional"], conditional_rules: [], fallback_collection_id: "c-all" });
    const fb = recommendForResultExplained({ quiz: fbQuiz, productIndex: bucket, selectedAnswerIds: ["a-oily"], resultNodeId: "r1" });
    expect(fb.rungUsed).toBeNull();
    expect(fb.products).toHaveLength(0);
  });

  it("(g) recommendForStageExplained honors weights", () => {
    const quiz = catQuiz({
      stages: [
        {
          id: "st1",
          headline: "Stage",
          match_ladder: ["category"],
          category_id: "cat-x",
          max_products: 10,
        },
      ],
    });
    const stage = (quiz.nodes.find((n) => n.id === "r1") as Extract<QuizNode, { type: "result" }>).data.stages[0]!;
    const flat = recommendForStageExplained(quiz, bucket, ["a-oily", "a-dry"], "r1", stage);
    const weighted = recommendForStageExplained(quiz, bucket, ["a-oily", "a-dry"], "r1", stage, { "a-oily": 2 });
    expect(weighted.products[1]!.product_id).toBe("pA"); // oily ×2 outranks dry
    expect(flat.products[1]!.product_id).toBe("pB");
    expect(weighted.rungUsed).toBe("category");
  });
});

// Rec-Page spec §1 — full sort-order set + per-section sub-filter. These sit on
// top of a fixed collection rung (membership is the collection), so the sort /
// sub-filter is exercised independently of tag relevance.
describe("recommendForResult — sort order + sub-filter (Rec-Page spec §1)", () => {
  const sortProducts: IndexedProduct[] = [
    {
      product_id: "s1",
      title: "Zebra",
      handle: "zebra",
      price: "30.00",
      image_url: null,
      tags: ["toner"],
      collection_ids: ["c-sort", "c-toner"],
      inventory_in_stock: true,
      updated_at: "2024-01-03T00:00:00Z",
    },
    {
      product_id: "s2",
      title: "Apple",
      handle: "apple",
      price: "10.00",
      image_url: null,
      tags: ["moist"],
      collection_ids: ["c-sort", "c-moist"],
      inventory_in_stock: true,
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      product_id: "s3",
      title: "Mango",
      handle: "mango",
      price: "20.00",
      image_url: null,
      tags: ["toner"],
      collection_ids: ["c-sort", "c-toner"],
      inventory_in_stock: true,
      updated_at: "2024-01-02T00:00:00Z",
    },
  ];

  function sortQuiz(resultData: Record<string, unknown>) {
    return Quiz.parse({
      quiz_id: "sq",
      scope: { collection_ids: ["c-sort"] },
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
              { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 400, y: 0 },
          data: {
            headline: "Match",
            fallback_collection_id: "c-sort",
            match_ladder: ["collection"],
            collection_id: "c-sort",
            max_products: 10,
            ...resultData,
          },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
      results_pages: [{ id: "r1", headline: "Match", product_ids: [] }],
    });
  }

  const idsFor = (resultData: Record<string, unknown>) =>
    recommendForResult({
      quiz: sortQuiz(resultData),
      productIndex: sortProducts,
      selectedAnswerIds: ["a1"],
      resultNodeId: "r1",
    }).map((p) => p.product_id);

  it("price_asc sorts cheapest first", () => {
    expect(idsFor({ ranking: "price_asc" })).toEqual(["s2", "s3", "s1"]);
  });

  it("price_desc sorts priciest first", () => {
    expect(idsFor({ ranking: "price_desc" })).toEqual(["s1", "s3", "s2"]);
  });

  it("title_az / title_za sort alphabetically", () => {
    expect(idsFor({ ranking: "title_az" })).toEqual(["s2", "s3", "s1"]);
    expect(idsFor({ ranking: "title_za" })).toEqual(["s1", "s3", "s2"]);
  });

  it("manual keeps the resolved pool order untouched", () => {
    expect(idsFor({ ranking: "manual" })).toEqual(["s1", "s2", "s3"]);
  });

  it("sub_filter_tag narrows the section to products that also carry the tag", () => {
    // Only the two "toner" products survive; price_asc orders them.
    expect(idsFor({ ranking: "price_asc", sub_filter_tag: "toner" })).toEqual(["s3", "s1"]);
  });

  it("sub_filter_collection_id narrows to that collection within the bucket", () => {
    expect(idsFor({ sub_filter_collection_id: "c-moist" })).toEqual(["s2"]);
  });

  it("sub_filter_tag is case-insensitive", () => {
    expect(idsFor({ sub_filter_tag: "TONER", ranking: "title_az" })).toEqual(["s3", "s1"]);
  });

  it("both sub-filters set require the intersection", () => {
    // tag=toner AND collection=c-moist → no product satisfies both.
    expect(idsFor({ sub_filter_tag: "toner", sub_filter_collection_id: "c-moist" })).toEqual([]);
  });
});
