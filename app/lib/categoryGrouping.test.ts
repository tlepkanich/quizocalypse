import { describe, expect, it } from "vitest";
import {
  resolveGroupsBySource,
  type GroupingCollection,
  type GroupingProduct,
} from "./categoryGrouping";

function product(
  productId: string,
  overrides: Partial<GroupingProduct> = {},
): GroupingProduct {
  return {
    productId,
    title: overrides.title ?? `Title ${productId}`,
    tags: overrides.tags ?? [],
    productType: overrides.productType ?? null,
    collectionIds: overrides.collectionIds ?? [],
    metafields: overrides.metafields,
  };
}

describe("resolveGroupsBySource — collection", () => {
  const products = [product("p1"), product("p2"), product("p3")];
  const collections: GroupingCollection[] = [
    { collectionId: "c-sale", title: "Sale", productIds: ["p2", "p3"] },
    { collectionId: "c-new", title: "New Arrivals", productIds: ["p1"] },
  ];

  it("emits one group per non-empty collection, sorted by name", () => {
    const groups = resolveGroupsBySource(
      "collection",
      products,
      collections,
    );
    expect(groups.map((g) => g.name)).toEqual(["New Arrivals", "Sale"]);
    const sale = groups.find((g) => g.name === "Sale");
    expect(sale).toBeDefined();
    expect(sale?.productIds).toEqual(["p2", "p3"]);
    expect(sale?.sourceRef).toBe("c-sale");
    expect(sale?.tags).toEqual([]);
  });

  it("intersects collection members with the known product list", () => {
    const groups = resolveGroupsBySource("collection", [product("p2")], [
      { collectionId: "c-sale", title: "Sale", productIds: ["p2", "p99"] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.productIds).toEqual(["p2"]);
  });

  it("emits only the requested collection when sourceRef is set", () => {
    const groups = resolveGroupsBySource(
      "collection",
      products,
      collections,
      { sourceRef: "c-new" },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("New Arrivals");
    expect(groups[0]?.productIds).toEqual(["p1"]);
  });

  it("treats smart_collection identically to collection", () => {
    const viaCollection = resolveGroupsBySource(
      "collection",
      products,
      collections,
    );
    const viaSmart = resolveGroupsBySource(
      "smart_collection",
      products,
      collections,
    );
    expect(viaSmart).toEqual(viaCollection);
  });

  it("drops collections with no known members", () => {
    const groups = resolveGroupsBySource("collection", products, [
      { collectionId: "c-empty", title: "Empty", productIds: ["ghost"] },
      { collectionId: "c-new", title: "New Arrivals", productIds: ["p1"] },
    ]);
    expect(groups.map((g) => g.name)).toEqual(["New Arrivals"]);
  });
});

describe("resolveGroupsBySource — tag", () => {
  it("buckets products per distinct tag, sorted by name", () => {
    const products = [
      product("p1", { tags: ["cozy", "wool"] }),
      product("p2", { tags: ["cozy"] }),
      product("p3", { tags: ["wool"] }),
    ];
    const groups = resolveGroupsBySource("tag", products, []);
    expect(groups.map((g) => g.name)).toEqual(["cozy", "wool"]);
    const cozy = groups.find((g) => g.name === "cozy");
    expect(cozy?.productIds).toEqual(["p1", "p2"]);
    expect(cozy?.tags).toEqual(["cozy"]);
    expect(cozy?.sourceRef).toBe("cozy");
  });

  it("normalizes tags before grouping so casing/spacing collapses", () => {
    const products = [
      product("p1", { tags: ["Cold Weather"] }),
      product("p2", { tags: ["cold-weather"] }),
    ];
    const groups = resolveGroupsBySource("tag", products, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("cold-weather");
    expect(groups[0]?.productIds).toEqual(["p1", "p2"]);
  });

  it("caps to the top 12 tags by member count when no sourceRef", () => {
    // 15 distinct tags. The first 13 products each carry a unique
    // single-use tag ("rare-00".."rare-12"); the last two share "common",
    // which therefore has the highest member count and must survive the
    // cap. Total distinct tags = 14 > 12, so only 12 groups come back.
    const rareProducts = Array.from({ length: 13 }, (_, i) =>
      product(`r${i}`, {
        tags: [`rare-${String(i).padStart(2, "0")}`],
      }),
    );
    const sharedProducts = [
      product("s1", { tags: ["common"] }),
      product("s2", { tags: ["common"] }),
    ];
    const groups = resolveGroupsBySource(
      "tag",
      [...rareProducts, ...sharedProducts],
      [],
    );
    expect(groups).toHaveLength(12);
    // "common" (2 members) is the most-common tag and must be kept.
    expect(groups.some((g) => g.name === "common")).toBe(true);
  });

  it("emits only the requested tag bucket when sourceRef is set", () => {
    const products = [
      product("p1", { tags: ["cozy", "wool"] }),
      product("p2", { tags: ["wool"] }),
    ];
    const groups = resolveGroupsBySource("tag", products, [], {
      sourceRef: "wool",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("wool");
    expect(groups[0]?.productIds).toEqual(["p1", "p2"]);
  });
});

describe("resolveGroupsBySource — product_type", () => {
  it("buckets per distinct productType and skips null/empty types", () => {
    const products = [
      product("p1", { productType: "Hoodie" }),
      product("p2", { productType: "Hoodie" }),
      product("p3", { productType: "Tee" }),
      product("p4", { productType: null }),
      product("p5", { productType: "  " }),
    ];
    const groups = resolveGroupsBySource("product_type", products, []);
    expect(groups.map((g) => g.name)).toEqual(["Hoodie", "Tee"]);
    const hoodie = groups.find((g) => g.name === "Hoodie");
    expect(hoodie?.productIds).toEqual(["p1", "p2"]);
    expect(hoodie?.sourceRef).toBe("Hoodie");
    expect(hoodie?.tags).toEqual([]);
  });

  it("emits only the requested type when sourceRef is set", () => {
    const products = [
      product("p1", { productType: "Hoodie" }),
      product("p2", { productType: "Tee" }),
    ];
    const groups = resolveGroupsBySource("product_type", products, [], {
      sourceRef: "Tee",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Tee");
    expect(groups[0]?.productIds).toEqual(["p2"]);
  });
});

describe("resolveGroupsBySource — metafield", () => {
  const products = [
    product("p1", { metafields: { "custom.skin_type": "oily" } }),
    product("p2", { metafields: { "custom.skin_type": "dry" } }),
    product("p3", { metafields: { "custom.skin_type": "oily" } }),
    product("p4", { metafields: { "custom.other": "x" } }),
  ];

  it("buckets per distinct metafield value and skips products lacking the key", () => {
    const groups = resolveGroupsBySource("metafield", products, [], {
      metafieldKey: "custom.skin_type",
    });
    expect(groups.map((g) => g.name)).toEqual(["dry", "oily"]);
    const oily = groups.find((g) => g.name === "oily");
    expect(oily?.productIds).toEqual(["p1", "p3"]);
    expect(oily?.sourceRef).toBe("oily");
  });

  it("returns [] when no metafieldKey is supplied (graceful no-op)", () => {
    const groups = resolveGroupsBySource("metafield", products, []);
    expect(groups).toEqual([]);
  });

  it("emits only the requested value when sourceRef is set", () => {
    const groups = resolveGroupsBySource("metafield", products, [], {
      metafieldKey: "custom.skin_type",
      sourceRef: "dry",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("dry");
    expect(groups[0]?.productIds).toEqual(["p2"]);
  });
});

describe("resolveGroupsBySource — general invariants", () => {
  it("drops empty groups and never emits a group with zero products", () => {
    const groups = resolveGroupsBySource(
      "collection",
      [product("p1")],
      [
        { collectionId: "c-a", title: "A", productIds: [] },
        { collectionId: "c-b", title: "B", productIds: ["p1"] },
      ],
    );
    expect(groups.every((g) => g.productIds.length > 0)).toBe(true);
    expect(groups.map((g) => g.name)).toEqual(["B"]);
  });

  it("returns groups in deterministic name order across sources", () => {
    const products = [
      product("p1", { tags: ["zebra", "apple"] }),
      product("p2", { tags: ["mango"] }),
    ];
    const groups = resolveGroupsBySource("tag", products, []);
    const names = groups.map((g) => g.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toEqual(["apple", "mango", "zebra"]);
  });
});
