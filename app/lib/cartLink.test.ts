import { describe, expect, it } from "vitest";
import { numericId, cartPermalink , cartPermalinkMulti } from "./cartLink";

describe("numericId", () => {
  it("extracts the numeric id from a variant gid", () => {
    expect(numericId("gid://shopify/ProductVariant/123")).toBe("123");
    expect(numericId("gid://shopify/Product/98765")).toBe("98765");
  });
  it("passes through an already-numeric id", () => {
    expect(numericId("456")).toBe("456");
  });
  it("returns null for empty/invalid input", () => {
    expect(numericId(null)).toBeNull();
    expect(numericId(undefined)).toBeNull();
    expect(numericId("")).toBeNull();
    expect(numericId("gid://shopify/ProductVariant/")).toBeNull();
    expect(numericId("no-numbers")).toBeNull();
  });
});

describe("cartPermalink", () => {
  const SHOP = "demo.myshopify.com";
  it("builds /cart/{id}:{qty} from a gid", () => {
    expect(cartPermalink(SHOP, "gid://shopify/ProductVariant/123", 1)).toBe(
      "https://demo.myshopify.com/cart/123:1",
    );
    expect(cartPermalink(SHOP, "gid://shopify/ProductVariant/123", 2)).toBe(
      "https://demo.myshopify.com/cart/123:2",
    );
  });
  it("appends an encoded discount code when present", () => {
    expect(cartPermalink(SHOP, "gid://shopify/ProductVariant/123", 1, "QUIZ-10")).toBe(
      "https://demo.myshopify.com/cart/123:1?discount=QUIZ-10",
    );
    expect(cartPermalink(SHOP, "gid://shopify/ProductVariant/9", 1, "SAVE 20%")).toBe(
      "https://demo.myshopify.com/cart/9:1?discount=SAVE%2020%25",
    );
  });
  it("ignores a blank discount", () => {
    expect(cartPermalink(SHOP, "gid://shopify/ProductVariant/123", 1, "  ")).toBe(
      "https://demo.myshopify.com/cart/123:1",
    );
  });
  it("clamps a bad quantity to 1", () => {
    expect(cartPermalink(SHOP, "1", 0)).toBe("https://demo.myshopify.com/cart/1:1");
    expect(cartPermalink(SHOP, "1", -3)).toBe("https://demo.myshopify.com/cart/1:1");
  });
  it("returns null when shop domain or variant is missing", () => {
    expect(cartPermalink(null, "gid://shopify/ProductVariant/1")).toBeNull();
    expect(cartPermalink(SHOP, null)).toBeNull();
    expect(cartPermalink(SHOP, "no-id")).toBeNull();
  });
});

describe("cartPermalinkMulti (E5)", () => {
  it("joins variant:qty pairs, skips unresolvable, carries the discount", () => {
    expect(
      cartPermalinkMulti("shop.example.com", [
        "gid://shopify/ProductVariant/11",
        "not-a-gid",
        "22",
      ], "SAVE10"),
    ).toBe("https://shop.example.com/cart/11:1,22:1?discount=SAVE10");
    expect(cartPermalinkMulti("shop.example.com", [null, "junk"])).toBeNull();
    expect(cartPermalinkMulti(null, ["11"])).toBeNull();
  });
});
