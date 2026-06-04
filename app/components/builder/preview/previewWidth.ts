// Device presets + width→breakpoint mapping for the resizable preview frame.
// Pure (no React/DOM) so it's unit-testable.

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

// Mirror the runtime's useBreakpoint threshold (window.innerWidth < 900 ⇒
// mobile) so the in-builder frame crosses to mobile tokens at the EXACT same
// width the live quiz does.
export function breakpointForWidth(w: number): "desktop" | "mobile" {
  return w < 900 ? "mobile" : "desktop";
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
