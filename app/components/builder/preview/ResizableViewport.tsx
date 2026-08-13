import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  INLINE_BAND_PX,
  PHONE_VIEWPORT_H_PX,
  breakpointForWidth,
  clampPreviewWidth,
} from "./previewWidth";

// Layout effects must not run during SSR (same alias runtimeStyles.ts uses).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// The edge handles' rail width (must match .qz-rsvp-handle flex-basis).
const HANDLE_W = 14;

/**
 * ResizableViewport — the builder canvas's browser-window preview
 * (drag/2026-08, owner decision 2026-08-13; replaces the fixed scaled
 * DeviceFrame on this surface).
 *
 * The quiz renders at 100% scale, always. The frame IS a browser window:
 * `widthPx` is its width (null = fill the pane, "what the browser shows"),
 * the edge handles drag it, and crossing BREAKPOINT_PX (900) flips the
 * mobile/desktop layout live — the merchant WATCHES the flip instead of
 * being told about it. Wider than the pane → the pane scrolls horizontally
 * (the `margin: auto` centering keeps both edges reachable). Height fills
 * the pane; mobile-mode frames cap at the canonical 745 phone viewport and
 * keep the fold marker when the full 745 fits.
 *
 * Width state lives in the HOST (UnifiedWorkspace lifts it so the device
 * presets, the width readout, and the design-layer selector all read the
 * same number). `onEffectiveWidth` reports the rendered width — pane-sized
 * in fill mode — so the host can derive the mode without measuring DOM.
 */
