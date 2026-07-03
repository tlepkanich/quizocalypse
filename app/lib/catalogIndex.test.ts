import { describe, it, expect } from "vitest";
import type { Product, Collection } from "@prisma/client";
import {
  scoreCatalogCompleteness,
  toneSampleFromCatalog,
  suggestPlacement,
  selectIdentityCorpus,
  scopeCatalogToChosen,
  IDENTITY_MAX_CORPUS,
} from "./catalogIndex";

// Minimal Product factory — the catalog-intelligence helpers only read tags,
// descriptionText, and variants, but we build a full row so the cast is honest.
function mk(overrides: Partial<Product>): Product {
  return {
    productId: "gid://p/1",
    shopId: "s1",
    title: "P",
    handle: "p",
    vendor: null,
    productType: null,
    status: null,
    tags: [],
    collectionIds: [],
    variants: [],
    metafields: {},
    imageUrl: null,
    priceMin: null,
    priceMax: null,
    descriptionHtml: null,
    descriptionText: null,
    lastEnrichedAt: null,
    updatedAt: new Date(),
    ...overrides,
  } as Product;
}

const longDesc = "A".repeat(220);

describe("scoreCatalogCompleteness", () => {
  it("returns 0 + a flag for an empty catalog", () => {
    const r = scoreCatalogCompleteness([]);
    expect(r.score).toBe(0);
    expect(r.productCount).toBe(0);
    expect(r.flags.join()).toMatch(/No products/i);
  });

  it("scores a rich catalog high with no gap flags", () => {
    const products = Array.from({ length: 4 }, (_, i) =>
      mk({ productId: `p${i}`, tags: ["a", "b"], descriptionText: longDesc, variants: [{}, {}] }),
    );
    const r = scoreCatalogCompleteness(products);
    expect(r.tagCoverage).toBe(1);
    expect(r.avgVariants).toBe(2);
    expect(r.avgDescriptionChars).toBeGreaterThanOrEqual(200);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.flags).toHaveLength(0);
  });

  it("flags low tag coverage", () => {
    const products = [
      mk({ productId: "a", tags: ["x"], descriptionText: longDesc, variants: [{}, {}] }),
      mk({ productId: "b", tags: [], descriptionText: longDesc, variants: [{}, {}] }),
      mk({ productId: "c", tags: [], descriptionText: longDesc, variants: [{}, {}] }),
      mk({ productId: "d", tags: [], descriptionText: longDesc, variants: [{}, {}] }),
    ];
    const r = scoreCatalogCompleteness(products);
    expect(r.tagCoverage).toBeCloseTo(0.25, 5);
    expect(r.flags.join()).toMatch(/tagged/i);
    expect(r.score).toBeLessThan(90);
  });
});

describe("toneSampleFromCatalog", () => {
  it("joins the first N usable descriptions and skips trivial ones", () => {
    const products = [
      mk({ descriptionText: "Soft, breathable cotton tee built for everyday wear." }),
      mk({ descriptionText: "tiny" }), // < 20 chars → skipped
      mk({ descriptionText: "Our signature moisturizer hydrates without grease." }),
      mk({ descriptionText: "" }), // empty → skipped
    ];
    const sample = toneSampleFromCatalog(products, 5);
    expect(sample).toMatch(/cotton tee/);
    expect(sample).toMatch(/moisturizer/);
    expect(sample).not.toMatch(/tiny/);
    expect(sample.split("\n---\n")).toHaveLength(2);
  });

  it("caps each sample length and respects n", () => {
    const products = Array.from({ length: 8 }, () => mk({ descriptionText: "B".repeat(900) }));
    const sample = toneSampleFromCatalog(products, 3, 400);
    expect(sample.split("\n---\n")).toHaveLength(3); // only n=3
    expect(sample).toMatch(/…/); // truncated
  });

  it("returns empty string when nothing usable", () => {
    expect(toneSampleFromCatalog([mk({ descriptionText: null }), mk({ descriptionText: "x" })])).toBe("");
  });
});

describe("suggestPlacement", () => {
  it("single hero / tiny catalog → product_widget", () => {
    expect(suggestPlacement(1)).toBe("product_widget");
    expect(suggestPlacement(3)).toBe("product_widget");
  });
  it("mid-size catalog (4–9) → dedicated page", () => {
    expect(suggestPlacement(4)).toBe("page");
    expect(suggestPlacement(9)).toBe("page");
  });
  it("broad catalog (10+) → homepage popup", () => {
    expect(suggestPlacement(10)).toBe("popup");
    expect(suggestPlacement(250)).toBe("popup");
  });
});

