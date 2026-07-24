import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clampFrameWidth, breakpointForWidth } from "./previewWidth";

// A polished, resizable device bezel. The frame is centered, so dragging the
// right-edge handle moves both edges → the width delta counts double. Pointer
// capture keeps the drag alive when the cursor leaves the handle; arrow keys
// nudge ±10px for keyboard a11y.
export function DeviceFrame({
  width,
  onWidthChange,
  children,
  bare = false,
  urlLabel,
  placement,
  resetKey,
  expand = false,
}: {
  width: number;
  onWidthChange: (w: number) => void;
  children: ReactNode;
  // QB-7 — the standalone Quizell builder renders the preview as a large, clean
  // card (no faux-browser bar, no grey box, no fixed-height scroll window): the
  // device toggle lives in the top bar, so the canvas just shows the quiz big.
  bare?: boolean;
  // Optional storefront URL shown in the faux browser bar (e.g. the funnel Rec
  // Page preview shows "yourstore.com/quiz/results"). Absent → just the width.
  urlLabel?: string;
  // build-tab handoff §4 — desktop frame dims FOLLOW PLACEMENT, and pop-up
  // renders as a real modal envelope on a dark backdrop (not a tiny toast in a
  // huge page): full = 1200×760 full-bleed · pop-up ≈ modal + margin · inline
  // = contained card (content + 200 × 720). Absent → today's sizing (other
  // mounts unchanged). Bare-desktop only; mobile always fits the phone.
  placement?: "page" | "popup" | "inline" | "product_widget";
  // phone-preview SPEC — "scroll position resets when the previewed step
  // changes, not on every keystroke": the host passes the shown node's id and
  // the frame's screen scrolls back to the top when it changes.
  resetKey?: string | null;
  // phone-preview SPEC Expand — rendered inside the dimmed overlay: mobile is
  // FLOORED at true 1:1 (always visibly bigger than the inline fit) and capped
  // at 1.4×; desktop fits both axes of the ~90%-viewport host (may upscale).
  expand?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fitBounds, setFitBounds] = useState({ width: 0, height: 0 });

  // SPEC scroll affordance — a subtle bottom fade on the phone screen that
  // disappears at the end of the scroll (and when nothing overflows). Desktop
  // hides the fade (build-tab prototype: `.device.desktop .fade{display:none}`).
  const [fadeVisible, setFadeVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFadeVisible(el.scrollHeight - el.clientHeight - el.scrollTop > 8);
  }, []);

  // §4 — content sits at a stable top offset across formats: reset the frame's
  // internal scroll whenever the placement (or the device size) switches, so a
  // format change never lands the merchant mid-page ("preview lost to the
  // bottom"). SPEC: also when the previewed STEP changes (resetKey).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    updateFade();
  }, [placement, width, resetKey, updateFade]);

  // Content growing/shrinking (blocks added, answers edited) re-evaluates the
  // fade without a scroll event.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateFade, width]);

  useEffect(() => {
    const host = fitRef.current;
    if (!host) return;
    const measure = () => setFitBounds({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [width]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startW: width };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const max = containerRef.current?.clientWidth ?? undefined;
    const next = clampFrameWidth(
      dragRef.current.startW + (e.clientX - dragRef.current.startX) * 2,
      max,
    );
    onWidthChange(next);
  };
  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    setDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onWidthChange(clampFrameWidth(width - 10));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onWidthChange(clampFrameWidth(width + 10));
    }
  };

  // QB-8 / QP-3 — bare mode: the quiz at the chosen device width, framed as a
  // single Quizell-style card (rounded + soft shadow, NO faux-browser bar, NO
  // fixed-height scroll window). The quiz paints its own background inside, so
  // the card surface IS the quiz bg — an intentional elevated card on the grey
  // canvas, not the mismatched-bg "white box". overflow:hidden only rounds the
  // corners (the card is content-height; the canvas scrolls tall pages).
  if (bare) {
    // Phone-preview SPEC primitive — a TRUE 390×844 viewport with a MINIMAL
    // bezel: no notch, no hardware chrome, rounded corners + soft shadow only
    // (the funnel's qz-s3-frame geometry, so every surface shares one look).
    // The frame is fixed; the SCREEN scrolls (overscroll contained) under a
    // bottom fade that disappears at the end of the scroll. Fit-the-pane never
    // upscales past 1:1 inline; the Expand overlay floors at 1, caps at 1.4.
    if (breakpointForWidth(width) === "mobile") {
      const logicalWidth = width;
      const logicalHeight = 844;
      const fitBoth = fitBounds.width > 0 && fitBounds.height > 0
        ? Math.min(fitBounds.width / logicalWidth, fitBounds.height / logicalHeight)
        : 1;
      const scale = expand ? Math.max(1, Math.min(1.4, fitBoth)) : Math.min(1, fitBoth);
      return (
        <div ref={fitRef} className="qz-device-fit-mobile">
          <div style={{ width: logicalWidth * scale, height: logicalHeight * scale, position: "relative", flex: "0 0 auto" }}>
            <div
              className="qz-devframe"
              style={{
                width: logicalWidth,
                height: logicalHeight,
                position: "absolute",
                top: 0,
                left: 0,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                borderRadius: 44,
                overflow: "hidden",
                background: "var(--qz-paper)",
                boxShadow: "var(--qz-lift-3)",
              }}
            >
              <div
                className="qz-devscreen"
                ref={scrollRef}
                onScroll={updateFade}
                style={{
                  width: "100%",
                  height: "100%",
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                }}
              >
                <div ref={contentRef}>{children}</div>
              </div>
              <span
                className="qz-devfade"
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 52,
                  pointerEvents: "none",
                  background: "linear-gradient(to bottom, transparent, var(--qz-paper))",
                  borderRadius: "0 0 44px 44px",
                  opacity: fadeVisible ? 1 : 0,
                  transition: "opacity 160ms var(--qz-ease, ease)",
                }}
              />
            </div>
          </div>
        </div>
      );
    }
    // §4 — placement drives the desktop frame. Undefined placement keeps the
    // pre-existing draggable-width frame (RecPagePreview etc. unchanged).
    const logicalWidth =
      placement === "page" ? 1200 : placement === "popup" ? 1000 : placement ? 920 : width;
    const logicalHeight = placement === "page" ? 760 : placement === "popup" ? 760 : 720;
    // Inline: top-anchored, WIDTH-fit, never upscale (§4). Expand overlay:
    // fit both axes of the ~90%-viewport host (may upscale — funnel parity).
    const scale = expand
      ? fitBounds.width > 0 && fitBounds.height > 0
        ? Math.min(fitBounds.width / logicalWidth, fitBounds.height / logicalHeight)
        : 1
      : fitBounds.width > 0
        ? Math.min(1, fitBounds.width / logicalWidth)
        : 1;
    const isPopup = placement === "popup";
    const isContained = placement === "inline" || placement === "product_widget";
    return (
      <div ref={fitRef} className="qz-device-fit-desktop">
        <div
          style={{
            width: logicalWidth * scale,
            height: logicalHeight * scale,
            position: "relative",
            flex: "0 0 auto",
          }}
        >
          <div
            className="qz-canvas-card"
            style={{
              position: "absolute",
              inset: 0,
              width: logicalWidth,
              height: logicalHeight,
              overflow: isPopup ? "hidden" : "auto",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              background: isContained ? "var(--qz-cream-2)" : "var(--qz-paper)",
            }}
            ref={scrollRef}
          >
            {isPopup ? (
              // Pop-up: the modal FILLS its frame — envelope min(92%, 900) wide,
              // min(90%, 760) tall, radius 16, on the .55 backdrop; internal
              // scroll lives inside the modal.
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,.55)",
                  display: "grid",
                  placeItems: "center",
                  padding: 24,
                }}
              >
                <div
                  style={{
                    width: "min(92%, 900px)",
                    maxWidth: 1200,
                    height: "min(90%, 760px)",
                    borderRadius: 16,
                    overflow: "auto",
                    background: "var(--qz-paper)",
                    boxShadow: "var(--qz-lift-3)",
                  }}
                >
                  {children}
                </div>
              </div>
            ) : isContained ? (
              // Inline: a contained card on a neutral host page (content + 200).
              <div style={{ padding: "36px 100px", minHeight: "100%" }}>
                <div
                  style={{
                    borderRadius: 14,
                    overflow: "hidden",
                    background: "var(--qz-paper)",
                    boxShadow: "var(--qz-shadow-lg)",
                  }}
                >
                  {children}
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        background: "var(--qz-rule-2, #efece6)",
        borderRadius: 14,
        padding: "24px 18px",
      }}
    >
      <div style={{ position: "relative", width, maxWidth: "100%", flex: "0 0 auto" }}>
        <div
          className="qz-card"
          style={{
            width: "100%",
            overflow: "hidden",
            borderRadius: "var(--qz-radius-lg, 14px)",
            boxShadow: "var(--qz-shadow-lg, 0 14px 44px rgba(27,26,23,.10))",
            transition: dragging ? "none" : "box-shadow 160ms var(--qz-ease, ease)",
          }}
        >
          {/* faux browser bar */}
          <div
            style={{
              height: 34,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              borderBottom: "1px solid var(--qz-rule)",
              background: "var(--qz-paper, #faf8f3)",
            }}
          >
            <span style={DOT} />
            <span style={DOT} />
            <span style={DOT} />
            <div style={{ flex: 1 }} />
            {urlLabel ? (
              <span
                className="qz-dim"
                style={{
                  fontSize: 11,
                  padding: "2px 12px",
                  borderRadius: 999,
                  background: "var(--qz-cream-2)",
                  border: "1px solid var(--qz-rule)",
                  maxWidth: "60%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {urlLabel}
              </span>
            ) : null}
            <div style={{ flex: 1 }} />
            <span className="qz-dim" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              {width}px
            </span>
          </div>
          {/* scrollable viewport — tall pages scroll inside the frame */}
          <div style={{ height: "min(70vh, 760px)", overflow: "auto", background: "#fff" }}>
            {children}
          </div>
        </div>
        {/* right-edge drag handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Resize preview width"
          aria-valuenow={width}
          aria-valuemin={320}
          aria-valuemax={1440}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: -12,
            width: 14,
            cursor: "ew-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            touchAction: "none",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              width: 4,
              height: 48,
              borderRadius: 999,
              background: dragging ? "var(--qz-accent, #e8623c)" : "var(--qz-ink-3, #b9b3a8)",
              transition: "background 120ms",
            }}
          />
        </div>
      </div>
    </div>
  );
}

const DOT: React.CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: "50%",
  background: "var(--qz-rule)",
  flex: "0 0 auto",
};
