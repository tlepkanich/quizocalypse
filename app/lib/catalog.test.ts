import { describe, it, expect } from "vitest";
import { ManualProductInput, isManualId } from "./catalog.server";

describe("ManualProductInput", () => {
  it("parses a full valid product", () => {
    const r = ManualProductInput.parse({
      title: "Hydrating Serum",
      url: "https://store.com/serum",
      imageUrl: "https://store.com/serum.jpg",
      price: "29.00",
      tags: ["dry-skin", "serum"],
      description: "A serum.",
    });
    expect(r.title).toBe("Hydrating Serum");
    expect(r.url).toBe("https://store.com/serum");
    expect(r.price).toBe(29); // coerced from string
    expect(r.tags).toEqual(["dry-skin", "serum"]);
  });

  it("requires a title", () => {
    expect(ManualProductInput.safeParse({ title: "" }).success).toBe(false);
    expect(ManualProductInput.safeParse({ title: "   " }).success).toBe(false);
  });

  it("treats empty url/imageUrl/price as undefined (not errors)", () => {
    const r = ManualProductInput.parse({ title: "X", url: "", imageUrl: "", price: "" });
    expect(r.url).toBeUndefined();
    expect(r.imageUrl).toBeUndefined();
    expect(r.price).toBeUndefined();
  });

  it("rejects a malformed url", () => {
    expect(ManualProductInput.safeParse({ title: "X", url: "not a url" }).success).toBe(false);
  });

  it("defaults tags to an empty array", () => {
    expect(ManualProductInput.parse({ title: "X" }).tags).toEqual([]);
  });
});

describe("isManualId", () => {
  it("recognizes manual ids and rejects Shopify GIDs", () => {
    expect(isManualId("man_abc123")).toBe(true);
    expect(isManualId("gid://shopify/Product/123")).toBe(false);
    expect(isManualId("")).toBe(false);
  });
});
