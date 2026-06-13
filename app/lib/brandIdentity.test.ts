import { describe, expect, it } from "vitest";
import {
  BrandIdentity,
  parseBrandIdentitySafe,
  identityToBrandGuidelines,
  applyLocks,
  lockEditedFields,
  type BrandIdentity as BrandIdentityT,
} from "./brandIdentity";
import { buildBrandVoiceAddition } from "./brandGuidelines";

const base = (over: Partial<BrandIdentityT> = {}): BrandIdentityT =>
  BrandIdentity.parse({
    summary: "A warm, considered skincare brand for routine-minded shoppers.",
    tags: ["clean", "minimalist"],
    descriptions: ["Dermatologist-backed", "Fragrance-free first"],
    design: {
      aesthetic: ["polished", "editorial", "minimal"],
      imagery_density: "sparse",
      color_temperament: "monochrome",
      formality: "refined",
      suggested_theme_preset_id: "editorial",
      suggested_layout_variant_id: "editorial",
      rationale: "Sparse imagery + serif voice → Editorial.",
      confidence: "high",
    },
    positioning: {
      industry: "Skincare",
      vertical: "clean beauty",
      target_demographic: ["women 25-40"],
      price_tier: "premium",
      category_trends: ["barrier repair", "fragrance-free"],
      confidence: "medium",
    },
    voice: { tone_description: "Warm and knowing, never preachy." },
    updated_at: "2026-06-13T00:00:00.000Z",
    confidence: "medium",
    sources: [{ kind: "catalog", detail: "42 products", at: "2026-06-13T00:00:00.000Z" }],
    ...over,
  });

describe("BrandIdentity model", () => {
  it("round-trips a full valid identity and fills defaults", () => {
    const id = base();
    expect(BrandIdentity.safeParse(id).success).toBe(true);
    expect(id.schema_version).toBe(1);
    expect(id.version).toBe(1);
    expect(id.merchant_confirmed).toBe(false);
    expect(id.locked_fields).toEqual([]);
  });

  it("parseBrandIdentitySafe returns null on garbage / null / wrong schema_version", () => {
    expect(parseBrandIdentitySafe(null)).toBeNull();
    expect(parseBrandIdentitySafe({ nope: true })).toBeNull();
    expect(parseBrandIdentitySafe("")).toBeNull();
    // A future shape (version 2) safe-fails the literal → treated as no identity.
    expect(parseBrandIdentitySafe({ ...base(), schema_version: 2 })).toBeNull();
  });

  it("requires a non-empty summary (the cheat code can't be blank)", () => {
    expect(BrandIdentity.safeParse({ ...base(), summary: "" }).success).toBe(false);
  });
});

describe("identityToBrandGuidelines (dormant adapter)", () => {
  it("yields a buildBrandVoiceAddition-consumable object", () => {
    const g = identityToBrandGuidelines(base());
    expect(g).not.toBeNull();
    expect(g!.name).toBe("Skincare");
    const addition = buildBrandVoiceAddition(g);
    expect(addition).toContain("Brand: Skincare");
    expect(addition).toContain("Warm and knowing");
  });

  it("carries derived_tokens into visual_suggestions when present", () => {
    const g = identityToBrandGuidelines(
      base({
        design: { ...base().design, derived_tokens: { colors: { primary: "#111111" } } },
      }),
    );
    expect(g!.visual_suggestions.tokens?.colors?.primary).toBe("#111111");
  });

  it("returns null when there is no voice (prompt path stays byte-identical)", () => {
    expect(identityToBrandGuidelines(base({ voice: undefined }))).toBeNull();
    expect(identityToBrandGuidelines(null)).toBeNull();
  });

  it("falls back to the 'Brand' name when industry is blank", () => {
    const g = identityToBrandGuidelines(
      base({ positioning: { ...base().positioning, industry: "" } }),
    );
    expect(g!.name).toBe("Brand");
  });
});

describe("applyLocks (lock-preserving merge)", () => {
  it("preserves a merchant edit at a nested dot-path across a rebuild", () => {
    const prior = base({
      summary: "MERCHANT EDIT — the real story.",
      positioning: { ...base().positioning, price_tier: "luxury" },
      locked_fields: ["summary", "positioning.price_tier"],
    });
    const fresh = base({
      summary: "AI re-digest that should NOT win.",
      positioning: { ...base().positioning, price_tier: "mid" },
    });
    const merged = applyLocks(fresh, prior);
    expect(merged.summary).toBe("MERCHANT EDIT — the real story.");
    expect(merged.positioning.price_tier).toBe("luxury");
    // Non-locked fields take the fresh value.
    expect(merged.design.suggested_theme_preset_id).toBe(
      fresh.design.suggested_theme_preset_id,
    );
  });

  it("unions the lock lists so protection survives", () => {
    const prior = base({ locked_fields: ["summary"] });
    const fresh = base({ locked_fields: ["tags"] });
    const merged = applyLocks(fresh, prior);
    expect(merged.locked_fields.sort()).toEqual(["summary", "tags"]);
  });

  it("is a no-op clone when prior has no locks", () => {
    const prior = base();
    const fresh = base({ summary: "fresh wins" });
    expect(applyLocks(fresh, prior).summary).toBe("fresh wins");
  });

  it("skips a lock that points at nothing on prior (never clobbers with undefined)", () => {
    // 'voice.tone_description' isn't present on a prior with no voice.
    const prior = base({ voice: undefined, locked_fields: ["voice.tone_description"] });
    const fresh = base();
    const merged = applyLocks(fresh, prior);
    expect(merged.voice?.tone_description).toBe("Warm and knowing, never preachy.");
  });
});

describe("lockEditedFields (merchant edit → lock, P4)", () => {
  it("locks only the editable paths that changed, unioned with existing locks", () => {
    const stored = base({ locked_fields: ["summary"] });
    const edited = base({
      tags: ["clean", "minimalist", "NEW-TAG"], // changed
      positioning: { ...base().positioning, price_tier: "luxury" }, // changed (was premium)
      locked_fields: ["summary"],
    });
    const locks = lockEditedFields(edited, stored).sort();
    expect(locks).toEqual(["positioning.price_tier", "summary", "tags"]);
  });

  it("returns just the existing locks when nothing editable changed", () => {
    const stored = base({ locked_fields: ["summary"] });
    expect(lockEditedFields(base({ locked_fields: ["summary"] }), stored)).toEqual(["summary"]);
  });
});
