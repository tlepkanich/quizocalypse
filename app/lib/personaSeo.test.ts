import { describe, it, expect } from "vitest";
import { slugify, extractPersonaPages, findPersonaPage, productUrl } from "./personaSeo";
import type { IndexedProduct } from "./recommendationEngine";

const prod = (id: string, over: Partial<IndexedProduct> = {}): IndexedProduct =>
  ({ product_id: id, title: `Product ${id}`, handle: `product-${id}`, price: "19.00", image_url: `https://x/${id}.jpg` }) as IndexedProduct;

const raw = {
  target_index: {
    t1: { type: "collection", name: "Glow", persona: { name: "The Glow Chaser", description: "Best for dull skin.", image: "https://x/glow.jpg" } },
    t2: { type: "tag", name: "Calm", persona: { name: "The Calm Seeker" } },
    t3: { type: "product", name: "No persona here" }, // no persona → skipped
  },
  target_product_ids_map: { t1: ["a", "b"], t2: ["c"] },
  product_index: [prod("a"), prod("b"), prod("c")],
  shop_domain: "shop.myshopify.com",
};

describe("§M8 persona SEO extraction", () => {
  it("slugify is url-safe + deterministic", () => {
    expect(slugify("The Glow Chaser!")).toBe("the-glow-chaser");
    expect(slugify("  ")).toBe("persona");
  });

  it("extracts only persona-bearing targets, with their products", () => {
    const pages = extractPersonaPages(raw);
    expect(pages.map((p) => p.slug)).toEqual(["the-glow-chaser", "the-calm-seeker"]);
    const glow = pages[0]!;
    expect(glow.name).toBe("The Glow Chaser");
    expect(glow.description).toBe("Best for dull skin.");
    expect(glow.products.map((p) => p.handle)).toEqual(["product-a", "product-b"]);
  });

  it("de-dupes slugs for same-named personas", () => {
    const dup = {
      target_index: {
        x: { persona: { name: "Twin" } },
        y: { persona: { name: "Twin" } },
      },
      target_product_ids_map: {},
      product_index: [],
    };
    expect(extractPersonaPages(dup).map((p) => p.slug)).toEqual(["twin", "twin-2"]);
  });

  it("findPersonaPage resolves by slug", () => {
    expect(findPersonaPage(raw, "the-calm-seeker")?.name).toBe("The Calm Seeker");
    expect(findPersonaPage(raw, "nope")).toBeNull();
  });

  it("productUrl builds Shopify PDP vs standalone", () => {
    expect(productUrl("shop.myshopify.com", "sku-1")).toBe("https://shop.myshopify.com/products/sku-1");
    expect(productUrl("shop.myshopify.com", "sku-1", "standalone")).toBe("/products/sku-1");
  });
});
