import { describe, it, expect } from "vitest";
import { brandSeedTokens, isUntouchedHouseTokens, BRAND_TEMPLATE_ID } from "./brandSeed";
import { BrandIdentity } from "./brandIdentity";
import { HOUSE_TOKENS } from "./themePresets";
import { Quiz } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";
import type { DesignTokensT } from "./designTokens";

// A valid identity with defaults filled; `over` merges into design.derived_tokens.
function identity(derived?: DesignTokensT | null): BrandIdentity {
  return BrandIdentity.parse({
    summary: "A test brand.",
    design: derived === null ? {} : { derived_tokens: derived },
    positioning: {},
    updated_at: "2026-07-08T00:00:00.000Z",
  });
}

const BRAND_PACK: DesignTokensT = {
  colors: {
    primary: "#123456",
    secondary: "#654321",
    accent: "#abcdef",
    background: "#0C1018",
    text: "#E9EEF7",
    muted: "#8B95A7",
  },
  typography: {
    heading: { family: "Geist", source: "google", weight: 600 },
    body: { family: "Geist", source: "google", base_size: 16, scale_ratio: 1.25 },
  },
  radius: "rounded",
  button_style: "filled",
  spacing: "normal",
  shadow: "elevated",
};

describe("brandSeedTokens", () => {
  it("returns null for a null identity", () => {
    expect(brandSeedTokens(null)).toBeNull();
  });

  it("returns null when the design director produced no derived_tokens", () => {
    expect(brandSeedTokens(identity(null))).toBeNull();
  });

  it("returns null for an empty derived_tokens pack", () => {
    expect(brandSeedTokens(identity({}))).toBeNull();
  });

  it("returns the derived pack stamped with the brand template id", () => {
    const seeded = brandSeedTokens(identity(BRAND_PACK));
    expect(seeded).not.toBeNull();
    expect(seeded?.template_id).toBe(BRAND_TEMPLATE_ID);
    expect(seeded?.colors?.primary).toBe("#123456");
    // Everything else carried through verbatim.
    expect(seeded?.typography?.heading?.family).toBe("Geist");
    expect(seeded?.shadow).toBe("elevated");
  });

  it("produces a pack the Quiz schema accepts as design_tokens", () => {
    const seeded = brandSeedTokens(identity(BRAND_PACK));
    const parsed = Quiz.safeParse({ ...buildSeedQuiz("Test"), design_tokens: seeded });
    expect(parsed.success).toBe(true);
  });
});

describe("isUntouchedHouseTokens", () => {
  it("is true for a pristine HOUSE_TOKENS pack", () => {
    expect(isUntouchedHouseTokens(HOUSE_TOKENS)).toBe(true);
  });

  it("is true regardless of key order (schema-parsed round-trip)", () => {
    const roundTripped = Quiz.parse({
      ...buildSeedQuiz("Test"),
      design_tokens: HOUSE_TOKENS,
    }).design_tokens;
    expect(isUntouchedHouseTokens(roundTripped)).toBe(true);
  });

  it("is false once a template_id is stamped (merchant picked a look)", () => {
    expect(isUntouchedHouseTokens({ ...HOUSE_TOKENS, template_id: "linen" })).toBe(false);
  });

  it("is false for a brand-seeded pack", () => {
    expect(isUntouchedHouseTokens(brandSeedTokens(identity(BRAND_PACK)))).toBe(false);
  });

  it("is false when a token value differs from house", () => {
    expect(
      isUntouchedHouseTokens({
        ...HOUSE_TOKENS,
        colors: { ...HOUSE_TOKENS.colors!, primary: "#000000" },
      }),
    ).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(isUntouchedHouseTokens(null)).toBe(false);
    expect(isUntouchedHouseTokens(undefined)).toBe(false);
  });
});
