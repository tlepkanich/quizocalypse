import { describe, expect, it } from "vitest";
import type { Quiz as QuizDoc } from "./quizSchema";
import type { IndexedProduct } from "./recommendationEngine";
import {
  buildMappingMatrix,
  toggleMembership,
  membersFromCategories,
  diffMembers,
  type MappingCategory,
} from "./productMapping";

function product(id: string, title = id): IndexedProduct {
  return {
    product_id: id,
    title,
    handle: id,
    price: "10.00",
    image_url: null,
    tags: [],
    collection_ids: [],
    inventory_in_stock: true,
  };
}

// Result nodes are read structurally (id/type/data.headline/data.category_id),
// so plain objects cast to the node array are sufficient for these unit tests.
function resultNode(id: string, categoryId?: string, headline = "Your match") {
  return { id, type: "result", position: { x: 0, y: 0 }, data: { headline, category_id: categoryId } };
}
const nodes = (...ns: unknown[]) => ns as unknown as QuizDoc["nodes"];

const CATS: MappingCategory[] = [
  { id: "cat_a", name: "Bucket A", productIds: ["p1", "p2"] },
  { id: "cat_b", name: "Bucket B", productIds: ["p2", "p3"] },
];
const INDEX = [product("p1"), product("p2"), product("p3"), product("p4")];

describe("buildMappingMatrix", () => {
  it("builds one column per bound result page and marks cell membership", () => {
    const m = buildMappingMatrix(
      INDEX,
      CATS,
      nodes(resultNode("r_a", "cat_a", "A page"), resultNode("r_b", "cat_b")),
    );
    expect(m.columns.map((c) => c.categoryId)).toEqual(["cat_a", "cat_b"]);
    // headline falls back to bucket name when blank-ish
    expect(m.columns[0]!.label).toBe("A page");
    expect(m.columns[1]!.label).toBe("Your match"); // headline present, kept
    const byId = new Map(m.rows.map((r) => [r.productId, r]));
    expect(byId.get("p1")!.categoryIds).toEqual(["cat_a"]);
    expect(byId.get("p2")!.categoryIds.sort()).toEqual(["cat_a", "cat_b"]);
    expect(byId.get("p3")!.categoryIds).toEqual(["cat_b"]);
    expect(byId.get("p4")!.categoryIds).toEqual([]);
  });

  it("flags unmapped (zero buckets) and multi-mapped (>1 bucket) products", () => {
    const m = buildMappingMatrix(
      INDEX,
      CATS,
      nodes(resultNode("r_a", "cat_a"), resultNode("r_b", "cat_b")),
    );
    expect(m.unmappedProductIds).toEqual(["p4"]);
    expect(m.multiMappedProductIds).toEqual(["p2"]);
  });

  it("omits result pages with no category_id and bindings to missing buckets", () => {
    const m = buildMappingMatrix(
      INDEX,
      CATS,
      nodes(
        resultNode("r_tag"), // no category_id → not a column
        resultNode("r_ghost", "cat_gone"), // bound to a missing bucket → skipped
        resultNode("r_a", "cat_a"),
      ),
    );
    expect(m.columns.map((c) => c.categoryId)).toEqual(["cat_a"]);
  });

  it("reflects a working member edit (product moved into another bucket)", () => {
    let members = membersFromCategories(CATS);
    members = toggleMembership(members, "cat_b", "p1"); // add p1 to B
    const working = CATS.map((c) => ({ ...c, productIds: members[c.id]! }));
    const m = buildMappingMatrix(
      INDEX,
      working,
      nodes(resultNode("r_a", "cat_a"), resultNode("r_b", "cat_b")),
    );
    const p1 = m.rows.find((r) => r.productId === "p1")!;
    expect(p1.categoryIds.sort()).toEqual(["cat_a", "cat_b"]);
  });
});

describe("toggleMembership", () => {
  it("adds when absent and removes when present (pure)", () => {
    const start = { cat_a: ["p1"] };
    const added = toggleMembership(start, "cat_a", "p2");
    expect(added.cat_a).toEqual(["p1", "p2"]);
    expect(start.cat_a).toEqual(["p1"]); // original untouched
    const removed = toggleMembership(added, "cat_a", "p1");
    expect(removed.cat_a).toEqual(["p2"]);
  });

  it("seeds an empty list for an unseen category", () => {
    const out = toggleMembership({}, "cat_new", "p9");
    expect(out.cat_new).toEqual(["p9"]);
  });
});

describe("diffMembers", () => {
  it("returns only changed buckets, order-insensitive", () => {
    const members = membersFromCategories(CATS);
    // reorder cat_a (no real change) + add p4 to cat_b
    const edited = {
      cat_a: ["p2", "p1"],
      cat_b: ["p2", "p3", "p4"],
    };
    const diff = diffMembers(CATS, edited);
    expect(Object.keys(diff)).toEqual(["cat_b"]);
    expect(diff.cat_b!.sort()).toEqual(["p2", "p3", "p4"]);
    // a true no-op diffs to nothing
    expect(Object.keys(diffMembers(CATS, members))).toEqual([]);
  });
});
