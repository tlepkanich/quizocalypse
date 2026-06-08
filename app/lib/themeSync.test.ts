import { describe, expect, it } from "vitest";
import { brandColorsToTokens } from "./designTokens";

describe("brandColorsToTokens (theme-token sync, Dev Spec §3.1)", () => {
  it("maps + normalizes primary and secondary brand colors", () => {
    expect(brandColorsToTokens({ primary: "#AABBCC", secondary: "1a2b3c" })).toEqual({
      primary: "#aabbcc",
      secondary: "#1a2b3c",
    });
  });

  it("expands 3-digit hex and includes only the valid slot", () => {
    expect(brandColorsToTokens({ primary: "#fff", secondary: "zzz" })).toEqual({
      primary: "#ffffff",
    });
  });

  it("returns empty when nothing valid is supplied", () => {
    expect(brandColorsToTokens({ primary: "not-a-hex", secondary: null })).toEqual({});
    expect(brandColorsToTokens({})).toEqual({});
  });
});
