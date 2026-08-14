import { describe, expect, it } from "vitest";
import {
  breakpointForWidth,
  clampPreviewWidth,
  fitConstraint,
  fitPreviewScale,
  fitScale,
  tierForWidth,
  DESKTOP_TERMINAL_PX,
  DEVICES,
  DEVICE_TIERS,
  INLINE_BAND_PX,
  PRESET_WIDTH,
  PREVIEW_MAX_PX,
  PREVIEW_MIN_PX,
  TIER_BREAKPOINT,
} from "./previewWidth";
import {
  BREAKPOINT_PX,
  PAGE_PAD_DEFAULT_PX,
  PAGE_PAD_DESKTOP_TOP_PX,
  SHELL_MAX_PX,
} from "../../runtime/runtimeStyles";

describe("DEVICES (the funnel walkthroughs' fixed frames)", () => {
  it("is the two fixed viewports of the Quartz frames spec and nothing else", () => {
    expect(Object.keys(DEVICES).sort()).toEqual(["desktop", "phone"]);
    expect(DEVICES.phone).toEqual({ w: 390, h: 745 });
    // QRTZ-S3 — the inline embed band, not a browser window: above the 900
    // breakpoint, squarer than a letterbox. Max-size truth is the builder
    // canvas's resizable viewport's job, not this frame's.
    expect(DEVICES.desktop).toEqual({ w: 960, h: 700 });
    // No tablet: 768 would render the phone layout, so the button would lie.
    expect(DEVICE_TIERS).toEqual(["phone", "desktop"]);
  });

  it("states the usable content heights the steps design against", () => {
    // Phone: frame minus the runtime page's default padding (24 top + 24 bottom).
    expect(DEVICES.phone.h - PAGE_PAD_DEFAULT_PX - PAGE_PAD_DEFAULT_PX).toBe(697);
    // Desktop: the desktop-shell rule swaps padding-top for its own default.
    expect(DEVICES.desktop.h - PAGE_PAD_DESKTOP_TOP_PX - PAGE_PAD_DEFAULT_PX).toBe(628);
  });
});

describe("drag/2026-08 — the builder viewport's width presets", () => {
  it("Desktop lands AT the quiz's terminal size, never mid-resize (owner ask 2026-08-13)", () => {
    // The quiz stops growing once the viewport clears the shell cap plus the
    // page's side padding. A desktop preset below this line would land on a
    // width the quiz never renders full-page — the exact bug the old fixed
    // 960 desktop frame had.
    expect(DESKTOP_TERMINAL_PX).toBe(SHELL_MAX_PX + PAGE_PAD_DEFAULT_PX * 2);
    expect(PRESET_WIDTH.desktop).toBeGreaterThanOrEqual(DESKTOP_TERMINAL_PX);
    expect(PRESET_WIDTH.desktop).toBeLessThanOrEqual(PREVIEW_MAX_PX);
    // Phone = the canonical 390 viewport, and both presets honestly sit on
    // the side of the 900 line their button names.
    expect(PRESET_WIDTH.phone).toBe(DEVICES.phone.w);
    expect(tierForWidth(PRESET_WIDTH.phone)).toBe("phone");
    expect(tierForWidth(PRESET_WIDTH.desktop)).toBe("desktop");
    // The inline band renders INSIDE the viewport at the desktop preset.
    expect(INLINE_BAND_PX).toBeLessThan(PRESET_WIDTH.desktop);
  });

  it("clampPreviewWidth bounds the drag and rounds to whole px", () => {
    expect(clampPreviewWidth(10)).toBe(PREVIEW_MIN_PX);
    expect(clampPreviewWidth(99999)).toBe(PREVIEW_MAX_PX);
    expect(clampPreviewWidth(899.6)).toBe(900);
    expect(clampPreviewWidth(1024)).toBe(1024);
  });

  it("tierForWidth mirrors the runtime's 900px line exactly", () => {
    expect(tierForWidth(899)).toBe("phone");
    expect(tierForWidth(900)).toBe("desktop");
    expect(tierForWidth(BREAKPOINT_PX - 1)).toBe("phone");
    expect(tierForWidth(BREAKPOINT_PX)).toBe("desktop");
  });

  it("fitPreviewScale shows the whole frame: shrink-to-fit, never upscale", () => {
    // The headline case: the 1280 desktop preset in a ~950px pane renders
    // the WHOLE desktop layout scaled down, not a cropped slice.
    expect(fitPreviewScale(1280, 950)).toBeCloseTo(950 / 1280, 5);
    // Fits the pane → exactly 1:1.
    expect(fitPreviewScale(390, 950)).toBe(1);
    expect(fitPreviewScale(950, 950)).toBe(1);
    // Never upscales past actual size.
    expect(fitPreviewScale(390, 2000)).toBe(1);
    // Unmeasured pane / SSR (0 or negative) keeps the old 1:1 behavior.
    expect(fitPreviewScale(1280, 0)).toBe(1);
    expect(fitPreviewScale(0, 950)).toBe(1);
  });
});

