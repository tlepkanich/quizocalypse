import { describe, it, expect } from "vitest";
import type { Product } from "@prisma/client";
import { scoreCatalogCompleteness, toneSampleFromCatalog, suggestPlacement } from "./catalogIndex";

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
