import { describe, expect, it } from "vitest";
import {
  CATALOG_PAYLOAD_BUDGET_BYTES,
  catalogProductPayload,
  checkCatalogPayloadBudget,
  normalizeStatus,
  variantListOf,
  type CatalogProductSource,
} from "./funnelCatalogPayload";

const base: CatalogProductSource = {
  productId: "gid://p/1",
  title: "Alpha Board",
  imageUrl: null,
  priceMin: 40,
  descriptionText: "x".repeat(400),
  tags: ["Winter Sports", "Snow"],
  collectionIds: ["c1"],
  status: "ACTIVE",
  variants: [],
  metafields: null,
  tagKeys: ["winter-sports", "snow"],
  metafieldValues: ["custom.fit: slim"],
};

describe("catalogProductPayload", () => {
  it("ships status (lower-cased), raw tags, metafield values and a 220-char description", () => {
    const p = catalogProductPayload(base);
    expect(p.status).toBe("active");
    expect(p.tags).toEqual(["Winter Sports", "Snow"]);
    expect(p.metafieldValues).toEqual(["custom.fit: slim"]);
    expect(p.description?.length).toBe(220);
    expect(p.variants).toEqual([]);
    expect(p.variantOption).toBeNull();
  });

  it("drops Shopify's placeholder Title/Default Title, so a single-variant product has NO variants", () => {
    const p = catalogProductPayload({
      ...base,
      variants: [{ options: [{ name: "Title", value: "Default Title" }], inventoryQuantity: 3 }],
    });
    expect(p.variants).toEqual([]);
    expect(p.variantOption).toBeNull();
  });

  it("lists the first real option's values with per-variant availability", () => {
    const { option, list } = variantListOf([
      { options: [{ name: "Size", value: "S" }, { name: "Colour", value: "Red" }], inventoryQuantity: 2 },
      { options: [{ name: "Size", value: "M" }], inventoryQuantity: 0 },
      { options: [{ name: "Size", value: "M" }], inventoryQuantity: 5 },
      { options: [{ name: "Size", value: "L" }] },
    ]);
    expect(option).toBe("Size");
    expect(list).toEqual([
      { name: "Size", value: "S", available: true },
      { name: "Size", value: "M", available: true }, // any available variant of the value counts
      { name: "Size", value: "L", available: true }, // untracked inventory reads available
    ]);
  });

  it("marks a value sold out only when every variant carrying it is out", () => {
    const { list } = variantListOf([
      { options: [{ name: "Shade", value: "Deep" }], inventoryQuantity: 0 },
    ]);
    expect(list).toEqual([{ name: "Shade", value: "Deep", available: false }]);
  });

  it("normalizes status and treats anything else as null", () => {
    expect(normalizeStatus("DRAFT")).toBe("draft");
    expect(normalizeStatus("archived")).toBe("archived");
    expect(normalizeStatus("weird")).toBeNull();
    expect(normalizeStatus(null)).toBeNull();
  });
});

describe("checkCatalogPayloadBudget", () => {
  it("measures the serialized block against the budget", () => {
    const one = catalogProductPayload(base);
    expect(checkCatalogPayloadBudget([one]).ok).toBe(true);
    expect(checkCatalogPayloadBudget([one], 10).ok).toBe(false);
    expect(checkCatalogPayloadBudget([one]).limit).toBe(CATALOG_PAYLOAD_BUDGET_BYTES);
  });
  it("a 2,000-product catalog with typical fields stays under the budget", () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      catalogProductPayload({ ...base, productId: `gid://shopify/Product/${1000000 + i}` }),
    );
    const r = checkCatalogPayloadBudget(many);
    expect(r.ok).toBe(true);
  });
});
