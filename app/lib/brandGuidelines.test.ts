import { describe, expect, it } from "vitest";
import {
  BrandGuidelines,
  buildBrandVoiceAddition,
  parseBrandGuidelinesSafe,
  type BrandGuidelines as BrandGuidelinesT,
} from "./brandGuidelines";

function fixture(over: Partial<BrandGuidelinesT> = {}): BrandGuidelinesT {
  return BrandGuidelines.parse({
    name: "Test brand",
    voice: {
      tone_description: "Warm and grounded.",
      do_list: ["Use second person"],
      dont_list: ["No exclamation marks"],
      sample_phrases: ["Good to have you here."],
      forbidden_phrases: ["amazing", "revolutionary"],
    },
    source: {
      uploaded_at: "2026-05-30T12:00:00.000Z",
      file_kind: "pdf",
      extraction_model: "claude-sonnet-4-6",
    },
    ...over,
  });
}

describe("BrandGuidelines schema", () => {
  it("rejects missing voice.tone_description", () => {
    expect(() =>
      BrandGuidelines.parse({
        name: "x",
        voice: { tone_description: "" },
        source: {
          uploaded_at: "x",
          file_kind: "pdf",
          extraction_model: "x",
        },
      }),
    ).toThrow();
  });

  it("applies sensible defaults", () => {
    const parsed = BrandGuidelines.parse({
      voice: { tone_description: "Friendly." },
      source: {
        uploaded_at: "x",
        file_kind: "preset",
        extraction_model: "hand-curated",
      },
    });
    expect(parsed.name).toBe("Brand");
    expect(parsed.voice.do_list).toEqual([]);
    expect(parsed.voice.forbidden_phrases).toEqual([]);
    expect(parsed.visual_suggestions.notes).toEqual([]);
  });

  it("accepts the new 'preset' file_kind", () => {
    expect(() =>
      BrandGuidelines.parse({
        voice: { tone_description: "x" },
        source: {
          uploaded_at: "x",
          file_kind: "preset",
          extraction_model: "hand-curated",
        },
      }),
    ).not.toThrow();
  });
});

describe("buildBrandVoiceAddition", () => {
  it("returns empty string when guidelines are null", () => {
    expect(buildBrandVoiceAddition(null)).toBe("");
    expect(buildBrandVoiceAddition(undefined)).toBe("");
  });

  it("includes the BRAND VOICE header and tone description", () => {
    const out = buildBrandVoiceAddition(fixture());
    expect(out).toContain("--- BRAND VOICE");
    expect(out).toContain("Warm and grounded.");
    expect(out).toContain("Brand: Test brand");
  });

  it("includes Do/Don't/Sample/Never sections when populated", () => {
    const out = buildBrandVoiceAddition(fixture());
    expect(out).toContain("Do: ");
    expect(out).toContain("Use second person");
    expect(out).toContain("Don't: ");
    expect(out).toContain("No exclamation marks");
    expect(out).toContain("Sample phrasing");
    expect(out).toContain("Never use");
    expect(out).toContain("amazing");
  });

  it("omits Do/Don't/Sample/Never sections when their lists are empty", () => {
    const minimal = fixture({
      voice: {
        tone_description: "Plain.",
        do_list: [],
        dont_list: [],
        sample_phrases: [],
        forbidden_phrases: [],
      },
    });
    const out = buildBrandVoiceAddition(minimal);
    expect(out).not.toContain("Do: ");
    expect(out).not.toContain("Don't: ");
    expect(out).not.toContain("Sample phrasing");
    expect(out).not.toContain("Never use");
  });

  it("starts with newlines so it concatenates onto an existing prompt cleanly", () => {
    const out = buildBrandVoiceAddition(fixture());
    expect(out.startsWith("\n")).toBe(true);
  });
});

describe("parseBrandGuidelinesSafe", () => {
  it("returns null for null/undefined input", () => {
    expect(parseBrandGuidelinesSafe(null)).toBeNull();
    expect(parseBrandGuidelinesSafe(undefined)).toBeNull();
  });

  it("returns null for garbage input rather than throwing", () => {
    expect(parseBrandGuidelinesSafe({ garbage: true })).toBeNull();
    expect(parseBrandGuidelinesSafe("not an object")).toBeNull();
  });

  it("returns a typed value for valid input", () => {
    const valid = fixture();
    const out = parseBrandGuidelinesSafe(valid);
    expect(out?.name).toBe("Test brand");
  });
});
