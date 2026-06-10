// Device presets + width→breakpoint mapping for the resizable preview frame.
// Pure (no DOM access) so it's unit-testable.
import { BREAKPOINT_PX } from "../../runtime/runtimeStyles";

export type DevicePreset = "mobile" | "tablet" | "desktop";

// Preset widths. Mobile resolves to the runtime's "mobile" breakpoint; tablet +
// desktop resolve to "desktop" (so the two cross the 900px line correctly).
export const DEVICE_PRESETS: Record<DevicePreset, number> = {
  mobile: 390,
  tablet: 768,
  desktop: 1280,
};

export const MIN_FRAME_W = 320;
export const MAX_FRAME_W = 1440;

// Same constant the live runtime measures its container against (Unified P1),
// so the in-builder frame crosses to mobile tokens at the EXACT same width
// the live quiz does.
export function breakpointForWidth(w: number): "desktop" | "mobile" {
  return w < BREAKPOINT_PX ? "mobile" : "desktop";
}

export function clampFrameWidth(w: number, max: number = MAX_FRAME_W): number {
  return Math.max(MIN_FRAME_W, Math.min(max, Math.round(w)));
}

// The preset whose width matches `w` exactly, else null (= a custom width).
export function presetForWidth(w: number): DevicePreset | null {
  return (
    (Object.keys(DEVICE_PRESETS) as DevicePreset[]).find(
      (k) => DEVICE_PRESETS[k] === w,
    ) ?? null
  );
}
