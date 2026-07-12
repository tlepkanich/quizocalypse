import { describe, expect, it } from "vitest";
import { THEME_PRESETS, getPreset, HOUSE_TOKENS, STANDALONE_MINIMAL_TOKENS } from "./themePresets";
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

  it("leads with the Linen house theme (warm friendly)", () => {
    expect(THEME_PRESETS[0]?.id).toBe("linen");
    const p = getPreset("linen");
    expect(p?.name).toBe("Linen");
    expect(p?.tokens).toBe(HOUSE_TOKENS);
    expect(p?.tokens.colors?.background).toBe("#FBF4EC"); // apricot ivory
    expect(p?.tokens.colors?.primary).toBe("#AD4B2E"); // terracotta CTA
    expect(p?.tokens.typography?.heading?.family).toBe("Lora");
    expect(p?.tokens.typography?.body?.family).toBe("Nunito Sans");
  });

  it("white button labels pass AA on every preset", () => {
    // buttonStyle renders filled CTAs as white-on-primary; the friendly
    // redesign promises that axis holds even for outline presets (whose
    // primary doubles as border/label ink).
    for (const preset of THEME_PRESETS) {
      const issue = findContrastIssues(preset.tokens).find(
        (i) => i.pair === "Primary button label on primary",
      );
      expect(
        issue,
        `Preset "${preset.id}" fails white-on-primary: ${issue?.ratio.toFixed(2)}:1`,
      ).toBeUndefined();
    }
  });

  it("accent-on-background passes 3:1 on every preset", () => {
    for (const preset of THEME_PRESETS) {
      const issue = findContrastIssues(preset.tokens).find(
        (i) => i.pair === "Accent on background",
      );
      expect(
        issue,
        `Preset "${preset.id}" fails accent contrast: ${issue?.ratio.toFixed(2)}:1`,
      ).toBeUndefined();
    }
  });

  it("no preset uses a face from the AI-overused font list", () => {
    const overused = new Set([
      "Inter",
      "Roboto",
      "Fraunces",
      "Geist",
      "Plus Jakarta Sans",
      "Space Grotesk",
    ]);
    for (const preset of THEME_PRESETS) {
      expect(
        overused.has(preset.tokens.typography?.heading?.family ?? ""),
        `${preset.id} heading uses an overused face`,
      ).toBe(false);
      expect(
        overused.has(preset.tokens.typography?.body?.family ?? ""),
        `${preset.id} body uses an overused face`,
      ).toBe(false);
    }
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
      // preset would land a shopper on unreadable copy. (Muted-on-background
      // is enforced separately below.)
      const textIssue = issues.find((i) => i.pair === "Text on background");
      expect(
        textIssue,
        `Preset "${preset.id}" fails AA text contrast: ${textIssue?.ratio.toFixed(2)}:1`,
      ).toBeUndefined();
    }
  });

  it("muted-on-background contrast passes AA on every preset", () => {
    // Muted/secondary copy (subtext, captions, helper text) is content a shopper
    // reads — an axe scan caught the Linen + Pastel presets shipping muted colors
    // below 4.5:1. Enforce AA so a preset can never land unreadable secondary text.
    const all = [
      ...THEME_PRESETS.map((p) => ({ id: p.id, tokens: p.tokens })),
      { id: "standalone-minimal", tokens: STANDALONE_MINIMAL_TOKENS },
    ];
    for (const { id, tokens } of all) {
      const muted = findContrastIssues(tokens).find((i) => i.pair === "Muted on background");
      expect(
        muted,
        `Preset "${id}" fails AA muted contrast: ${muted?.ratio.toFixed(2)}:1 (need 4.5)`,
      ).toBeUndefined();
    }
  });
});
