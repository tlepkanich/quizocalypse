import { describe, expect, it } from "vitest";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { QuizNode } from "../../lib/quizSchema";
import { resolvePreviewProducts, type PreviewCategory } from "./StepPreview";

const prod = (id: string, collections: string[] = []): IndexedProduct => ({
  product_id: id,
  title: id,
  handle: id,
  price: "10",
  image_url: null,
  tags: [],
  collection_ids: collections,
  inventory_in_stock: true,
});

const index = [prod("p1"), prod("p2", ["col_a"]), prod("p3", ["col_a"]), prod("p4")];

function resultNode(data: Record<string, unknown>): QuizNode {
  return {
    id: "r1",
    type: "result",
    position: { x: 0, y: 0 },
    data: {
      headline: "R",
      subtext: "",
      slot_count: 3,
      cta_label: "Shop",
      fallback_collection_id: "c",
      match_ladder: ["category"],
      conditional_rules: [],
      ranking: "relevance",
      min_products: 1,
      oos_behavior: "show_with_badge",
      include_discount: false,
      subscription_eligible: false,
      stages: [],
      ...data,
    },
  } as unknown as QuizNode;
}

const cats: PreviewCategory[] = [{ id: "cat1", productIds: ["p1", "p4"] }];

describe("resolvePreviewProducts", () => {
  it("returns the bound bucket's products (category_id → productIds)", () => {
    const pool = resolvePreviewProducts(resultNode({ category_id: "cat1" }), index, cats);
    expect(pool.map((p) => p.product_id)).toEqual(["p1", "p4"]);
  });

  it("falls back to a bound collection when no category", () => {
    const pool = resolvePreviewProducts(resultNode({ collection_id: "col_a" }), index, cats);
    expect(pool.map((p) => p.product_id)).toEqual(["p2", "p3"]);
  });

  it("uses an explicit conditional rule's product_ids", () => {
    const pool = resolvePreviewProducts(
      resultNode({ conditional_rules: [{ all_of: [], any_of: [], product_ids: ["p3"] }] }),
      index,
      cats,
    );
    expect(pool.map((p) => p.product_id)).toEqual(["p3"]);
  });

  it("prefers category over collection", () => {
    const pool = resolvePreviewProducts(
      resultNode({ category_id: "cat1", collection_id: "col_a" }),
      index,
      cats,
    );
    expect(pool.map((p) => p.product_id)).toEqual(["p1", "p4"]);
  });

  it("falls through to the whole catalog when nothing resolves", () => {
    // category whose productIds aren't in the index → empty → fall through
    const pool = resolvePreviewProducts(
      resultNode({ category_id: "cat1" }),
      index,
      [{ id: "cat1", productIds: ["missing"] }],
    );
    expect(pool).toEqual(index);
  });

  it("returns the whole catalog for an unbound result", () => {
    expect(resolvePreviewProducts(resultNode({}), index, cats)).toEqual(index);
  });
});
