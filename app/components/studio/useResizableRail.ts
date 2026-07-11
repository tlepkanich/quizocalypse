import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

// P2 Edits 9 / 13 — reusable resizable + collapsible left rail for builder
// surfaces. Returns the drag-handle's pointer handler, a collapse toggle, and
// the `--rail-w` CSS var to spread on the grid container (the grid's first
// column reads var(--rail-w)). Width is clamped to [min,max] and persisted to
// localStorage per storageKey. SSR renders `initial` (no window access).
export function useResizableRail({
  storageKey,
  min = 220,
  max = 460,
  initial = 264,
  collapsedWidth = 18,
}: {
  storageKey: string;
  min?: number;
  max?: number;
  initial?: number;
  collapsedWidth?: number;
}) {
  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, w)), [min, max]);
  const [width, setWidth] = useState(initial);
  const [collapsed, setCollapsed] = useState(false);
  const widthRef = useRef(initial);
  // The pointer handlers close over the latest collapsed state via a ref.
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  // Restore persisted width client-side (after hydration, so SSR stays `initial`).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const w = Number(raw);
        if (Number.isFinite(w)) {
          const c = clamp(w);
          widthRef.current = c;
          setWidth(c);
        }
      }
    } catch {
      /* localStorage unavailable — keep the default */
    }
  }, [storageKey, clamp]);

  // The gray bar is the one control: a plain click/tap toggles collapse, a drag
  // resizes (only meaningful while expanded). We tell them apart by whether the
  // pointer moved past a small threshold before release.
  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = widthRef.current;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > 4) moved = true;
        if (moved && !collapsedRef.current) {
          const w = clamp(startW + (ev.clientX - startX));
          widthRef.current = w;
          setWidth(w);
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
        if (!moved) {
          setCollapsed((c) => !c); // a click (no drag) toggles collapse
        } else {
          try {
            localStorage.setItem(storageKey, String(widthRef.current));
          } catch {
            /* ignore */
          }
        }
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clamp, storageKey],
  );

  const railVarStyle = {
    "--rail-w": collapsed ? `${collapsedWidth}px` : `${width}px`,
  } as CSSProperties;

  return {
    width,
    collapsed,
    toggleCollapsed: useCallback(() => setCollapsed((c) => !c), []),
    onHandlePointerDown,
    railVarStyle,
  };
}
