import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  collectReferencedCategoryIds,
  bakeResultPages,
  collectRecommendableProductIds,
} from "./quizPublish";
import { recommendForResult, type IndexedProduct } from "./recommendationEngine";

// A v3 quiz: result data lives on result NODES, results_pages is empty. This is
// what reconcile / Smart Build / templates / AI onboarding all produce.
function v3Doc(ladder: string[] = ["category"]) {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Pick",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "r_dry",
        type: "result",
        position: { x: 2, y: 0 },
        data: {
          headline: "Dry skin picks",
          fallback_collection_id: "gid://shopify/Collection/fallback",
          category_id: "cat_dry",
          match_ladder: ladder,
        },
      },
    ],
    edges: [{ id: "e1", source: "intro", target: "q1" }],
  });
}

function product(id: string, collection: string): IndexedProduct {
  return {
    product_id: id,
    title: id,
    handle: id,
    price: "10.00",
    image_url: null,
    tags: [],
    collection_ids: [collection],
    inventory_in_stock: true,
  };
}

// The bucket's products live in a different collection from the fallback. The
// fallback collection is the "all snowboards" pool.
const INDEX: IndexedProduct[] = [
  product("p_cream", "gid://shopify/Collection/skincare"),
  product("p_serum", "gid://shopify/Collection/skincare"),
  product("snowboard_1", "gid://shopify/Collection/fallback"),
  product("snowboard_2", "gid://shopify/Collection/fallback"),
];

describe("collectReferencedCategoryIds", () => {
  it("collects category ids from v3 result NODES (not just results_pages)", () => {
    expect([...collectReferencedCategoryIds(v3Doc())]).toContain("cat_dry");
  });

  it("includes points categories when a node ladder uses points", () => {
    const doc = Quiz.parse({
      ...v3Doc(["points"]),
      nodes: v3Doc(["points"]).nodes.map((n) =>
        n.id === "q1" && n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a) =>
                  a.id === "a1" ? { ...a, points: { cat_points: 3 } } : a,
                ),
              },
            }
          : n,
      ),
    });
    const ids = collectReferencedCategoryIds(doc);
    expect(ids.has("cat_points")).toBe(true);
  });
});

describe("collectRecommendableProductIds (product_index must contain bucket products)", () => {
  it("unions bucket members so the index isn't starved (the snowboards root cause)", () => {
    // A quiz scoped to nothing, with a bucket pointing at skincare products that
    // are NOT in any scoped collection. Pre-fix, these never entered the index.
    const map = new Map([["cat_dry", ["p_cream", "p_serum"]]]);
    const ids = collectRecommendableProductIds(v3Doc(["category"]), map);
    expect(ids.has("p_cream")).toBe(true);
    expect(ids.has("p_serum")).toBe(true);
  });

  it("includes explicit conditional-rule product ids", () => {
    const base = v3Doc(["conditional"]);
    const doc = Quiz.parse({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "r_dry" && n.type === "result"
          ? {
              ...n,
              data: {
                ...n.data,
                conditional_rules: [{ all_of: ["a1"], any_of: [], product_ids: ["p_special"] }],
              },
            }
          : n,
      ),
    });
    const ids = collectRecommendableProductIds(doc, new Map());
    expect(ids.has("p_special")).toBe(true);
  });

  it("is empty when nothing is bound", () => {
    expect(collectRecommendableProductIds(v3Doc(["tag"]), new Map()).size).toBe(0);
  });
});

describe("bakeResultPages", () => {
  it("synthesizes a results_pages entry per v3 result node carrying the category map", () => {
    const map = new Map([["cat_dry", ["p_cream", "p_serum"]]]);
    const baked = bakeResultPages(v3Doc(), map);
    const page = baked.find((p) => p.id === "r_dry");
    expect(page).toBeDefined();
    expect(page!.category_id).toBe("cat_dry");
    expect(page!.match_strategy).toBe("archetype");
    expect(page!.category_product_ids_map).toEqual({ cat_dry: ["p_cream", "p_serum"] });
  });
});

describe("recommendation actually listens to the rules (regression for 'always snowboards')", () => {
  it("category strategy returns the bucket's products, not the fallback collection", () => {
    const doc = v3Doc(["category"]);
    const map = new Map([["cat_dry", ["p_cream", "p_serum"]]]);
    // Bake results_pages the way publish now does, then run the engine.
    const published = Quiz.parse({ ...doc, results_pages: bakeResultPages(doc, map) });
    const recs = recommendForResult({
      quiz: published,
      productIndex: INDEX,
      selectedAnswerIds: ["a1"],
      resultNodeId: "r_dry",
    });
    expect(recs.map((r) => r.product_id).sort()).toEqual(["p_cream", "p_serum"]);
    // critically: NOT the fallback snowboards
    expect(recs.some((r) => r.product_id.startsWith("snowboard"))).toBe(false);
  });

  it("WITHOUT the baked map (the old bug) it falls through to the snowboard fallback", () => {
    // Simulate the pre-fix published doc: empty results_pages.
    const published = Quiz.parse({ ...v3Doc(["category"]), results_pages: [] });
    const recs = recommendForResult({
      quiz: published,
      productIndex: INDEX,
      selectedAnswerIds: ["a1"],
      resultNodeId: "r_dry",
    });
    // category resolves nothing → fallback collection (snowboards).
    expect(recs.every((r) => r.product_id.startsWith("snowboard"))).toBe(true);
  });
});
