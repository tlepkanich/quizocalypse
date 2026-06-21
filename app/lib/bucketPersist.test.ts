import { describe, expect, it } from "vitest";
import { bucketRowFor, bucketRowsFor } from "./bucketPersist";
import { hydrateCollectionProducts, type GroupingProduct } from "./categoryGrouping";

const products: GroupingProduct[] = [
  { productId: "p1", title: "Alpha Board", tags: ["Winter Sports", "Snow"], productType: null, collectionIds: ["c1"] },
  { productId: "p2", title: "Beta Board", tags: ["winter sports"], productType: null, collectionIds: ["c1", "c2"] },
  { productId: "p3", title: "Gamma Wax", tags: [], productType: null, collectionIds: ["c2"] },
];
const collections = hydrateCollectionProducts(
  [
    { collectionId: "c1", title: "Boards" },
    { collectionId: "c2", title: "Accessories" },
  ],
  products,
);
const productTitleById = new Map(products.map((p) => [p.productId, p.title]));
const collectionTitleById = new Map([
  ["c1", "Boards"],
  ["c2", "Accessories"],
]);

const row = (type: "product" | "tag" | "collection", key: string) =>
  bucketRowFor(type, key, products, collections, productTitleById, collectionTitleById);

describe("bucketRowFor", () => {
  it("product → single-member bucket named after the product", () => {
    expect(row("product", "p1")).toEqual({
      source: "product",
      sourceRef: "p1",
      name: "Alpha Board",
      tags: [],
      productIds: ["p1"],
    });
  });

  it("unknown product id → null", () => {
    expect(row("product", "nope")).toBeNull();
  });

  it("tag → all members, keyed on the normalized tag (case/space-insensitive)", () => {
    const r = row("tag", "Winter Sports");
    expect(r).not.toBeNull();
    expect(r?.source).toBe("tag");
    expect(r?.sourceRef).toBe("winter-sports"); // normalized
    expect(r?.productIds.sort()).toEqual(["p1", "p2"]); // both spellings fold together
  });

  it("tag with no members → null", () => {
    expect(row("tag", "nonexistent")).toBeNull();
  });

  it("collection → members from the inverse index, named by the collection title", () => {
    const r = row("collection", "c2");
    expect(r?.source).toBe("collection");
    expect(r?.name).toBe("Accessories");
    expect(r?.productIds.sort()).toEqual(["p2", "p3"]);
  });

  it("empty / unknown collection → null", () => {
    expect(row("collection", "c-missing")).toBeNull();
  });
});

describe("bucketRowsFor", () => {
  it("resolves a batch and drops the unresolvable selections", () => {
    const rows = bucketRowsFor(
      [
        { type: "product", key: "p1" },
        { type: "product", key: "ghost" }, // dropped
        { type: "tag", key: "Snow" },
      ],
      products,
      collections,
      productTitleById,
      collectionTitleById,
    );
    expect(rows.map((r) => r.sourceRef)).toEqual(["p1", "snow"]);
  });
});
