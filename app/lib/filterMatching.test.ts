import { describe, expect, it } from "vitest";
import {
  answerFilterValues,
  filterAnswerMatchCount,
  narrowIdsByFilters,
} from "./filterMatching";
import type { IndexedProduct } from "./recommendationEngine";

// QZY-1 (quiz-logic spec §3/§5/§7/§8) — the "Filters results" stage.

const P = (id: string, tags: string[], collections: string[] = []): IndexedProduct => ({
  product_id: id,
  title: id,
  handle: id,
  price: "10",
  image_url: null,
  tags,
  collection_ids: collections,
  inventory_in_stock: true,
});

const products = [
  P("p1", ["Soft", "wide"]),
  P("p2", ["stiff", "wide"]),
  P("p3", ["soft", "narrow"], ["c-sale"]),
  P("p4", [], ["c-sale"]),
];
const byId = new Map(products.map((p) => [p.product_id, p]));
const allIds = products.map((p) => p.product_id);

const answer = (id: string, tags: string[], extra: Record<string, unknown> = {}) => ({
  id,
  text: id,
  tags,
  edge_handle_id: `h_${id}`,
  ...extra,
});

const filterQ = (id: string, answers: ReturnType<typeof answer>[]) => ({
  id,
  type: "question" as const,
  data: {
    text: `Q ${id}`,
    question_type: "single_select",
    role: "filter",
    answers,
  },
});

describe("answerFilterValues (§5 pass-through states)", () => {
  it("no_preference is a first-class pass-through even with tags present", () => {
    expect(answerFilterValues(answer("a", ["soft"], { no_preference: true }) as never)).toBeNull();
  });
  it("valueless answers pass through (never narrow-to-zero by accident)", () => {
    expect(answerFilterValues(answer("a", []) as never)).toBeNull();
    expect(answerFilterValues(answer("a", ["  "]) as never)).toBeNull();
  });
  it("lowercases tag values (Shopify tags are mixed-case)", () => {
    expect(answerFilterValues(answer("a", ["SoFt"]) as never)).toEqual({
      tags: ["soft"],
      collectionId: null,
    });
  });
});

describe("filterAnswerMatchCount (§5 live counts)", () => {
  it("counts case-insensitively across the index", () => {
    expect(filterAnswerMatchCount(answer("a", ["soft"]) as never, products)).toBe(2); // p1 (Soft) + p3
  });
  it("returns null (not 0) for pass-through answers", () => {
    expect(filterAnswerMatchCount(answer("a", []) as never, products)).toBeNull();
  });
  it("0 = a dead end (§5 blocking state)", () => {
    expect(filterAnswerMatchCount(answer("a", ["velvet"]) as never, products)).toBe(0);
  });
  it("collection_filter matches by membership", () => {
    expect(
      filterAnswerMatchCount(answer("a", [], { collection_filter: "c-sale" }) as never, products),
    ).toBe(2); // p3 + p4
  });
});

describe("narrowIdsByFilters (§7 intersection · §1 path-aware)", () => {
  it("AND across questions, OR within a question's selected answers", () => {
    const doc = {
      nodes: [
        filterQ("q1", [answer("a-soft", ["soft"]), answer("a-stiff", ["stiff"])]),
        filterQ("q2", [answer("a-wide", ["wide"]), answer("a-narrow", ["narrow"])]),
      ],
    };
    // soft AND wide → p1 only
    expect(narrowIdsByFilters(allIds, byId, doc as never, ["a-soft", "a-wide"]).ids).toEqual(["p1"]);
    // (soft OR stiff) AND wide → p1, p2
    expect(
      narrowIdsByFilters(allIds, byId, doc as never, ["a-soft", "a-stiff", "a-wide"]).ids,
    ).toEqual(["p1", "p2"]);
  });

  it("a filter the shopper never saw contributes nothing (§1 acceptance)", () => {
    const doc = {
      nodes: [
        filterQ("q1", [answer("a-soft", ["soft"])]),
        filterQ("q2", [answer("a-narrow", ["narrow"])]), // skipped on this path
      ],
    };
    const r = narrowIdsByFilters(allIds, byId, doc as never, ["a-soft"]);
    expect(r.ids).toEqual(["p1", "p3"]);
    expect(r.applied.map((a) => a.questionId)).toEqual(["q1"]);
  });

  it("no_preference selection passes through and clears the constraint (§5)", () => {
    const doc = {
      nodes: [
        filterQ("q1", [answer("a-np", ["soft"], { no_preference: true })]),
      ],
    };
    const r = narrowIdsByFilters(allIds, byId, doc as never, ["a-np"]);
    expect(r.ids).toEqual(allIds);
    expect(r.applied).toEqual([]);
    expect(r.zeroAfterFilters).toBe(false);
  });

  it("zeroAfterFilters flags the §8 empty case", () => {
    const doc = { nodes: [filterQ("q1", [answer("a-velvet", ["velvet"])])] };
    const r = narrowIdsByFilters(allIds, byId, doc as never, ["a-velvet"]);
    expect(r.ids).toEqual([]);
    expect(r.zeroAfterFilters).toBe(true);
  });

  it("order of the surviving ids is preserved (it IS collection_order)", () => {
    const doc = { nodes: [filterQ("q1", [answer("a-wide", ["wide"])])] };
    expect(narrowIdsByFilters(["p2", "p1"], byId, doc as never, ["a-wide"]).ids).toEqual([
      "p2",
      "p1",
    ]);
  });

  it("docs with no filter roles narrow nothing (dual-model byte-safety)", () => {
    const doc = {
      nodes: [
        {
          id: "q1",
          type: "question" as const,
          data: {
            text: "Q",
            question_type: "single_select",
            role: "qualifier",
            answers: [answer("a1", ["soft"])],
          },
        },
      ],
    };
    const r = narrowIdsByFilters(allIds, byId, doc as never, ["a1"]);
    expect(r.ids).toEqual(allIds);
    expect(r.applied).toEqual([]);
  });
});
