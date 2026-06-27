import { describe, expect, it } from "vitest";
import { normalizeHex, mergeHexIntoTokens, tokensToCssVars, resolveDesignTokens } from "./designTokens";

describe("normalizeHex", () => {
  it("accepts #rrggbb and #rgb (with/without #), lowercased + expanded", () => {
    expect(normalizeHex("#2F6B4F")).toBe("#2f6b4f");
    expect(normalizeHex("2F6B4F")).toBe("#2f6b4f");
    expect(normalizeHex("#0AF")).toBe("#00aaff");
    expect(normalizeHex("  #fff ")).toBe("#ffffff");
  });
  it("rejects invalid hex", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#1234")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
  });
});

describe("mergeHexIntoTokens", () => {
  it("sets colors.primary, preserving other colors", () => {
    const out = mergeHexIntoTokens(
      { colors: { background: "#fff", text: "#111" }, radius: "pill" },
      "#2F6B4F",
    );
    expect(out.colors).toEqual({ background: "#fff", text: "#111", primary: "#2f6b4f" });
    expect(out.radius).toBe("pill"); // untouched
  });
  it("seeds colors on empty tokens", () => {
    expect(mergeHexIntoTokens(null, "#abc").colors).toEqual({ primary: "#aabbcc" });
  });
  it("returns tokens unchanged for invalid hex", () => {
    const t = { colors: { primary: "#123456" } };
    expect(mergeHexIntoTokens(t, "not-a-color").colors).toEqual({ primary: "#123456" });
  });
});

describe("tokensToCssVars radius (the 'big oval' fix)", () => {
  it("caps the pill radius at 24px so tall cards/answers don't balloon into ovals", () => {
    expect(tokensToCssVars({ radius: "pill" })["--qz-radius"]).toBe("24px");
  });
  it("keeps square at 0 and rounded (default) at 10px", () => {
    expect(tokensToCssVars({ radius: "square" })["--qz-radius"]).toBe("0px");
    expect(tokensToCssVars({})["--qz-radius"]).toBe("10px");
  });
});

describe("tokensToCssVars surface (MQ minimal chrome answer chips)", () => {
  it("uses an explicit colors.surface token when set", () => {
    const vars = tokensToCssVars({ colors: { surface: "#f4f4f4" } });
    expect(vars["--qz-color-surface"]).toBe("#f4f4f4");
  });
  it("derives a theme-adaptive surface from text+bg when absent", () => {
    const light = tokensToCssVars({ colors: { text: "#000000", background: "#ffffff" } });
    expect(light["--qz-color-surface"]).toBe("color-mix(in srgb, #000000 6%, #ffffff)");
    const dark = tokensToCssVars({ colors: { text: "#E9EEF7", background: "#0C1018" } });
    expect(dark["--qz-color-surface"]).toBe("color-mix(in srgb, #E9EEF7 6%, #0C1018)");
  });
});

describe("tokensToCssVars page padding (QP-2)", () => {
  it("does NOT emit page-pad vars when absent (existing quizzes byte-identical)", () => {
    const vars = tokensToCssVars({});
    expect("--qz-pp-top" in vars).toBe(false);
    expect("--qz-pp-left" in vars).toBe(false);
  });
  it("emits per-side vars (so each overrides its own fallback, incl. the !important desktop top)", () => {
    const vars = tokensToCssVars({ page_padding: { top: 0, right: 32, bottom: 32, left: 16 } });
    expect(vars["--qz-pp-top"]).toBe("0px");
    expect(vars["--qz-pp-right"]).toBe("32px");
    expect(vars["--qz-pp-bottom"]).toBe("32px");
    expect(vars["--qz-pp-left"]).toBe("16px");
  });
  it("resolveDesignTokens CARRIES page_padding through (the per-field-merge trap)", () => {
    const resolved = resolveDesignTokens(null, { page_padding: { top: 96, right: 48, bottom: 48, left: 48 } });
    expect(resolved.page_padding).toEqual({ top: 96, right: 48, bottom: 48, left: 48 });
    // …and it reaches the CSS vars after resolution (the full runtime chain).
    expect(tokensToCssVars(resolved)["--qz-pp-top"]).toBe("96px");
  });
});

describe("fluid typography (Unified P7)", () => {
  const tok = (base: number) => ({ typography: { body: { family: "Inter", base_size: base, scale_ratio: 1.25 } } });

  it("equal endpoints stay fixed px (no clamp noise)", () => {
    const vars = tokensToCssVars(tok(16), { mobile: tok(16), desktop: tok(16) });
    expect(vars["--qz-base-size"]).toBe("16px");
  });

  it("different endpoints emit a clamp whose bounds ARE the bucket sizes", () => {
    const vars = tokensToCssVars(tok(16), { mobile: tok(14), desktop: tok(18) });
    expect(vars["--qz-base-size"]).toMatch(/^clamp\(14px, calc\(.+cqw\), 18px\)$/);
    // h1 = base * 1.25² * 1.4 — compute bounds with the same rounding.
    const r2 = (n: number) => Math.round(n * 100) / 100;
    expect(vars["--qz-h1-size"]).toContain(`clamp(${r2(14 * 1.25 * 1.25 * 1.4)}px`);
    expect(vars["--qz-h1-size"]).toContain(`${r2(18 * 1.25 * 1.25 * 1.4)}px)`);
  });

  it("no fluid arg → unchanged fixed emission (StepPreview path)", () => {
    expect(tokensToCssVars(tok(16))["--qz-base-size"]).toBe("16px");
  });
});

describe("Design Settings spec (Drive 1_p1V) — D0 token carry + byte-stable", () => {
  it("carries the new design fields through resolveDesignTokens (last layer wins)", () => {
    const resolved = resolveDesignTokens(
      { logo: { url: "https://x/l.png", size: "md", align: "left" } },
      { style_bar: { lines: 80 }, answer_layout: "list" },
      { style_bar: { spacing: 30 }, template_id: "warm_lifestyle", question_image_position: "side" },
    );
    expect(resolved.logo).toEqual({ url: "https://x/l.png", size: "md", align: "left" });
    // style_bar shallow-merges across layers (lines from layer 2, spacing from layer 3)
    expect(resolved.style_bar).toEqual({ lines: 80, spacing: 30 });
    expect(resolved.answer_layout).toBe("list");
    expect(resolved.template_id).toBe("warm_lifestyle");
    expect(resolved.question_image_position).toBe("side");
  });

  it("byte-stable: unset design fields emit NO new CSS vars (every existing quiz unchanged)", () => {
    const vars = tokensToCssVars(resolveDesignTokens({ colors: { primary: "#123456" } }));
    // D0 is schema + cascade carry only — no CSS emission yet, so no logo/style-bar vars.
    expect(Object.keys(vars).some((k) => k.includes("logo") || k.includes("style-bar"))).toBe(false);
  });
})
