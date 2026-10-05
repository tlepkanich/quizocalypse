import { describe, expect, it } from "vitest";
import {
  normalizeHex,
  mergeHexIntoTokens,
  tokensToCssVars,
  resolveDesignTokens,
  cleanColors,
  colorsToPatch,
  mergeColorPatch,
  readHexDraft,
  withCleanColors,
  setColorRole,
} from "./designTokens";
import { DesignTokens } from "./quizSchema";
import {
  stylesFor,
  PAGE_PAD_DEFAULT_PX,
  PAGE_PAD_DESKTOP_TOP_PX,
} from "../components/runtime/runtimeStyles";

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

// The values found in a real local shop row (brand editor saved raw field text).
const DIRTY_STORED = { primary: "#5563DE", muted: " #000000", surface: " #000000", secondary: " #000000#10da14" };

describe("cleanColors", () => {
  it("normalizes valid hex and drops everything else", () => {
    expect(cleanColors(DIRTY_STORED)).toEqual({ primary: "#5563de", muted: "#000000", surface: "#000000" });
    expect(cleanColors({ primary: "#0AF", accent: "", text: "red", background: "   " })).toEqual({ primary: "#00aaff" });
  });
  it("returns an empty set for no colors", () => {
    expect(cleanColors(undefined)).toEqual({});
    expect(cleanColors(null)).toEqual({});
    expect(cleanColors({})).toEqual({});
  });
});

describe("colorsToPatch", () => {
  it("sends every role: a set role as its hex, an unset or invalid role as an explicit blank", () => {
    expect(colorsToPatch({ primary: "#2F6B4F", secondary: " #000000#10da14" })).toEqual({
      primary: "#2f6b4f", secondary: "", accent: "", background: "", surface: "", text: "", muted: "",
    });
  });
});

describe("mergeColorPatch", () => {
  it("sets a valid hex, normalized, and keeps the untouched siblings", () => {
    expect(mergeColorPatch({ primary: "#111111", text: "#222222" }, { primary: " #ABC " })).toEqual({
      primary: "#aabbcc", text: "#222222",
    });
  });
  it("removes a role on a blank value — the key is gone, never stored as an empty string", () => {
    const out = mergeColorPatch({ primary: "#111111", surface: "#eeeeee" }, { surface: "" });
    expect(out).toEqual({ primary: "#111111" });
    expect("surface" in out).toBe(false);
    expect(mergeColorPatch({ surface: "#eeeeee" }, { surface: "   " })).toEqual({});
  });
  it("ignores an invalid value and keeps the stored color", () => {
    expect(mergeColorPatch({ secondary: "#2c7a4b" }, { secondary: " #000000#10da14" })).toEqual({ secondary: "#2c7a4b" });
    expect(mergeColorPatch({}, { accent: "red" })).toEqual({});
  });
  it("leaves a role the patch does not mention", () => {
    expect(mergeColorPatch({ muted: "#666666" }, {})).toEqual({ muted: "#666666" });
    expect(mergeColorPatch({ muted: "#666666" }, undefined)).toEqual({ muted: "#666666" });
  });
  it("never carries a stored invalid value forward", () => {
    expect(mergeColorPatch(DIRTY_STORED, { accent: "#BB6622" })).toEqual({
      primary: "#5563de", muted: "#000000", surface: "#000000", accent: "#bb6622",
    });
  });
  it("round-trips the editor's wire patch: clearing a role in the editor removes it from the stored set", () => {
    const stored = { primary: "#5563de", surface: "#000000" };
    const editorColors = { primary: "#5563de" }; // the merchant emptied Surface
    expect(mergeColorPatch(stored, colorsToPatch(editorColors))).toEqual({ primary: "#5563de" });
  });
});

describe("readHexDraft", () => {
  it("commits a valid hex, normalized", () => {
    expect(readHexDraft("#2F6B4F")).toEqual({ kind: "set", hex: "#2f6b4f" });
    expect(readHexDraft(" abc ")).toEqual({ kind: "set", hex: "#aabbcc" });
  });
  it("unsets on an emptied field", () => {
    expect(readHexDraft("")).toEqual({ kind: "unset" });
    expect(readHexDraft("  ")).toEqual({ kind: "unset" });
  });
  it("holds anything else as still being typed", () => {
    expect(readHexDraft("#")).toEqual({ kind: "pending" });
    expect(readHexDraft("#12")).toEqual({ kind: "pending" });
    expect(readHexDraft(" #000000#10da14")).toEqual({ kind: "pending" });
  });
});

