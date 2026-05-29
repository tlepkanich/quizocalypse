import { describe, expect, it } from "vitest";
import { THEME_PRESETS, getPreset } from "./themePresets";
import { findContrastIssues } from "./designTokens";

describe("Theme presets", () => {
  it("ships at least five named presets", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(5);
    const names = new Set(THEME_PRESETS.map((p) => p.id));
    expect(names.has("minimal")).toBe(true);
    expect(names.has("editorial")).toBe(true);
    expect(names.has("bold")).toBe(true);
    expect(names.has("pastel")).toBe(true);
    expect(names.has("dark")).toBe(true);
  });

  it("getPreset returns the named preset", () => {
    const p = getPreset("dark");
    expect(p?.name).toBe("Dark");
  });

  it("getPreset returns undefined for unknown ids", () => {
    expect(getPreset("nonexistent")).toBeUndefined();
  });

  it("every preset defines all six color roles", () => {
    for (const preset of THEME_PRESETS) {
      const c = preset.tokens.colors ?? {};
      expect(c.primary, `${preset.id} missing primary`).toBeTruthy();
      expect(c.secondary, `${preset.id} missing secondary`).toBeTruthy();
      expect(c.accent, `${preset.id} missing accent`).toBeTruthy();
      expect(c.background, `${preset.id} missing background`).toBeTruthy();
      expect(c.text, `${preset.id} missing text`).toBeTruthy();
      expect(c.muted, `${preset.id} missing muted`).toBeTruthy();
    }
  });

  it("text-on-background contrast passes AA on every preset", () => {
    for (const preset of THEME_PRESETS) {
      const issues = findContrastIssues(preset.tokens);
      // "Text on background" is the most important axis — fail loudly if a
      // preset would land a shopper on unreadable copy. Other warnings
      // (muted on bg, etc.) are advisory.
      const textIssue = issues.find((i) => i.pair === "Text on background");
      expect(
        textIssue,
        `Preset "${preset.id}" fails AA text contrast: ${textIssue?.ratio.toFixed(2)}:1`,
      ).toBeUndefined();
    }
  });
});
