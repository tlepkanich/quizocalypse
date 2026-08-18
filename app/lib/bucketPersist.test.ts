import { describe, expect, it } from "vitest";
import {
  bucketRowFor,
  bucketRowsFor,
  curatedBucketRows,
  sameIdSet,
  computeBucketMembershipRefresh,
  type RefreshableBucketRow,
} from "./bucketPersist";
import {
  hydrateCollectionProducts,
  type GroupingProduct,
  type GroupingCollection,
} from "./categoryGrouping";

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

// ── curatedBucketRows ────────────────────────────────────────────────────────
// The invisible-ai-rows fix: whole-catalog discovery rows (source "ai") must
// never widen the generation scope once the merchant has curated rows of their
// own — but a pure-discovery quiz keeps them (they ARE its grounding).

describe("curatedBucketRows", () => {
  const ai = { id: "a1", source: "ai" };
  const ai2 = { id: "a2", source: "ai" };
  const col = { id: "c1", source: "collection" };
  const tag = { id: "t1", source: "tag" };

  it("drops ai rows when curated rows exist (the mixed-quiz landmine)", () => {
    expect(curatedBucketRows([ai, col, ai2, tag])).toEqual([col, tag]);
  });

  it("keeps ai rows when they are the only grounding (pure discovery)", () => {
    expect(curatedBucketRows([ai, ai2])).toEqual([ai, ai2]);
  });

  it("treats every non-ai source as curated, including legacy and manual", () => {
    const manual = { id: "m1", source: "manual" };
    const legacy = { id: "l1", source: "product_type" };
    const nul = { id: "n1", source: null };
    expect(curatedBucketRows([ai, manual, legacy, nul])).toEqual([manual, legacy, nul]);
  });

  it("returns an empty list unchanged", () => {
    expect(curatedBucketRows([])).toEqual([]);
  });

  it("preserves row order of the survivors", () => {
    expect(curatedBucketRows([tag, ai, col]).map((r) => r.id)).toEqual(["t1", "c1"]);
  });
});

// ── sameIdSet ────────────────────────────────────────────────────────────────

describe("sameIdSet", () => {
  it("is order-insensitive", () => {
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
  });
  it("detects removals and additions", () => {
    expect(sameIdSet(["a", "b"], ["a"])).toBe(false);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
    expect(sameIdSet(["a", "b"], ["a", "c"])).toBe(false);
  });
  it("handles empties", () => {
    expect(sameIdSet([], [])).toBe(true);
    expect(sameIdSet([], ["a"])).toBe(false);
  });
});

// ── computeBucketMembershipRefresh ───────────────────────────────────────────
// The stale-snapshot fix: collection/tag rows re-resolve against the LIVE
// catalog; rows with no external source of truth (product/manual/ai) and rows
// whose sourceRef no longer resolves keep their snapshot.

function refreshRow(overrides: Partial<RefreshableBucketRow>): RefreshableBucketRow {
  return {
    id: "cat1",
    source: "collection",
    sourceRef: "c1",
    tags: [],
    productIds: [],
    ...overrides,
  };
}

describe("computeBucketMembershipRefresh", () => {
  const liveCollections: GroupingCollection[] = collections;

  it("updates a collection row whose membership drifted (the resync case)", () => {
    const stale = refreshRow({ productIds: ["p-old-1", "p-old-2"] });
    const updates = computeBucketMembershipRefresh([stale], products, liveCollections);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe("cat1");
    expect([...updates[0]!.productIds].sort()).toEqual(["p1", "p2"]);
  });

  it("treats smart_collection like collection", () => {
    const stale = refreshRow({ source: "smart_collection", productIds: ["p-old"] });
    const updates = computeBucketMembershipRefresh([stale], products, liveCollections);
    expect(updates).toHaveLength(1);
    expect([...updates[0]!.productIds].sort()).toEqual(["p1", "p2"]);
  });

  it("re-resolves tag rows through the normalized key", () => {
    const stale = refreshRow({
      id: "cat2",
      source: "tag",
      sourceRef: "winter-sports",
      productIds: ["p1"],
    });
    const updates = computeBucketMembershipRefresh([stale], products, liveCollections);
    expect(updates).toHaveLength(1);
    expect([...updates[0]!.productIds].sort()).toEqual(["p1", "p2"]);
  });

  it("no-ops when membership and tags already match (order-insensitive)", () => {
    const stale = refreshRow({ productIds: ["p-old"] });
    const [current] = computeBucketMembershipRefresh([stale], products, liveCollections);
    // Feed the refreshed values back in — a second pass must be a no-op.
    const settled = refreshRow({
      productIds: [...current!.productIds].reverse(),
      tags: [...current!.tags].reverse(),
    });
    expect(computeBucketMembershipRefresh([settled], products, liveCollections)).toEqual([]);
  });

  it("keeps the snapshot when the sourceRef no longer resolves", () => {
    const orphan = refreshRow({ sourceRef: "c-deleted", productIds: ["p-old"] });
    expect(computeBucketMembershipRefresh([orphan], products, liveCollections)).toEqual([]);
  });

  it("never touches product/manual/ai rows or rows without a sourceRef", () => {
    const rows = [
      refreshRow({ id: "r1", source: "product", sourceRef: "p1", productIds: ["p1"] }),
      refreshRow({ id: "r2", source: "manual", sourceRef: "x", productIds: ["p9"] }),
      refreshRow({ id: "r3", source: "ai", sourceRef: null, productIds: ["p9"] }),
      refreshRow({ id: "r4", source: "collection", sourceRef: null, productIds: ["p9"] }),
    ];
    expect(computeBucketMembershipRefresh(rows, products, liveCollections)).toEqual([]);
  });
});