describe("withCleanColors", () => {
  it("keeps only valid colors and leaves every other field alone", () => {
    const tokens = { colors: DIRTY_STORED, radius: "pill" as const, typography: { heading: { family: "Lora", source: "google" as const } } };
    expect(withCleanColors(tokens)).toEqual({
      colors: { primary: "#5563de", muted: "#000000", surface: "#000000" },
      radius: "pill",
      typography: { heading: { family: "Lora", source: "google" } },
    });
  });
  it("removes the colors key when no valid role is left", () => {
    expect(withCleanColors({ colors: { primary: "red", text: "" }, spacing: "compact" })).toEqual({ spacing: "compact" });
    expect(withCleanColors({ colors: {} })).toEqual({});
  });
  it("returns a token set without colors unchanged", () => {
    const tokens = { radius: "square" as const };
    expect(withCleanColors(tokens)).toBe(tokens);
  });
  it("does not change its input", () => {
    const tokens = { colors: { ...DIRTY_STORED } };
    withCleanColors(tokens);
    expect(tokens.colors).toEqual(DIRTY_STORED);
  });
  it("an invalid suggested color never replaces a valid stored one (brand-book upload)", () => {
    const stored = { colors: { primary: "#111111", text: " #000000#10da14" } };
    const suggested = { colors: { primary: "navy", accent: "#F0A" } };
    const merged = resolveDesignTokens(withCleanColors(stored), withCleanColors(suggested));
    expect(merged.colors?.primary).toBe("#111111");
    expect(merged.colors?.accent).toBe("#ff00aa");
    for (const value of Object.values(merged.colors ?? {})) expect(normalizeHex(value)).not.toBeNull();
  });
});

describe("setColorRole", () => {
  it("sets a role to the normalized hex and keeps the other roles", () => {
    expect(setColorRole({ colors: { text: "#222222" }, radius: "pill" }, "primary", " #ABC ")).toEqual({
      colors: { text: "#222222", primary: "#aabbcc" },
      radius: "pill",
    });
    expect(setColorRole({}, "accent", "#BB6622")).toEqual({ colors: { accent: "#bb6622" } });
  });
  it("removes the key on null", () => {
    const out = setColorRole({ colors: { primary: "#111111", text: "#222222" } }, "primary", null);
    expect(out.colors).toEqual({ text: "#222222" });
    expect(out.colors && "primary" in out.colors).toBe(false);
  });
  it("changes nothing for an invalid hex", () => {
    const tokens = { colors: { primary: "#111111" } };
    expect(setColorRole(tokens, "primary", " #000000#10da14")).toBe(tokens);
    expect(setColorRole(tokens, "primary", "")).toBe(tokens);
  });
  it("does not change its input", () => {
    const tokens = { colors: { primary: "#111111" } };
    setColorRole(tokens, "primary", null);
    setColorRole(tokens, "text", "#fff");
    expect(tokens).toEqual({ colors: { primary: "#111111" } });
  });
});