export function ResizableViewport({
  widthPx,
  onWidthPx,
  onEffectiveWidth,
  placement,
  resetKey,
  paneHeight = "100%",
  children,
}: {
  // The frame width. null = fill the pane (the default "browser" state).
  widthPx: number | null;
  // Drag / keyboard resize writes back through this (never called with null —
  // a double-click on either handle resets to fill, which does pass null).
  onWidthPx: (w: number | null) => void;
  // Reports the RENDERED width whenever it changes (pane width in fill mode).
  onEffectiveWidth?: (w: number) => void;
  // The container INSIDE the viewport (same meanings as the old DeviceFrame):
  // pop-up = modal envelope on a dark backdrop; inline/product_widget = a
  // contained card (capped at the 960 inline band) on a neutral host page.
  placement?: "page" | "popup" | "inline" | "product_widget";
  // Scroll resets when the previewed step changes, not on every keystroke.
  resetKey?: string | null;
  // The pane's height. A host whose container is auto-height MUST pass a
  // definite value or the frame collapses to 0.
  paneHeight?: number | string;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState({ w: 0, h: 0 });

  useIsoLayoutEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => setPane({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fill mode tracks the pane (minus the two 14px handle rails, so the row
  // never overflows its own pane); a dragged/preset width is clamped the same
  // way the drag itself clamps, so a stale number can't explode the pane.
  const effectiveW =
    widthPx != null ? clampPreviewWidth(widthPx) : Math.max(0, pane.w - HANDLE_W * 2);
  const mode = breakpointForWidth(effectiveW || 0);

  const onEffRef = useRef(onEffectiveWidth);
  useEffect(() => {
    onEffRef.current = onEffectiveWidth;
  });
  useEffect(() => {
    if (effectiveW > 0) onEffRef.current?.(effectiveW);
  }, [effectiveW]);

  // Reset the screen's scroll when the previewed step or placement changes —
  // a switch never lands the merchant mid-page.
  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = 0;
  }, [placement, resetKey]);

  // ── drag ──────────────────────────────────────────────────────────────────
  // Symmetric: the frame stays centered, so dragging one edge by dx changes
  // the width by 2·dx. Pointer capture keeps the drag alive outside the rail.
  const dragRef = useRef<{ startX: number; startW: number; dir: 1 | -1 } | null>(null);
  const startDrag = (dir: 1 | -1) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (effectiveW <= 0) return;
    dragRef.current = { startX: e.clientX, startW: effectiveW, dir };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    onWidthPx(clampPreviewWidth(d.startW + (e.clientX - d.startX) * 2 * d.dir));
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  // Keyboard resize on the focused handle; double-click resets to fill.
  const keyResize = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      onWidthPx(clampPreviewWidth(effectiveW - step));
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      onWidthPx(clampPreviewWidth(effectiveW + step));
      e.preventDefault();
    }
  };

  const isPopup = placement === "popup";
  const isContained = placement === "inline" || placement === "product_widget";
  // Mobile frames never show more above the fold than a phone does.
  const frameH =
    mode === "mobile" && pane.h > 0 ? Math.min(pane.h, PHONE_VIEWPORT_H_PX) : "100%";
  const foldVisible = mode === "mobile" && frameH === PHONE_VIEWPORT_H_PX;

  const handle = (dir: 1 | -1) => (
    <div
      className="qz-rsvp-handle"
      data-side={dir === 1 ? "right" : "left"}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview width"
      title="Drag to resize — the layout flips at 900px. Double-click to fit the pane."
      tabIndex={0}
      onPointerDown={startDrag(dir)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={keyResize}
      onDoubleClick={() => onWidthPx(null)}
    >
      <span aria-hidden />
    </div>
  );

  return (
    <div
      ref={paneRef}
      className={`qz-rsvp qz-device-fit-${mode === "mobile" ? "mobile" : "desktop"}`}
      style={{
        position: "relative",
        flex: "1 1 auto",
        width: "100%",
        height: paneHeight,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        // margin:auto on the row centers it when it fits and keeps BOTH edges
        // reachable when the frame is wider than the pane (overflow scrolls).
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      <div
        className="qz-rsvp-row"
        style={{ margin: "auto", flex: "0 0 auto", display: "flex", alignItems: "stretch", height: frameH }}
      >
        {handle(-1)}
        <div
          className="qz-rsvp-frame qz-devframe"
          data-qz-mode={mode}
          style={{
            position: "relative",
            width: effectiveW > 0 ? effectiveW : "100%",
            height: "100%",
            // A2 (carried from DeviceFrame) — ALWAYS a transform, `scale(1)`
            // and never undefined/none. Together with `contain: paint` this
            // makes the frame the containing block for the runtime's
            // position:fixed chip / scrim / sheet AND clips them to the frame.
            // Drop either and they anchor to the merchant's browser window
            // and float over the whole admin.
            transform: "scale(1)",
            transformOrigin: "top left",
            contain: "paint",
          }}
        >
          {/* Frame fixed, screen scrolls — exactly a browser window. */}
          <div
            className="qz-devscreen"
            ref={screenRef}
            style={{
              width: "100%",
              height: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehavior: "contain",
            }}
          >
            {isPopup ? (
              // Pop-up placement: an opaque stage behind a centered modal —
              // the container a shopper's window shows, inside our viewport.
              <div
                className="qz-dpop-backdrop"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  padding: 32,
                }}
              >
                <div
                  className="qz-dpop-modal"
                  style={{
                    width: "min(76%, 760px)",
                    maxWidth: "calc(100% - 64px)",
                    maxHeight: "calc(100% - 64px)",
                  }}
                >
                  {children}
                </div>
              </div>
            ) : isContained ? (
              // Inline / product widget: a contained card on a neutral host
              // page, capped at the 960 inline band a typical theme column
              // gives an embedded quiz — width-truthful at any frame size.
              <div style={{ padding: "40px 24px", minHeight: "100%" }}>
                <div
                  className="qz-dinline-card"
                  style={{ maxWidth: INLINE_BAND_PX, margin: "0 auto" }}
                >
                  {children}
                </div>
              </div>
            ) : (
              children
            )}
          </div>
          {/* The fold marker (same affordance the phone DeviceFrame ships):
              a dashed line 78px up — where the 667px small-phone viewport
              cuts the 745 frame. Only when the full 745 height fits. */}
          {foldVisible ? (
            <span className="qz-devfold" aria-hidden>
              fold
            </span>
          ) : null}
        </div>
        {handle(1)}
      </div>
    </div>
  );
}
