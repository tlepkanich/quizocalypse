import { describe, it, expect } from "vitest";
import { productHref } from "./productHref";

describe("productHref (QD-7 click-through decoupling)", () => {
  const product = { handle: "trail-board", url: "https://acme.example/p/trail-board" };

  it("shopify → storefront /products/<handle> permalink", () => {
    expect(productHref(product, "acme.myshopify.com", "shopify")).toBe(
      "https://acme.myshopify.com/products/trail-board",
    );
  });

  it("standalone → the merchant's own product url (ignores shopDomain)", () => {
    expect(productHref(product, "acme.myshopify.com", "standalone")).toBe(
      "https://acme.example/p/trail-board",
    );
  });

  it("standalone with no url → undefined (renders an unlinked card)", () => {
    expect(productHref({ handle: "x" }, "", "standalone")).toBeUndefined();
  });

  it("shopify with no shop domain → undefined (back-compat: today's fallback)", () => {
    expect(productHref(product, "", "shopify")).toBeUndefined();
    expect(productHref(product, undefined, "shopify")).toBeUndefined();
  });
});