describe("DesignTokens schema stays loose on colors (legacy docs must keep parsing)", () => {
  it("still parses a non-hex color unchanged", () => {
    const parsed = DesignTokens.safeParse({ colors: DIRTY_STORED });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.colors).toEqual(DIRTY_STORED);
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
  // FIX-1 — the preview↔publish parity pin: the runtime page's fallbacks, the
  // BLD-1 panels, and the admin card CSS all read from these two constants.
  // If either number changes, the .qz-allcard-doc literals in quizocalypse.css
  // must move with it.
  it("page-padding defaults are the agreed source of truth (24 mobile / 48 desktop top)", () => {
    expect(PAGE_PAD_DEFAULT_PX).toBe(24);
    expect(PAGE_PAD_DESKTOP_TOP_PX).toBe(48);
    const page = stylesFor({}).page;
    expect(page.paddingTop).toBe(`var(--qz-pp-top, ${PAGE_PAD_DEFAULT_PX}px)`);
    expect(page.paddingRight).toBe(`var(--qz-pp-right, ${PAGE_PAD_DEFAULT_PX}px)`);
    expect(page.paddingBottom).toBe(`var(--qz-pp-bottom, ${PAGE_PAD_DEFAULT_PX}px)`);
    expect(page.paddingLeft).toBe(`var(--qz-pp-left, ${PAGE_PAD_DEFAULT_PX}px)`);
  });
});

describe("Next-button size + radius (QZY-R7-3 §7.2)", () => {
  it("resolveDesignTokens CARRIES button_radius/button_scale (per-field-merge trap)", () => {
    const resolved = resolveDesignTokens(null, { button_radius: 16, button_scale: 1.2 });
    expect(resolved.button_radius).toBe(16);
    expect(resolved.button_scale).toBe(1.2);
  });
  it("a later layer overrides, and 0 radius survives (!= null guard)", () => {
    const resolved = resolveDesignTokens({ button_radius: 20 }, { button_radius: 0 });
    expect(resolved.button_radius).toBe(0);
  });
  it("absent → the fields never appear (byte-safe: theme-only doc unchanged)", () => {
    const resolved = resolveDesignTokens(null, { radius: "pill" });
    expect("button_radius" in resolved).toBe(false);
    expect("button_scale" in resolved).toBe(false);
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

  it("image_density survives the cascade; a later partial style_bar layer neither clobbers nor injects it", () => {
    // O-2 (density renderer): the four-wirings trap — an unwired carry would
    // silently render the whole feature inert. Pin both directions:
    const carried = resolveDesignTokens(
      { style_bar: { image_density: 15 } },
      { style_bar: { lines: 40 } }, // partial later layer must KEEP density 15
    );
    expect(carried.style_bar).toEqual({ image_density: 15, lines: 40 });
    // ...and no layer can INJECT a density that was never authored.
    const uninjected = resolveDesignTokens({ style_bar: { lines: 40 } }, {});
    expect(uninjected.style_bar?.image_density).toBeUndefined();
  });

  it("byte-stable: unset design fields emit NO new CSS vars (every existing quiz unchanged)", () => {
    const vars = tokensToCssVars(resolveDesignTokens({ colors: { primary: "#123456" } }));
    // D0 is schema + cascade carry only — no CSS emission yet, so no logo/style-bar vars.
    expect(Object.keys(vars).some((k) => k.includes("logo") || k.includes("style-bar"))).toBe(false);
  });
})

describe("resolveDesignTokens surface follows the scheme it sits on", () => {
  const brandKit = {
    colors: { background: "#000000", text: "#000000", primary: "#000000", surface: " #000000" },
  };
  const linen = { colors: { background: "#FBF4EC", text: "#2A211A", primary: "#AD4B2E" } };

  it("drops a lower layer's surface when a later layer changes background or text", () => {
    const resolved = resolveDesignTokens(brandKit, linen);
    expect(resolved.colors && "surface" in resolved.colors).toBe(false);
    // …so the runtime derives the chip tint from the quiz's own scheme.
    expect(tokensToCssVars(resolved)["--qz-color-surface"]).toBe(
      "color-mix(in srgb, #2A211A 6%, #FBF4EC)",
    );
  });

  it("drops it when ONLY the background or ONLY the text changes", () => {
    const base = { colors: { background: "#FFFFFF", text: "#111111", surface: "#F4F4F4" } };
    expect(resolveDesignTokens(base, { colors: { background: "#101010" } }).colors?.surface).toBeUndefined();
    expect(resolveDesignTokens(base, { colors: { text: "#EEEEEE" } }).colors?.surface).toBeUndefined();
  });

  it("keeps it when the later layer leaves background and text alone", () => {
    const base = { colors: { background: "#FFFFFF", text: "#111111", surface: "#F4F4F4" } };
    expect(resolveDesignTokens(base, { colors: { primary: "#123456" } }).colors?.surface).toBe("#F4F4F4");
    expect(resolveDesignTokens(base, { radius: "pill" }).colors?.surface).toBe("#F4F4F4");
    // A layer that restates the SAME scheme (case/space-insensitive) is no change.
    expect(
      resolveDesignTokens(base, { colors: { background: " #ffffff", text: "#111111" } }).colors?.surface,
    ).toBe("#F4F4F4");
  });

  it("a layer that names its own surface always wins", () => {
    const resolved = resolveDesignTokens(brandKit, {
      colors: { ...linen.colors, surface: "#EFE6DA" },
    });
    expect(resolved.colors?.surface).toBe("#EFE6DA");
  });

  it("a single layer keeps its own surface (published docs resolve as one layer)", () => {
    const baked = { colors: { background: "#F1EEE5", text: "#14231C", surface: "#E2E2DA" } };
    expect(resolveDesignTokens(null, baked, null, null).colors?.surface).toBe("#E2E2DA");
  });
});

describe("suggestContrastText (Design Settings §1)", () => {
  it("picks near-black on light backgrounds, near-white on dark", async () => {
    const { suggestContrastText } = await import("./designTokens");
    expect(suggestContrastText("#FFFFFF")).toBe("#111111");
    expect(suggestContrastText("#F8F6F1")).toBe("#111111");
    expect(suggestContrastText("#0C1018")).toBe("#FFFFFF");
    expect(suggestContrastText("#111111")).toBe("#FFFFFF");
  });
})
