// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { ResizableViewport } from "./ResizableViewport";
import { PREVIEW_MIN_PX, PREVIEW_MAX_PX, PRESET_WIDTH } from "./previewWidth";

/* drag/2026-08 — the builder canvas's resizable 1:1 viewport. What these
   tests pin:
   1. The containment contract carried over from DeviceFrame (A2): the frame
      ALWAYS has transform scale(1) + contain:paint, or the runtime's
      position:fixed chip / scrim / sheet float over the whole admin.
   2. Width honesty: the rendered width IS widthPx (clamped), and the mode
      attribute flips at the 900 line — the toggle can never lie.
   3. The resize affordances write back through onWidthPx: keyboard arrows
      step ±10 (±50 with shift) clamped, double-click resets to fill (null).
   jsdom has no ResizeObserver, so the pane measures 0 — the explicit-width
   cases are unaffected (they never read the pane). */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function cleanup() {
  if (root) {
    const r = root;
    act(() => r.unmount());
  }
  host?.remove();
  host = null;
  root = null;
}

afterEach(cleanup);

function renderViewport(
  widthPx: number | null,
  onWidthPx: (w: number | null) => void = () => {},
  onEffectiveWidth?: (w: number) => void,
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(ResizableViewport, {
        widthPx,
        onWidthPx,
        onEffectiveWidth,
        children: createElement("div", null, "content"),
      }),
    );
  });
  const frame = host.querySelector<HTMLElement>(".qz-rsvp-frame");
  if (!frame) throw new Error("frame did not render");
  return frame;
}

describe("ResizableViewport", () => {
  it("always carries the containment contract (transform scale(1) + contain paint)", () => {
    for (const w of [null, 390, 1280]) {
      const frame = renderViewport(w);
      expect(frame.style.transform).toBe("scale(1)");
      expect(frame.style.contain).toBe("paint");
      cleanup();
    }
  });

  it("renders the width it is given and stamps the honest mode", () => {
    const phone = renderViewport(PRESET_WIDTH.phone);
    expect(phone.style.width).toBe(`${PRESET_WIDTH.phone}px`);
    expect(phone.dataset.qzMode).toBe("mobile");
    cleanup();

    const desktop = renderViewport(PRESET_WIDTH.desktop);
    expect(desktop.style.width).toBe(`${PRESET_WIDTH.desktop}px`);
    expect(desktop.dataset.qzMode).toBe("desktop");
  });

  it("clamps out-of-range widths and reports the RENDERED width", () => {
    const seen: number[] = [];
    const frame = renderViewport(10, () => {}, (w) => seen.push(w));
    expect(frame.style.width).toBe(`${PREVIEW_MIN_PX}px`);
    expect(seen).toContain(PREVIEW_MIN_PX);
  });

  it("keyboard-resizes from the handles: ±10, ±50 with shift, clamped", () => {
    const onWidthPx = vi.fn();
    renderViewport(1000, onWidthPx);
    const handle = host?.querySelector<HTMLElement>(".qz-rsvp-handle");
    if (!handle) throw new Error("handle did not render");

    const key = (init: KeyboardEventInit) =>
      act(() => {
        handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
      });
    key({ key: "ArrowRight" });
    expect(onWidthPx).toHaveBeenLastCalledWith(1010);
    key({ key: "ArrowLeft", shiftKey: true });
    expect(onWidthPx).toHaveBeenLastCalledWith(950);

    cleanup();

    const clamped = vi.fn();
    renderViewport(PREVIEW_MAX_PX, clamped);
    const h2 = document.querySelector<HTMLElement>(".qz-rsvp-handle");
    act(() => {
      h2?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(clamped).toHaveBeenLastCalledWith(PREVIEW_MAX_PX);
  });

  it("shows the browser chrome at desktop widths only (phone stays borderless)", () => {
    renderViewport(PRESET_WIDTH.desktop);
    const chrome = document.querySelector<HTMLElement>(".qz-rsvp-chrome");
    expect(chrome).not.toBeNull();
    expect(chrome?.textContent).toContain("yourstore.com");
    cleanup();

    renderViewport(PRESET_WIDTH.phone);
    expect(document.querySelector(".qz-rsvp-chrome")).toBeNull();
  });

  it("double-clicking a handle resets to fill (null)", () => {
    const onWidthPx = vi.fn();
    renderViewport(700, onWidthPx);
    const handle = host?.querySelector<HTMLElement>(".qz-rsvp-handle");
    act(() => {
      handle?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onWidthPx).toHaveBeenLastCalledWith(null);
  });
});
