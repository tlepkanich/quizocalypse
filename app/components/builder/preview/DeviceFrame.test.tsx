// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { DeviceFrame } from "./DeviceFrame";
import { DEVICES, DEVICE_TIERS, type DeviceTier } from "./previewWidth";

/* viewport/2026-08 — the containment contract (A2/C1): the frame element must
   ALWAYS carry a transform (`scale(...)`, never "" / "none" / undefined) and
   `contain: paint`, unconditionally — including at 100% zoom in a roomy pane.
   Dropping either lets the runtime's position:fixed chip / scrim / sheet
   re-anchor to the merchant's browser window and float over the whole admin.
   jsdom has no ResizeObserver, so the pane measures 0 and fitScale falls back
   to 1 — exactly the scale-1 case the contract is about. */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  cleanup();
});

function cleanup() {
  if (root) {
    const r = root;
    act(() => r.unmount());
  }
  host?.remove();
  host = null;
  root = null;
}

function renderFrame(tier: DeviceTier, zoom?: number): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(DeviceFrame, {
        tier,
        zoom,
        children: createElement("div", null, "content"),
      }),
    );
  });
  const frame = host.querySelector<HTMLElement>(".qz-devframe");
  if (!frame) throw new Error("frame did not render");
  return frame;
}

describe("DeviceFrame containment contract", () => {
  it("always emits a scale() transform and contain:paint, at every tier and zoom", () => {
    for (const tier of DEVICE_TIERS) {
      for (const zoom of [undefined, 100, 50]) {
        const frame = renderFrame(tier, zoom);
        expect(frame.style.transform).toMatch(/^scale\(/);
        expect(frame.style.contain).toBe("paint");
        cleanup();
      }
    }
  });

  it("renders the fixed device geometry, not a resized one", () => {
    for (const tier of DEVICE_TIERS) {
      const frame = renderFrame(tier);
      expect(frame.style.width).toBe(`${DEVICES[tier].w}px`);
      expect(frame.style.height).toBe(`${DEVICES[tier].h}px`);
      expect(frame.dataset.qzTier).toBe(tier);
      cleanup();
    }
  });

  it("clamps the scale by zoom instead of multiplying (zoom 50 → scale 0.5)", () => {
    const frame = renderFrame("phone", 50);
    expect(frame.style.transform).toBe("scale(0.5)");
  });
});
