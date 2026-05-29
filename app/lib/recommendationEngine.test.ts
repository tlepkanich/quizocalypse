import { describe, expect, it } from "vitest";
import {
  pickBranchSlot,
  recommendForResult,
  recommendPreview,
  resolveNextStep,
  nextNodeFor,
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
  recommendation_logic: [],
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
