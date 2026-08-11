import { describe, expect, it } from "vitest";
import {
  breakpointForWidth,
  fitConstraint,
  fitScale,
  DEVICES,
  DEVICE_TIERS,
  TIER_BREAKPOINT,
} from "./previewWidth";
import {
  BREAKPOINT_PX,
  PAGE_PAD_DEFAULT_PX,
  PAGE_PAD_DESKTOP_TOP_PX,
} from "../../runtime/runtimeStyles";

describe("DEVICES", () => {
  it("is the two fixed viewports of the Quartz frames spec and nothing else", () => {
    expect(Object.keys(DEVICES).sort()).toEqual(["desktop", "phone"]);
    expect(DEVICES.phone).toEqual({ w: 390, h: 745 });
    // QRTZ-S3 — the inline embed band, not a browser window: above the 900
    // breakpoint, below the shell's 1100 cap, squarer than a letterbox.
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
