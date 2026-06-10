import { describe, expect, it } from "vitest";
import { normalizeHex, mergeHexIntoTokens, tokensToCssVars } from "./designTokens";

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
