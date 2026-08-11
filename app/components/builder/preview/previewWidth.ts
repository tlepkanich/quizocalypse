// The two FIXED preview viewports, and the tier→breakpoint mapping the builder
// preview shares with the live runtime. Pure (no DOM access) so it's unit-testable.
//
// Contract: GLOBAL-VIEWPORT.md — `viewport/2026-08`. The device never changes
// size; only the room it is shown in does. There is no width state anywhere in
// the preview stack.
import { BREAKPOINT_PX } from "../../runtime/runtimeStyles";

// A3 — ONE definition of the device geometry, both axes, because the fit rule
// needs height as well as width. Both are the CONTAINERS a shopper actually
// gets, not browser windows (Quartz frames spec,
// docs/design/brand-2026/reference/quartz-preview-frames.html):
//   phone   390 × 745 — the viewport iPhone Safari gives a shopper with
//           toolbars collapsed (390 × 844 is the screen — a different
//           measurement, and why the old phone frame looked unusually long).
//   desktop 960 × 700 — the INLINE embed band: 960 wide sits above the 900px
//           breakpoint so it genuinely renders desktop tokens, below the
//           runtime shell's 1100px cap; 700 tall reads as a block, not a
//           letterbox (1128 × 640 was the stretched one).
// The launcher modal (720 × 620) is a real embed mode but NOT a preview tier —
// its geometry stays recorded here so a modal preview can be added without
// re-deriving it. (720 < 900: the launcher modal renders MOBILE tokens.)
//
// Do NOT add a tablet tier: the quiz switches layouts at BREAKPOINT_PX (900),
// so a 768px "tablet" would render the phone layout and the button would be
// lying about what it shows.
export const DEVICES = {
  phone: { w: 390, h: 745 },
  desktop: { w: 960, h: 700 },
} as const;

export type DeviceTier = keyof typeof DEVICES;

// Display order for every tier toggle in the product. Iterate it; never index
// it positionally (tsconfig has noUncheckedIndexedAccess).
export const DEVICE_TIERS: readonly DeviceTier[] = ["phone", "desktop"];

export const TIER_LABEL: Record<DeviceTier, string> = {
  phone: "Phone",
  desktop: "Desktop",
};

// B2 — the toggle is session-scoped per surface and resets to this. One place,
// so "which tier does a surface open on" is a one-line change forever.
export const DEFAULT_TIER: DeviceTier = "phone";

// A1 — the LOAD-BEARING map. QuizRuntime short-circuits container measurement
// in preview mode, so the frame's pixel width does NOT tell the quiz which
// layout to render — this prop does. Every preview host must pass
// TIER_BREAKPOINT[tier] as QuizRuntime's `breakpoint`. Pinned against
// breakpointForWidth() in previewWidth.test.ts so the two cannot drift.
export const TIER_BREAKPOINT: Record<DeviceTier, "desktop" | "mobile"> = {
  phone: "mobile",
  desktop: "desktop",
};

// The same 900px constant the live runtime measures its container against
// (runtimeStyles.ts BREAKPOINT_PX). No component calls this any more — it is
// kept as the independent second opinion that pins TIER_BREAKPOINT in the unit
// test. NOTE: the live hook adds 16px of hysteresis and this function
// deliberately has none. That difference is inert: both device widths sit far
// outside the 884–900 band.
export function breakpointForWidth(w: number): "desktop" | "mobile" {
  return w < BREAKPOINT_PX ? "mobile" : "desktop";
}

// The fit rule — fit both axes, show the whole device, never upscale past 1:1.
//   scale = min(paneW / deviceW, paneH / deviceH, 1)
// A non-positive pane (unmeasured, display:none, SSR) yields 1: the frame is
// then clipped by its pane's overflow, never blown up.
export function fitScale(tier: DeviceTier, paneW: number, paneH: number): number {
  const { w, h } = DEVICES[tier];
  if (!(paneW > 0) || !(paneH > 0)) return 1;
  return Math.min(paneW / w, paneH / h, 1);
}

// Which axis is doing the constraining, for the footer readout
// ("height-limited: 612px of pane for a 745px phone"). "none" = actual size.
export function fitConstraint(
  tier: DeviceTier,
  paneW: number,
  paneH: number,
): "width" | "height" | "none" {
  if (fitScale(tier, paneW, paneH) >= 1) return "none";
  const { w, h } = DEVICES[tier];
  return paneW / w <= paneH / h ? "width" : "height";
}
