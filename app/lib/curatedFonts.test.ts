import { describe, it, expect } from "vitest";
import { CURATED_FONTS, isCuratedFont } from "./curatedFonts";

describe("curated fonts (Design Settings §1)", () => {
  it("keeps the category mix + every friendly-preset family selectable", () => {
    const by = (cat: string) => CURATED_FONTS.filter((f) => f.category === cat).length;
    // 2026-07 friendly-preset redesign grew the list from the spec's 20 so
    // preset faces stay re-selectable in the typography dropdowns.
    expect(CURATED_FONTS).toHaveLength(28);
    expect(by("serif")).toBe(6);
    expect(by("sans")).toBe(15);
    expect(by("display")).toBe(4);
    expect(by("mono")).toBe(3);
    for (const family of [
      "Lora",
      "Nunito Sans",
      "Outfit",
      "Newsreader",
      "Source Sans 3",
      "Bricolage Grotesque",
      "Schibsted Grotesk",
      "Quicksand",
      "Karla",
      "Sora",
      "Figtree",
    ]) {
      expect(isCuratedFont(family), `${family} missing from curated list`).toBe(true);
    }
  });
  it("isCuratedFont recognizes listed families (and rejects others / undefined)", () => {
    expect(isCuratedFont("Inter")).toBe(true);
    expect(isCuratedFont("Comic Sans MS")).toBe(false);
    expect(isCuratedFont(undefined)).toBe(false);
  });
});
