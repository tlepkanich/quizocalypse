import { describe, expect, it } from "vitest";
import {
  inverseCollectionIndex,
  hydrateCollectionProducts,
  type GroupingProduct,
} from "./categoryGrouping";
import { detectGroupingDimension, scorePartition } from "./groupingDetect";

const product = (id: string, over: Partial<GroupingProduct> = {}): GroupingProduct => ({
  productId: id,
  title: over.title ?? `Title ${id}`,
  tags: over.tags ?? [],
  productType: over.productType ?? null,
  collectionIds: over.collectionIds ?? [],
  metafields: over.metafields,
});

describe("inverseCollectionIndex + hydrateCollectionProducts (Collection.productIds fix)", () => {
  it("builds collection→products from the products' own collection GIDs", () => {
    const products = [
      product("p1", { collectionIds: ["c1", "c2"] }),
      product("p2", { collectionIds: ["c1"] }),
      product("p3", { collectionIds: ["c2"] }),
    ];
    const idx = inverseCollectionIndex(products);
    expect(idx.get("c1")).toEqual(["p1", "p2"]);
    expect(idx.get("c2")).toEqual(["p1", "p3"]);
  });

  it("hydrates synced collections (empty productIds) with real members", () => {
    const products = [
      product("p1", { collectionIds: ["gid://c/snow"] }),
      product("p2", { collectionIds: ["gid://c/snow"] }),
    ];
    // Collections come from the DB with productIds:[] — hydration fills them.
    const hydrated = hydrateCollectionProducts(
      [{ collectionId: "gid://c/snow", title: "Snow" }, { collectionId: "gid://c/empty", title: "Empty" }],
      products,
    );
    expect(hydrated.find((c) => c.collectionId === "gid://c/snow")!.productIds).toEqual(["p1", "p2"]);
    expect(hydrated.find((c) => c.collectionId === "gid://c/empty")!.productIds).toEqual([]);
  });
});

describe("scorePartition", () => {
  it("scores a clean balanced partition higher than a one-bucket-dominates one", () => {
    const balanced = [
      { name: "a", tags: [], productIds: ["1", "2", "3"] },
      { name: "b", tags: [], productIds: ["4", "5", "6"] },
      { name: "c", tags: [], productIds: ["7", "8", "9"] },
    ];
    const lopsided = [
      { name: "a", tags: [], productIds: ["1", "2", "3", "4", "5", "6", "7", "8"] },
      { name: "b", tags: [], productIds: ["9"] },
    ];
    expect(scorePartition(balanced, 9)).toBeGreaterThan(scorePartition(lopsided, 9));
  });

  it("returns 0 for fewer than two non-empty buckets", () => {
    expect(scorePartition([{ name: "a", tags: [], productIds: ["1"] }], 5)).toBe(0);
    expect(scorePartition([], 5)).toBe(0);
  });
});

describe("detectGroupingDimension", () => {
  it("<5 products → 'all' with no proposed groups", () => {
    const products = [product("p1"), product("p2"), product("p3")];
    const r = detectGroupingDimension(products, []);
    expect(r.dimension).toBe("all");
    expect(r.proposed).toEqual([]);
  });

  it("clean collections → defaults to grouping by collection", () => {
    // 9 products across 3 collections, evenly — collection partitions cleanly.
    const products = Array.from({ length: 9 }, (_, i) =>
      product(`p${i}`, { collectionIds: [`c${i % 3}`] }),
    );
    const collections = [
      { collectionId: "c0", title: "One" },
      { collectionId: "c1", title: "Two" },
      { collectionId: "c2", title: "Three" },
    ];
    const r = detectGroupingDimension(products, collections);
    expect(r.dimension).toBe("collection");
    expect(r.proposed).toHaveLength(3);
    expect(r.rationale).toContain("collection");
  });

  it("no collections but clean product types → grouping by product_type wins", () => {
    const products = [
      ...Array.from({ length: 4 }, (_, i) => product(`a${i}`, { productType: "Snowboard" })),
      ...Array.from({ length: 4 }, (_, i) => product(`b${i}`, { productType: "Boots" })),
    ];
    const r = detectGroupingDimension(products, []); // zero collections
    expect(r.dimension).toBe("product_type");
    expect(r.proposed.length).toBeGreaterThanOrEqual(2);
  });

  it("no usable grouping signal at all → falls back to 'all'", () => {
    // 6 products, no collections, no types, no tags — nothing partitions.
    const products = Array.from({ length: 6 }, (_, i) => product(`p${i}`));
    const r = detectGroupingDimension(products, []);
    expect(r.dimension).toBe("all");
  });
});