// Brand Identity corpus selection — the two merchant rules at their boundaries.
describe("selectIdentityCorpus (Brand Identity Step 0)", () => {
  const many = (count: number, over: (i: number) => Partial<Product> = () => ({})) =>
    Array.from({ length: count }, (_, i) =>
      mk({ productId: `gid://p/${i}`, descriptionText: "x".repeat(30), ...over(i) }),
    );

  it("<5 products → widen + educational hint, reads everything", () => {
    const c = selectIdentityCorpus(many(4));
    expect(c.products).toHaveLength(4);
    expect(c.lowVolumeEducationalHint).toBe(true);
    expect(c.note).toContain("widened");
  });

  it("exactly 5 → passthrough, no hint (boundary)", () => {
    const c = selectIdentityCorpus(many(5));
    expect(c.products).toHaveLength(5);
    expect(c.lowVolumeEducationalHint).toBe(false);
    expect(c.note).toBe("5 products");
  });

  it("exactly 100 → passthrough (boundary)", () => {
    const c = selectIdentityCorpus(many(100));
    expect(c.products).toHaveLength(100);
    expect(c.note).toBe("100 products");
  });

  it("101 → caps at top 100 (boundary)", () => {
    const c = selectIdentityCorpus(many(101, (i) => ({ status: "ACTIVE" })));
    expect(c.products).toHaveLength(IDENTITY_MAX_CORPUS);
    expect(c.note).toContain("top 100 of 101");
  });

  it(">100 with a revenue ranking → ordered by revenue, ranked-first", () => {
    const products = many(120, () => ({ status: "ACTIVE" }));
    // Rank the LAST three highest — they must surface to the front.
    const bestSellerIds = ["gid://p/119", "gid://p/118", "gid://p/117"];
    const c = selectIdentityCorpus(products, bestSellerIds);
    expect(c.products.slice(0, 3).map((p) => p.productId)).toEqual(bestSellerIds);
    expect(c.note).toContain("by revenue");
  });

  it(">100 all-inactive status → never filters to empty (falls back to all)", () => {
    const c = selectIdentityCorpus(many(150, () => ({ status: "DRAFT" })));
    expect(c.products).toHaveLength(IDENTITY_MAX_CORPUS);
  });

  it(">100, no ranking → deterministic proxy (image beats description length)", () => {
    const products = many(105, (i) => ({
      descriptionText: "y".repeat(i), // ascending richness
      imageUrl: i === 0 ? "https://img/0.png" : null, // only p/0 has an image
    }));
    const c = selectIdentityCorpus(products);
    // The single imaged product wins the top slot despite the shortest description.
    expect(c.products[0]!.productId).toBe("gid://p/0");
  });
});

describe("scopeCatalogToChosen (Shape-page AI grounds in chosen products, not the whole catalog)", () => {
  const col = (collectionId: string): Collection =>
    ({ collectionId, shopId: "s1", title: collectionId, handle: collectionId, productIds: [], updatedAt: new Date() } as unknown as Collection);
  const products = [
    mk({ productId: "p1", collectionIds: ["c1"] }),
    mk({ productId: "p2", collectionIds: ["c1"] }),
    mk({ productId: "p3", collectionIds: ["c2"] }),
    mk({ productId: "p4", collectionIds: [] }),
  ];
  const collections = [col("c1"), col("c2"), col("c3")];

  it("empty chosen set → the FULL catalog (nothing selected yet)", () => {
    const out = scopeCatalogToChosen(products, collections, new Set());
    expect(out.products).toHaveLength(4);
    expect(out.collections).toHaveLength(3);
  });

  it("narrows to the chosen products + only their collections", () => {
    const out = scopeCatalogToChosen(products, collections, new Set(["p1", "p3"]));
    expect(out.products.map((p) => p.productId).sort()).toEqual(["p1", "p3"]);
    // c1 (p1) + c2 (p3) referenced; c3 is not → dropped.
    expect(out.collections.map((c) => c.collectionId).sort()).toEqual(["c1", "c2"]);
  });

  it("a chosen product in no collection scopes to zero collections", () => {
    const out = scopeCatalogToChosen(products, collections, new Set(["p4"]));
    expect(out.products.map((p) => p.productId)).toEqual(["p4"]);
    expect(out.collections).toHaveLength(0);
  });

  it("chosen ids that match NOTHING (stale/unsynced) → FALL BACK to the full catalog", () => {
    const out = scopeCatalogToChosen(products, collections, new Set(["ghost-1", "ghost-2"]));
    expect(out.products).toHaveLength(4);
    expect(out.collections).toHaveLength(3);
  });
});
