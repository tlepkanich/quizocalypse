import { describe, it, expect } from "vitest";
import { BRAND_BOOK_SECTIONS, sectionHealth, brandBookSummary, sectionConfidence } from "./brandBook";
import type { BrandIdentity } from "./brandIdentity";
import type { DesignTokens } from "./quizSchema";

const emptyTokens: DesignTokens = {};
const baseIdentity = (over: Partial<BrandIdentity> = {}): BrandIdentity =>
  ({
    schema_version: 1,
    summary: "A calm skincare brand for sensitive skin.",
    tags: ["gentle", "clinical", "warm"],
    descriptions: ["Sensitive-skin skincare."],
    pain_points: [],
    design: { aesthetic: [], imagery_density: "moderate", formality: "balanced", suggested_layout_variant_id: "classic", rationale: "", confidence: "low" },
    positioning: { industry: "Beauty", vertical: "Skincare", target_demographic: [], price_tier: "premium", category_trends: [], rationale: "", confidence: "low" },
    version: 1,
    updated_at: "2026-01-01T00:00:00.000Z",
    confidence: "low",
    sources: [],
    merchant_confirmed: false,
    locked_fields: [],
    ...over,
  }) as unknown as BrandIdentity;

describe("brand book — sections + health", () => {
  it("has the 6 grouped redesign modules (Brand basics → Look & feel)", () => {
    expect(BRAND_BOOK_SECTIONS.map((s) => s.id)).toEqual([
      "identity", "voice", "logo", "colors", "type", "shape", "imagery",
    ]);
    // Grouped: identity/voice under Brand basics, the rest under Look & feel.
    expect(BRAND_BOOK_SECTIONS.filter((s) => s.group === "basics").map((s) => s.id)).toEqual(["identity", "voice"]);
    expect(BRAND_BOOK_SECTIONS.filter((s) => s.group === "lookfeel").map((s) => s.id)).toEqual(["logo", "colors", "type", "shape", "imagery"]);
  });

  it("identity is ok with summary + descriptions, bad when empty", () => {
    expect(sectionHealth("identity", baseIdentity(), emptyTokens)).toBe("ok");
    expect(sectionHealth("identity", null, emptyTokens)).toBe("bad");
    expect(sectionHealth("identity", baseIdentity({ descriptions: [] }), emptyTokens)).toBe("warn");
  });

  it("voice grades on the number of adjectives", () => {
    expect(sectionHealth("voice", baseIdentity({ tags: ["a", "b", "c"] }), emptyTokens)).toBe("ok");
    expect(sectionHealth("voice", baseIdentity({ tags: ["a"] }), emptyTokens)).toBe("warn");
    expect(sectionHealth("voice", baseIdentity({ tags: [] }), emptyTokens)).toBe("bad");
  });

  it("logo is bad with no token url, ok with one", () => {
    expect(sectionHealth("logo", null, emptyTokens)).toBe("bad");
    expect(sectionHealth("logo", null, { logo: { url: "https://x/logo.png" } })).toBe("ok");
  });

  it("colors grade on how many roles are set", () => {
    expect(sectionHealth("colors", null, emptyTokens)).toBe("bad");
    expect(sectionHealth("colors", null, { colors: { primary: "#111" } })).toBe("warn");
    expect(
      sectionHealth("colors", null, {
        colors: { primary: "#111", secondary: "#222", accent: "#333", background: "#fff", text: "#000" },
      }),
    ).toBe("ok");
  });

  it("confidence is shown only for AI-derived sections, null for token-driven ones", () => {
    const id = baseIdentity({ confidence: "high" });
    expect(sectionConfidence("identity", id)).toBe("high");
    expect(sectionConfidence("voice", id)).toBe("high");
    expect(sectionConfidence("imagery", id)).toBe("low"); // reads the design lens
    expect(sectionConfidence("colors", id)).toBeNull();
    expect(sectionConfidence("logo", id)).toBeNull();
    expect(sectionConfidence("shape", id)).toBeNull();
    expect(sectionConfidence("identity", null)).toBeNull();
  });

  it("summary tallies to the section count", () => {
    const s = brandBookSummary(baseIdentity(), { colors: { primary: "#111", secondary: "#222", accent: "#333", background: "#fff", text: "#000" }, logo: { url: "https://x/l.png" } });
    expect(s.total).toBe(7);
    expect(s.ok + s.warn + s.bad).toBe(7);
    expect(s.ok).toBeGreaterThan(0);
  });
});
