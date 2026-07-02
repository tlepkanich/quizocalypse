import { describe, it, expect } from "vitest";
import {
  linesToRadiusPx,
  spacingToPadPx,
  imageDensityFactor,
  hideDecorativeImagery,
  questionImagePosition,
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

  it("density renderer (owner-activated): hides decorative imagery ONLY below 20, never when unset", () => {
    // UNSET = show everything — every quiz without a style_bar is byte-stable.
    expect(hideDecorativeImagery(undefined)).toBe(false);
    // The vibe templates split by intent: Minimal/Technical 5 + Clean/Editorial
    // 15 go text-forward; Bold 50 + Warm/Lifestyle 85 keep their imagery.
    expect(hideDecorativeImagery(5)).toBe(true);
    expect(hideDecorativeImagery(15)).toBe(true);
    expect(hideDecorativeImagery(19)).toBe(true);
    expect(hideDecorativeImagery(20)).toBe(false);
    expect(hideDecorativeImagery(50)).toBe(false);
    expect(hideDecorativeImagery(85)).toBe(false);
    expect(hideDecorativeImagery(0)).toBe(true);
  });

  it("questionImagePosition: EXPLICIT position beats the gate; only the unset default goes text-forward", () => {
    // Explicit intent wins at any density — the review-caught lying-control
    // trap: a merchant who sets "side" on a density-15 template must see it.
    expect(questionImagePosition(5, "top")).toBe("top");
    expect(questionImagePosition(15, "side")).toBe("side");
    expect(questionImagePosition(85, "none")).toBe("none");
    // Unset position: gates to none below the threshold, default top otherwise.
    expect(questionImagePosition(15, undefined)).toBe("none");
    expect(questionImagePosition(50, undefined)).toBe("top");
    expect(questionImagePosition(undefined, undefined)).toBe("top");
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
