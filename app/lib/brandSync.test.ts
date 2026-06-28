import { describe, it, expect } from "vitest";
import { applyBrandToDesign } from "./brandSync";
import { DEFAULT_TOKENS } from "./designTokens";

describe("applyBrandToDesign (Design Settings §1 re-sync)", () => {
  it("overlays brand colors and reports them as applied", () => {
    const { next, applied } = applyBrandToDesign(DEFAULT_TOKENS, {
      colors: { primary: "#C81E5A", background: "#FFF8F0" },
    });
    expect(next.colors?.primary).toBe("#C81E5A");
    expect(next.colors?.background).toBe("#FFF8F0");
    // untouched slots are preserved from the original design
    expect(next.colors?.text).toBe(DEFAULT_TOKENS.colors?.text);
    expect(applied).toEqual(["colors"]);
  });

  it("overlays heading/body fonts while keeping other typography fields", () => {
    const { next, applied } = applyBrandToDesign(DEFAULT_TOKENS, {
      typography: { heading: { family: "Playfair Display" } },
    });
    expect(next.typography?.heading?.family).toBe("Playfair Display");
    // body untouched; heading keeps its source if any
    expect(next.typography?.body?.family).toBe(DEFAULT_TOKENS.typography?.body?.family);
    expect(applied).toEqual(["fonts"]);
  });

  it("overlays a logo and merges colors+fonts+logo together", () => {
    const { next, applied } = applyBrandToDesign(DEFAULT_TOKENS, {
      colors: { primary: "#111111" },
      typography: { body: { family: "DM Sans" } },
      logo: { url: "https://cdn.shop.com/logo.png", size: "md" },
    });
    expect(next.logo?.url).toBe("https://cdn.shop.com/logo.png");
    expect(applied).toEqual(["colors", "fonts", "logo"]);
  });

  it("applies nothing for an empty brand (and never mutates the input)", () => {
    const before = JSON.stringify(DEFAULT_TOKENS);
    const { next, applied } = applyBrandToDesign(DEFAULT_TOKENS, {});
    expect(applied).toEqual([]);
    expect(next.colors).toEqual(DEFAULT_TOKENS.colors);
    expect(JSON.stringify(DEFAULT_TOKENS)).toBe(before);
  });
});
