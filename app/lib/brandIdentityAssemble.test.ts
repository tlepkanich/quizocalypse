import { describe, expect, it } from "vitest";
import {
  BrandIdentityDraft,
  reconcileDesignTokens,
  rollupConfidence,
  assembleBrandIdentity,
  refineBrandIdentity,
} from "./brandIdentityAssemble";
import { BrandIdentity, type BrandIdentity as BrandIdentityT } from "./brandIdentity";

// A realistic tool-input fixture (what the AI emits — no derived_tokens, no
// provenance). Partial design (defaults fill the rest) to prove the parse fills.
const rawDraft = {
  summary: "A warm, considered skincare brand for routine-minded shoppers.",
  tags: ["clean", "minimalist"],
  descriptions: ["Dermatologist-backed"],
  design: {
    aesthetic: ["polished", "editorial"],
    imagery_density: "sparse",
    color_temperament: "monochrome",
    formality: "refined",
    suggested_theme_preset_id: "editorial",
    suggested_layout_variant_id: "editorial",
    rationale: "Sparse imagery + serif → Editorial.",
    confidence: "high",
  },
  positioning: {
    industry: "Skincare",
    price_tier: "premium",
    target_demographic: ["women 25-40"],
  },
  voice: { tone_description: "Warm and knowing." },
};

const sources = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    kind: "catalog" as const,
    detail: `s${i}`,
    at: "2026-06-13T00:00:00.000Z",
  }));

describe("BrandIdentityDraft (AI-facing shape)", () => {
  it("parses a realistic tool input and fills defaults", () => {
    const parsed = BrandIdentityDraft.safeParse(rawDraft);
    expect(parsed.success).toBe(true);
    // positioning fields the AI omitted get defaults.
    expect(parsed.success && parsed.data.positioning.vertical).toBe("");
    expect(parsed.success && parsed.data.positioning.category_trends).toEqual([]);
  });

  it("rejects a blank summary (the digest can't be empty)", () => {
    expect(BrandIdentityDraft.safeParse({ ...rawDraft, summary: "" }).success).toBe(false);
  });
});

describe("reconcileDesignTokens (preset palette + real brand colors)", () => {
  it("overlays brand primary/secondary onto the preset, preserving the rest", () => {
    // Linen's known palette: bg #F8F6F1, accent #E8623C, primary #1B1A17.
    const t = reconcileDesignTokens("linen", { primary: "#123456", secondary: "#abcdef" });
    expect(t.colors?.primary).toBe("#123456"); // brand wins
    expect(t.colors?.secondary).toBe("#abcdef"); // brand wins
    expect(t.colors?.background).toBe("#F8F6F1"); // preset preserved
    expect(t.colors?.accent).toBe("#E8623C"); // preset preserved
    expect(t.typography).toBeTruthy(); // preset base carried through
  });

  it("uses the preset palette untouched when no brand colors", () => {
    const t = reconcileDesignTokens("linen");
    expect(t.colors?.primary).toBe("#1B1A17");
  });
});

describe("rollupConfidence", () => {
  it("low-volume always low; else scales with source count", () => {
    expect(rollupConfidence(5, true)).toBe("low");
    expect(rollupConfidence(1, false)).toBe("low");
    expect(rollupConfidence(2, false)).toBe("medium");
    expect(rollupConfidence(4, false)).toBe("high");
  });
});

describe("assembleBrandIdentity (draft + signals → full identity)", () => {
  it("produces a valid identity with reconciled tokens + stamped provenance", () => {
    const draft = BrandIdentityDraft.parse(rawDraft);
    const id = assembleBrandIdentity(draft, {
      brandColors: { primary: "#123456" },
      sources: sources(4),
      now: "2026-06-13T00:00:00.000Z",
    });
    expect(BrandIdentity.safeParse(id).success).toBe(true);
    expect(id.design.derived_tokens?.colors?.primary).toBe("#123456");
    expect(id.confidence).toBe("high"); // 4 sources
    expect(id.version).toBe(1);
    expect(id.merchant_confirmed).toBe(false);
    expect(id.locked_fields).toEqual([]);
    expect(id.sources).toHaveLength(4);
  });

  it("low-volume educational hint forces low confidence", () => {
    const draft = BrandIdentityDraft.parse(rawDraft);
    const id = assembleBrandIdentity(draft, {
      sources: sources(4),
      now: "2026-06-13T00:00:00.000Z",
      lowVolumeEducationalHint: true,
    });
    expect(id.confidence).toBe("low");
  });

  it("falls back to the 'classic' layout when the AI's id is unknown (defensive)", () => {
    const draft = BrandIdentityDraft.parse(rawDraft);
    // Force an off-menu layout past the parse (simulate drift).
    (draft.design as { suggested_layout_variant_id: string }).suggested_layout_variant_id =
      "bogus";
    const id = assembleBrandIdentity(draft, { sources: sources(1), now: "x" });
    expect(id.design.suggested_layout_variant_id).toBe("classic");
  });
});

describe("refineBrandIdentity (rebuild + lock preservation)", () => {
  it("re-applies the merchant's locked edits over a fresh rebuild", () => {
    const base: BrandIdentityT = BrandIdentity.parse({
      summary: "fresh",
      design: { suggested_theme_preset_id: "linen", suggested_layout_variant_id: "classic" },
      positioning: {},
      updated_at: "x",
    });
    const fresh = { ...base, summary: "AI re-digest" };
    const current = { ...base, summary: "MERCHANT EDIT", locked_fields: ["summary"] };
    expect(refineBrandIdentity(fresh, current).summary).toBe("MERCHANT EDIT");
  });
});
