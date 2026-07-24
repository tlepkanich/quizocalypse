import { describe, expect, it } from "vitest";
import { DesignAiPatch, DESIGN_AI_SYSTEM_PROMPT, describeTokensForPrompt } from "./ai/designAi";
import { CURATED_FONTS } from "./curatedFonts";
import { applyDesignAiPatch, ensureReadableTokens, mixHex } from "./designAiPatch";
import { contrastRatio, type DesignTokensT } from "./designTokens";

// ── BLD-2: the AI response schema (the boundary gate) ────────────────────────

describe("DesignAiPatch schema", () => {
  it("accepts a full valid patch", () => {
    const parsed = DesignAiPatch.safeParse({
      colors: { primary: "#B04A2E", background: "#F6F1E7", text: "#2B2620" },
      heading_font: "Fraunces",
      body_font: "Karla",
      button_radius: 22,
      answer_softness: 70,
      page_padding: 40,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.heading_font).toBe("Fraunces");
      expect(parsed.data.button_radius).toBe(22);
    }
  });

  it("rejects a font that is not on the curated list", () => {
    const parsed = DesignAiPatch.safeParse({ heading_font: "Comic Sans MS" });
    expect(parsed.success).toBe(false);
    const body = DesignAiPatch.safeParse({ body_font: "Helvetica Neue" });
    expect(body.success).toBe(false);
  });

  it("clamps out-of-range numerics to the controls' ranges (never rejects)", () => {
    const parsed = DesignAiPatch.safeParse({
      button_radius: 100,
      answer_softness: -20,
      page_padding: 500,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.button_radius).toBe(48); // panel max
      expect(parsed.data.answer_softness).toBe(0); // panel min
      expect(parsed.data.page_padding).toBe(120); // panel max
    }
  });

  it("rejects non-#rrggbb colors", () => {
    expect(DesignAiPatch.safeParse({ colors: { primary: "cream" } }).success).toBe(false);
    expect(DesignAiPatch.safeParse({ colors: { background: "#fff" } }).success).toBe(false);
    expect(DesignAiPatch.safeParse({ colors: { background: "#f6f1e7" } }).success).toBe(true);
  });

  it("strips unknown fields instead of failing (defensive to model drift)", () => {
    const parsed = DesignAiPatch.safeParse({ button_radius: 10, vibe: "editorial" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("vibe" in parsed.data).toBe(false);
  });
});

describe("DESIGN_AI_SYSTEM_PROMPT", () => {
  it("names every curated font family (the AI's whitelist IS the dropdowns')", () => {
    for (const f of CURATED_FONTS) {
      expect(DESIGN_AI_SYSTEM_PROMPT).toContain(f.family);
    }
  });
  it("states the control ranges and the contrast bar", () => {
    expect(DESIGN_AI_SYSTEM_PROMPT).toContain("0-48");
    expect(DESIGN_AI_SYSTEM_PROMPT).toContain("0-100");
    expect(DESIGN_AI_SYSTEM_PROMPT).toContain("0-120");
    expect(DESIGN_AI_SYSTEM_PROMPT).toContain("4.5:1");
  });
});

describe("describeTokensForPrompt", () => {
  it("summarizes set fields and falls back for empty tokens", () => {
    expect(describeTokensForPrompt({})).toBe("(house defaults)");
    const s = describeTokensForPrompt({
      colors: { primary: "#5563de", background: "#ffffff" },
      typography: { heading: { family: "Fraunces" } },
      button_radius: 10,
      style_bar: { lines: 50 },
      page_padding: { top: 24, right: 24, bottom: 24, left: 24 },
    });
    expect(s).toContain("primary #5563de");
    expect(s).toContain("heading font Fraunces");
    expect(s).toContain("button_radius 10px");
    expect(s).toContain("answer_softness 50");
    expect(s).toContain("page_padding 24px");
  });
});

// ── applyDesignAiPatch (the Global-panel-shaped merge) ───────────────────────

describe("applyDesignAiPatch", () => {
  const base: DesignTokensT = {
    colors: { primary: "#5563de", background: "#ffffff", text: "#1f1f1f" },
    typography: {
      heading: { family: "Inter", source: "system" },
      body: { family: "Inter", source: "system", base_size: 16 },
    },
    template_id: "linen",
    chrome: "minimal",
    style_bar: { lines: 50, spacing: 40 },
  };

  it("merges colors without dropping unpatched ones, lowercased", () => {
    const next = applyDesignAiPatch(base, { colors: { background: "#F6F1E7" } });
    expect(next.colors?.background).toBe("#f6f1e7");
    expect(next.colors?.primary).toBe("#5563de");
    expect(next.colors?.text).toBe("#1f1f1f");
  });

  it("sets font family + source google, preserving the other slot and extras", () => {
    const next = applyDesignAiPatch(base, { heading_font: "Fraunces" });
    expect(next.typography?.heading).toEqual({ family: "Fraunces", source: "google" });
    expect(next.typography?.body).toEqual({ family: "Inter", source: "system", base_size: 16 });
  });

  it("expands the single page_padding value to all four sides", () => {
    const next = applyDesignAiPatch(base, { page_padding: 40 });
    expect(next.page_padding).toEqual({ top: 40, right: 40, bottom: 40, left: 40 });
  });

  it("writes style_bar.lines without clobbering the other axes", () => {
    const next = applyDesignAiPatch(base, { answer_softness: 80 });
    expect(next.style_bar).toEqual({ lines: 80, spacing: 40 });
  });

  it("leaves unrelated fields byte-identical and an empty patch is a no-op merge", () => {
    const next = applyDesignAiPatch(base, {});
    expect(next).toEqual(base);
    const styled = applyDesignAiPatch(base, { button_radius: 30 });
    expect(styled.template_id).toBe("linen");
    expect(styled.chrome).toBe("minimal");
    expect(styled.button_radius).toBe(30);
  });
});

// ── ensureReadableTokens (the contrast guardrail) ────────────────────────────

describe("ensureReadableTokens", () => {
  it("returns a passing palette unchanged (same object)", () => {
    const t: DesignTokensT = {
      colors: { primary: "#5563de", background: "#f6f1e7", text: "#2b2620" },
    };
    expect(ensureReadableTokens(t)).toBe(t);
  });

  it("darkens/lightens failing text minimally to reach 4.5:1 on the background", () => {
    const t: DesignTokensT = {
      colors: { background: "#f6f1e7", text: "#c9b89a" }, // beige-on-cream: unreadable
    };
    const fixed = ensureReadableTokens(t);
    const text = fixed.colors?.text ?? "";
    expect(text).not.toBe("#c9b89a");
    expect(contrastRatio(text, "#f6f1e7")).toBeGreaterThanOrEqual(4.5);
    // The background (the brief's aesthetic) is untouched.
    expect(fixed.colors?.background).toBe("#f6f1e7");
  });

  it("lightens dark-on-dark text toward white", () => {
    const t: DesignTokensT = { colors: { background: "#1c1a17", text: "#3a352e" } };
    const fixed = ensureReadableTokens(t);
    expect(contrastRatio(fixed.colors?.text ?? "", "#1c1a17")).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens a too-light primary until the white button label reads", () => {
    const t: DesignTokensT = { colors: { primary: "#ffd27a", background: "#ffffff", text: "#1f1f1f" } };
    const fixed = ensureReadableTokens(t);
    const primary = fixed.colors?.primary ?? "";
    expect(primary).not.toBe("#ffd27a");
    expect(contrastRatio("#ffffff", primary)).toBeGreaterThanOrEqual(4.5);
  });

  it("is deterministic — same input, same output", () => {
    const t: DesignTokensT = {
      colors: { primary: "#ffd27a", background: "#f6f1e7", text: "#c9b89a" },
    };
    expect(ensureReadableTokens(t)).toEqual(ensureReadableTokens(t));
  });

  it("checks against defaults when a slot is unset (cream bg + default text passes)", () => {
    const t: DesignTokensT = { colors: { background: "#f6f1e7" } };
    // default text #1f1f1f on cream passes — nothing to fix.
    expect(ensureReadableTokens(t)).toBe(t);
  });
});

describe("mixHex", () => {
  it("is a linear per-channel mix with lowercase output", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#FF0000", "#000000", 0.5)).toBe("#800000");
  });
});
