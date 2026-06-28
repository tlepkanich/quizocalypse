import { describe, it, expect } from "vitest";
import { CURATED_FONTS, isCuratedFont } from "./curatedFonts";

describe("curated fonts (Design Settings §1)", () => {
  it("has ~20 fonts in the spec's category mix (5 serif/8 sans/4 display/3 mono)", () => {
    const by = (cat: string) => CURATED_FONTS.filter((f) => f.category === cat).length;
    expect(CURATED_FONTS).toHaveLength(20);
    expect(by("serif")).toBe(5);
    expect(by("sans")).toBe(8);
    expect(by("display")).toBe(4);
    expect(by("mono")).toBe(3);
  });
  it("isCuratedFont recognizes listed families (and rejects others / undefined)", () => {
    expect(isCuratedFont("Inter")).toBe(true);
    expect(isCuratedFont("Comic Sans MS")).toBe(false);
    expect(isCuratedFont(undefined)).toBe(false);
  });
});
