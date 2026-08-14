import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  INLINE_BAND_PX,
  PHONE_VIEWPORT_H_PX,
  breakpointForWidth,
  clampPreviewWidth,
  fitPreviewScale,
} from "./previewWidth";

// Layout effects must not run during SSR (same alias runtimeStyles.ts uses).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// The edge handles' rail width (must match .qz-rsvp-handle flex-basis).
const HANDLE_W = 14;

// The browser-bar address per placement — generic on purpose (no shop
// identity lives in a draft doc); it says "this is your website", the quiz's
// own tokens say whose.
const MOCK_PATH: Record<string, string> = {
  page: "/quiz",
  popup: "/",
  inline: "/pages/quiz",
  product_widget: "/products/your-product",
};

// A deliberately-generic storefront skeleton (theme-editor style): a header
// with a logo dot + nav lines and a few content blocks, so the contained
// placements read as "the quiz embedded ON YOUR PAGE" instead of a card
// floating in a void. Token-colored — never competes with the quiz.
function MockStorefront({
  kind,
  children,
}: {
  kind: "inline" | "product_widget";
  children: ReactNode;
}) {
  return (
    <div className="qz-mockstore">
      <div className="qz-mockstore-head" aria-hidden>
        <span className="qz-mockstore-logo" />
        <span className="qz-mockstore-name" />
        <span className="qz-mockstore-nav">
          <i />
          <i />
          <i />
        </span>
        <span className="qz-mockstore-cart" />
      </div>
      {kind === "product_widget" ? (
        <div className="qz-mockstore-product" aria-hidden>
          <span className="qz-mockstore-img" />
          <span className="qz-mockstore-pcol">
            <i className="is-title" />
            <i className="is-price" />
            <i />
            <i />
          </span>
        </div>
      ) : (
        <div className="qz-mockstore-hero" aria-hidden>
          <i />
          <i className="is-short" />
        </div>
      )}
      <div className="qz-mockstore-body">{children}</div>
      <div className="qz-mockstore-foot" aria-hidden>
        <i />
        <i className="is-short" />
      </div>
    </div>
  );
}