// A1 — the anti-drift pin. TIER_BREAKPOINT is what actually reaches QuizRuntime;
// breakpointForWidth is the independent derivation from the runtime's own 900px
// constant. If anyone edits a device width across the 900 line without editing
// the tier map (or vice versa), this fails.
describe("TIER_BREAKPOINT is pinned to the runtime breakpoint", () => {
  it("agrees with breakpointForWidth for every tier", () => {
    for (const tier of DEVICE_TIERS) {
      expect(TIER_BREAKPOINT[tier]).toBe(breakpointForWidth(DEVICES[tier].w));
    }
  });

  it("puts phone below and desktop above the 900px line", () => {
    expect(DEVICES.phone.w).toBeLessThan(BREAKPOINT_PX);
    expect(DEVICES.desktop.w).toBeGreaterThanOrEqual(BREAKPOINT_PX);
    expect(TIER_BREAKPOINT).toEqual({ phone: "mobile", desktop: "desktop" });
  });
});

describe("breakpointForWidth", () => {
  it("crosses to mobile below 900 (matching the runtime's container breakpoint)", () => {
    expect(breakpointForWidth(320)).toBe("mobile");
    expect(breakpointForWidth(899)).toBe("mobile");
    expect(breakpointForWidth(900)).toBe("desktop");
    expect(breakpointForWidth(1280)).toBe("desktop");
  });
});

describe("fitScale", () => {
  it("fits both axes and never upscales past 1", () => {
    // Roomier than the device on both axes → actual size, not zoomed in.
    expect(fitScale("phone", 900, 1000)).toBe(1);
    expect(fitScale("desktop", 1600, 900)).toBe(1);
  });

  it("takes the smaller axis ratio", () => {
    // Width-limited: 195/390 = 0.5 beats 745/745 = 1.
    expect(fitScale("phone", 195, 745)).toBeCloseTo(0.5, 10);
    // Height-limited: 350/700 = 0.5 beats 960/960 = 1.
    expect(fitScale("desktop", 960, 350)).toBeCloseTo(0.5, 10);
  });

  it("returns 1 for an unmeasured or zero-size pane (SSR / display:none)", () => {
    expect(fitScale("phone", 0, 0)).toBe(1);
    expect(fitScale("desktop", 960, 0)).toBe(1);
  });

  it("reaches actual size in a pane slightly roomier than the device", () => {
    // A pane a few px larger on both axes shows the device 1:1 (Expand case).
    expect(fitScale("phone", 422, 777)).toBe(1);
    expect(fitScale("desktop", 1000, 720)).toBe(1);
  });
});

describe("fitConstraint", () => {
  it("names the constraining axis, or none at actual size", () => {
    expect(fitConstraint("phone", 900, 1000)).toBe("none");
    expect(fitConstraint("phone", 195, 745)).toBe("width");
    expect(fitConstraint("phone", 390, 612)).toBe("height");
    expect(fitConstraint("desktop", 960, 350)).toBe("height");
  });
});
