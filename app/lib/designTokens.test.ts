import { describe, expect, it } from "vitest";
import { normalizeHex, mergeHexIntoTokens } from "./designTokens";

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
