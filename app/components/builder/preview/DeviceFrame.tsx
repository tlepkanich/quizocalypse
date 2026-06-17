import { useRef, useState, type ReactNode } from "react";
import { clampFrameWidth } from "./previewWidth";

// A polished, resizable device bezel. The frame is centered, so dragging the
// right-edge handle moves both edges → the width delta counts double. Pointer
// capture keeps the drag alive when the cursor leaves the handle; arrow keys
// nudge ±10px for keyboard a11y.
export function DeviceFrame({
  width,
  onWidthChange,
  children,
  bare = false,
}: {
  width: number;
  onWidthChange: (w: number) => void;
  children: ReactNode;
  // QB-7 — the standalone Quizell builder renders the preview as a large, clean
  // card (no faux-browser bar, no grey box, no fixed-height scroll window): the
  // device toggle lives in the top bar, so the canvas just shows the quiz big.
  bare?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [dragging, setDragging] = useState(false);

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

  // QB-8 — bare mode: render the quiz itself, full-bleed, no framing card. The
  // quiz paints its own background (fillBackground), so the canvas just shows
  // the live quiz at the chosen device width — "no canvas, just the quiz".
  if (bare) {
    return (
      <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ width, maxWidth: "100%", flex: "0 0 auto" }}>{children}</div>
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
            transition: dragging ? "none" : "width 160ms var(--qz-ease, ease)",
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
