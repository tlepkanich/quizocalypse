import { describe, expect, it } from "vitest";
import {
  BRAND_VOICE_PRESETS,
  getPreset,
} from "./brandVoicePresets";
import { BrandGuidelines } from "./brandGuidelines";

describe("BRAND_VOICE_PRESETS", () => {
  it("ships exactly 8 presets", () => {
    expect(BRAND_VOICE_PRESETS.length).toBe(8);
  });

  it("has unique ids and labels", () => {
    const ids = BRAND_VOICE_PRESETS.map((p) => p.id);
    const labels = BRAND_VOICE_PRESETS.map((p) => p.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("every preset's guidelines parses cleanly against the schema", () => {
    for (const preset of BRAND_VOICE_PRESETS) {
      const parsed = BrandGuidelines.safeParse(preset.guidelines);
      expect(
        parsed.success,
        `${preset.id} failed: ${
          parsed.success
            ? ""
            : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        }`,
      ).toBe(true);
    }
  });

  it("every preset has at least 3 do-list and 3 dont-list entries", () => {
    for (const preset of BRAND_VOICE_PRESETS) {
      expect(
        preset.guidelines.voice.do_list.length,
        `${preset.id} has fewer than 3 do_list entries`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        preset.guidelines.voice.dont_list.length,
        `${preset.id} has fewer than 3 dont_list entries`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("every preset has at least 2 sample_phrases", () => {
    for (const preset of BRAND_VOICE_PRESETS) {
      expect(
        preset.guidelines.voice.sample_phrases.length,
        `${preset.id} has fewer than 2 sample_phrases`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("every preset uses file_kind=preset and the hand-curated model marker", () => {
    for (const preset of BRAND_VOICE_PRESETS) {
      expect(preset.guidelines.source.file_kind).toBe("preset");
      expect(preset.guidelines.source.extraction_model).toBe("hand-curated");
    }
  });

  it("every preset names an inspiration", () => {
    for (const preset of BRAND_VOICE_PRESETS) {
      expect(
        preset.inspiration.length,
        `${preset.id} missing inspiration`,
      ).toBeGreaterThan(0);
      expect(preset.inspiration.startsWith("Inspired by")).toBe(true);
    }
  });

  it("getPreset returns undefined for unknown ids", () => {
    expect(getPreset("nonexistent")).toBeUndefined();
  });

  it("getPreset returns the matching preset by id", () => {
    const p = getPreset("minimalist-precision");
    expect(p?.label).toBe("Minimalist precision");
  });

  it("every preset carries a full theme in visual_suggestions.tokens", () => {
    // Catch drive-by edits that strip the theme off a preset — picking a
    // voice should always also switch the visual surface.
    for (const preset of BRAND_VOICE_PRESETS) {
      const tokens = preset.guidelines.visual_suggestions.tokens;
      expect(
        tokens,
        `${preset.id} has no visual_suggestions.tokens`,
      ).toBeDefined();
      expect(
        tokens?.colors?.primary,
        `${preset.id} missing colors.primary`,
      ).toBeTruthy();
      expect(
        tokens?.colors?.background,
        `${preset.id} missing colors.background`,
      ).toBeTruthy();
      expect(
        tokens?.colors?.text,
        `${preset.id} missing colors.text`,
      ).toBeTruthy();
      expect(
        tokens?.typography?.body?.family,
        `${preset.id} missing typography.body.family`,
      ).toBeTruthy();
    }
  });
});