/**
 * ResizableViewport — the builder canvas's browser-window preview
 * (drag/2026-08, owner decision 2026-08-13; replaces the fixed scaled
 * DeviceFrame on this surface).
 *
 * The quiz LAYS OUT at the chosen width, always — the breakpoint can never
 * lie. The frame IS a browser window: `widthPx` is its width (null = fill
 * the pane, "what the browser shows"), the edge handles drag it, and
 * crossing BREAKPOINT_PX (900) flips the mobile/desktop layout live — the
 * merchant WATCHES the flip instead of being told about it. Wider than the
 * pane → the frame scales DOWN to fit (fitPreviewScale) so the merchant
 * always sees the WHOLE page — never a cropped slice; 1:1 whenever it fits.
 * Height fills the pane; mobile-mode frames cap at the canonical 745 phone
 * viewport and keep the fold marker when the full 745 fits.
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
  // Reports the RENDERED width whenever it changes (pane width in fill mode)
  // plus the applied fit scale (1 whenever the frame fits the pane 1:1).
  onEffectiveWidth?: (w: number, scale: number) => void;
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
  // Fit rule (previewWidth.fitPreviewScale) — the layout renders AT
  // effectiveW (breakpoint honesty) but scales down to fit the pane, so the
  // 1280 desktop preset shows the WHOLE page instead of a cropped slice.
  const scale = fitPreviewScale(effectiveW, Math.max(0, pane.w - HANDLE_W * 2));

  const onEffRef = useRef(onEffectiveWidth);
  useEffect(() => {
    onEffRef.current = onEffectiveWidth;
  });
  useEffect(() => {
    if (effectiveW > 0) onEffRef.current?.(effectiveW, scale);
  }, [effectiveW, scale]);

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
  // LAYOUT height — the unscaled height the frame renders at; its VISUAL
  // height is layoutH · scale, sized to fill the pane. Mobile frames never
  // show more above the fold than a phone does (the 745 cap).
  const layoutH =
    pane.h > 0
      ? mode === "mobile"
        ? Math.min(pane.h / scale, PHONE_VIEWPORT_H_PX)
        : pane.h / scale
      : null;
  const visualH = layoutH != null ? layoutH * scale : null;
  const foldVisible = mode === "mobile" && layoutH === PHONE_VIEWPORT_H_PX;

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
        style={{
          margin: "auto",
          flex: "0 0 auto",
          display: "flex",
          alignItems: "stretch",
          height: visualH ?? "100%",
        }}
      >
        {handle(-1)}
        {/* The scale box reserves the frame's VISUAL footprint (layout size ×
            fit scale) so the handles hug the scaled edges and the row never
            overflows the pane. At scale 1 it is a no-op wrapper. */}
        <div
          className="qz-rsvp-scalebox"
          style={{
            position: "relative",
            width: effectiveW > 0 ? effectiveW * scale : "100%",
            height: "100%",
            overflow: "hidden",
            flex: "0 0 auto",
          }}
        >
        <div
          className="qz-rsvp-frame qz-devframe"
          data-qz-mode={mode}
          style={{
            position: "relative",
            width: effectiveW > 0 ? effectiveW : "100%",
            height: layoutH != null ? layoutH : "100%",
            // A2 (carried from DeviceFrame) — ALWAYS a transform, scale(s)
            // and never undefined/none (s is the fit scale, 1 when the frame
            // fits the pane). Together with `contain: paint` this makes the
            // frame the containing block for the runtime's position:fixed
            // chip / scrim / sheet AND clips them to the frame. Drop either
            // and they anchor to the merchant's browser window and float
            // over the whole admin.
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            contain: "paint",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* The browser chrome (desktop widths only — the phone screen stays
              borderless per the Quartz frames spec): three dots + the address.
              This is what makes the frame READ as "your website in a browser"
              instead of an abstract rectangle. */}
          {mode === "desktop" ? (
            <div className="qz-rsvp-chrome" aria-hidden>
              <span className="qz-rsvp-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="qz-rsvp-url">
                yourstore.com
                <em>{MOCK_PATH[placement ?? "page"] ?? "/quiz"}</em>
              </span>
            </div>
          ) : null}
          {/* Frame fixed, screen scrolls — exactly a browser window. */}
          <div
            className="qz-devscreen"
            ref={screenRef}
            style={{
              width: "100%",
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehavior: "contain",
            }}
          >
            {isPopup ? (
              // Pop-up placement: the launcher modal over YOUR PAGE — the
              // mock storefront sits dimmed behind the centered modal,
              // exactly what a shopper's window shows. The stage is a fixed,
              // non-scrolling snapshot so the scrim never scrolls away.
              <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
                <MockStorefront kind="inline">
                  <div className="qz-mockstore-hero" aria-hidden>
                    <i />
                    <i />
                    <i className="is-short" />
                  </div>
                </MockStorefront>
                <div
                  className="qz-dpop-backdrop"
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    // Phones give a modal almost the whole screen — mirror it.
                    padding: mode === "mobile" ? 12 : 32,
                  }}
                >
                  <div
                    className="qz-dpop-modal"
                    style={{
                      width: mode === "mobile" ? "100%" : "min(76%, 760px)",
                      maxWidth:
                        mode === "mobile" ? "calc(100% - 8px)" : "calc(100% - 64px)",
                      maxHeight:
                        mode === "mobile" ? "calc(100% - 16px)" : "calc(100% - 64px)",
                    }}
                  >
                    {children}
                  </div>
                </div>
              </div>
            ) : isContained ? (
              // Inline / product widget: the quiz embedded in the mock
              // storefront page, capped at the 960 inline band a typical
              // theme column gives it — width-truthful at any frame size.
              <MockStorefront kind={placement === "product_widget" ? "product_widget" : "inline"}>
                <div
                  className="qz-dinline-card"
                  style={{ maxWidth: INLINE_BAND_PX, margin: "0 auto" }}
                >
                  {children}
                </div>
              </MockStorefront>
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
        </div>
        {handle(1)}
      </div>
    </div>
  );
}
