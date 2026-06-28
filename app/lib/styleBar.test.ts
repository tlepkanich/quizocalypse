import { describe, it, expect } from "vitest";
import {
  linesToRadiusPx,
  spacingToPadPx,
  imageDensityFactor,
  styleBarCssVars,
} from "./styleBar";

describe("style bar mapping (Design Settings §3)", () => {
  it("lines → radius (Sharp 0 → 0px, Soft 100 → 24px, clamped)", () => {
    expect(linesToRadiusPx(0)).toBe(0);
    expect(linesToRadiusPx(50)).toBe(12);
    expect(linesToRadiusPx(100)).toBe(24);
    expect(linesToRadiusPx(150)).toBe(24);
    expect(linesToRadiusPx(-10)).toBe(0);
  });

  it("spacing → padding (Compact 0 → 12px, Airy 100 → 40px)", () => {
    expect(spacingToPadPx(0)).toBe(12);
    expect(spacingToPadPx(50)).toBe(26);
    expect(spacingToPadPx(100)).toBe(40);
  });

  it("image density → 0-1 factor", () => {
    expect(imageDensityFactor(0)).toBe(0);
    expect(imageDensityFactor(100)).toBe(1);
    expect(imageDensityFactor(50)).toBe(0.5);
  });

  it("styleBarCssVars emits only the set axes (partial-safe)", () => {
    expect(styleBarCssVars(undefined)).toEqual({});
    expect(styleBarCssVars({ lines: 100 })).toEqual({ "--qz-radius": "24px" });
    expect(styleBarCssVars({ lines: 0, spacing: 100, image_density: 100 })).toEqual({
      "--qz-radius": "0px",
      "--qz-pad": "40px",
      "--qz-image-density": "1",
    });
  });
});
