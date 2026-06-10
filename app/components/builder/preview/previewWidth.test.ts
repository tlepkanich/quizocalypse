import { describe, expect, it } from "vitest";
import {
  breakpointForWidth,
  clampFrameWidth,
  presetForWidth,
  DEVICE_PRESETS,
  MIN_FRAME_W,
  MAX_FRAME_W,
} from "./previewWidth";

describe("breakpointForWidth", () => {
  it("crosses to mobile below 900 (matching the runtime's container breakpoint)", () => {
    expect(breakpointForWidth(320)).toBe("mobile");
    expect(breakpointForWidth(899)).toBe("mobile");
    expect(breakpointForWidth(900)).toBe("desktop");
    expect(breakpointForWidth(1280)).toBe("desktop");
  });

  it("maps the device presets to the right breakpoint", () => {
    expect(breakpointForWidth(DEVICE_PRESETS.mobile)).toBe("mobile");
    // Tablet (768) is below 900, so it gets the quiz's mobile layout — exactly
    // what a real 768px tablet shopper sees.
    expect(breakpointForWidth(DEVICE_PRESETS.tablet)).toBe("mobile");
    expect(breakpointForWidth(DEVICE_PRESETS.desktop)).toBe("desktop");
  });
});

describe("clampFrameWidth", () => {
  it("clamps to [MIN, MAX] and rounds", () => {
    expect(clampFrameWidth(100)).toBe(MIN_FRAME_W);
    expect(clampFrameWidth(99999)).toBe(MAX_FRAME_W);
    expect(clampFrameWidth(612.7)).toBe(613);
  });

  it("honours a tighter container max", () => {
    expect(clampFrameWidth(1280, 800)).toBe(800);
  });
});

describe("presetForWidth", () => {
  it("identifies a preset width, else custom (null)", () => {
    expect(presetForWidth(DEVICE_PRESETS.tablet)).toBe("tablet");
    expect(presetForWidth(613)).toBeNull();
  });
});
