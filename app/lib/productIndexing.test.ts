import { describe, expect, it } from "vitest";
import { NOT_A_VALUE_RE, flattenMetafields, variantOptionsOf } from "./productIndexing";
import { filterAnswerMatchCount } from "./filterMatching";
import type { IndexedProduct } from "./recommendationEngine";

// Logic-step handoff §7 bugs 1 + 4 — the index fixes the whole design sits on.

describe("flattenMetafields (§7 bug 1 + 4)", () => {
  it("keeps scalar values and the {value,type} envelope", () => {
    expect(
      flattenMetafields({
        "custom.metal": { value: "gold vermeil", type: "single_line_text_field" },
        "custom.plain": "sterling silver",
      }),
    ).toEqual({ "custom.metal": "gold vermeil", "custom.plain": "sterling silver" });
  });

  it("splits list.* metafields into comma-joined member values", () => {
    expect(
      flattenMetafields({
        "shopify.jewelry-material": {
          value: '["gold vermeil","sterling silver"]',
          type: "list.metaobject_reference",
        },
      }),
    ).toEqual({ "shopify.jewelry-material": "gold vermeil, sterling silver" });
  });

  it("drops N/A-family values — scalar, and inside lists", () => {
    expect(
      flattenMetafields({
        "custom.a": { value: "N/A", type: "single_line_text_field" },
        "custom.b": { value: "none", type: "single_line_text_field" },
        "custom.c": { value: "—", type: "single_line_text_field" },
        "custom.keep": { value: "real", type: "single_line_text_field" },
        "custom.list": { value: '["N/A","gold"]', type: "list.single_line_text_field" },
      }),
    ).toEqual({ "custom.keep": "real", "custom.list": "gold" });
    for (const bad of ["n/a", "N/A.", "na", "null", "-", " none "]) {
      expect(NOT_A_VALUE_RE.test(bad)).toBe(true);
    }
    expect(NOT_A_VALUE_RE.test("navy")).toBe(false);
    expect(NOT_A_VALUE_RE.test("none of the above")).toBe(false);
  });

  it("a non-JSON list value keeps the raw string (never throws)", () => {
    expect(
      flattenMetafields({
        "custom.odd": { value: "not json", type: "list.single_line_text_field" },
      }),
    ).toEqual({ "custom.odd": "not json" });
  });

  it("variantOptionsOf skips the Default Title placeholder", () => {
    expect(
      variantOptionsOf([
        { options: [{ name: "Title", value: "Default Title" }] },
        { options: [{ name: "Size", value: "16 inch" }, { name: "Size", value: "16 inch" }] },
      ]),
    ).toEqual({ Size: ["16 inch"] });
  });
});

describe("metafield matching over split list values (§7 bug 1, match side)", () => {
  const P = (metafields: Record<string, string>): IndexedProduct => ({
    product_id: "p1",
    title: "P",
    handle: "p",
    price: "10",
    image_url: null,
    tags: [],
    collection_ids: [],
    inventory_in_stock: true,
    metafields,
  });
  const answer = (value: string) =>
    ({
      id: "a1",
      text: "A",
      tags: [],
      edge_handle_id: "h1",
      metafield_filters: [{ key: "custom.metal", value }],
    }) as never;

  it("a mapped value matches any member of a comma-joined bake", () => {
    const idx = [P({ "custom.metal": "gold vermeil, sterling silver" })];
    expect(filterAnswerMatchCount(answer("sterling silver"), idx)).toBe(1);
    expect(filterAnswerMatchCount(answer("Gold Vermeil"), idx)).toBe(1);
    expect(filterAnswerMatchCount(answer("pearl"), idx)).toBe(0);
  });

  it("whole-string equality still matches (pre-fix behavior kept)", () => {
    const idx = [P({ "custom.metal": "gold vermeil, sterling silver" })];
    expect(filterAnswerMatchCount(answer("gold vermeil, sterling silver"), idx)).toBe(1);
  });
});
