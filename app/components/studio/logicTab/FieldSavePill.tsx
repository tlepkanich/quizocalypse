import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { isElementOutOfView } from "../../qz-overlays";
import type { SaveToken } from "../saveTracker";

/* D8 (owner 2026-09-18) — the field save pill. After a COMMITTED inline text
   edit a small "Saving… → ✓ Saved" pill shows beside the end of the edited
   text, then fades. Typing stays silent and the pill is never ambient; the
   funnel bar chip keeps "Not saved · Retry" and "Paused while AI edits".
   Design-system note: this is a field-level status badge, not a fifth
   floating surface (§7.5 lists Modal · Drawer · Popover · Toast).

   Driven by the REAL save (a SaveToken from useQuizDraft), never a timer:
     saving  — until the PUT carrying the edit returns (shown at least
               MIN_SAVING_MS so it does not flash);
     saved   — ~1.5s, then a 0.4s fade, then gone (mock svStart timings,
               started only after the real result); a polite live region
               says "Saved" (and nothing else — failures are announced by
               the bar chip);
     failed  — "Not saved", crit tone, until the field is focused again or a
               later save (e.g. Retry) succeeds, which turns it to Saved.
   Placement (mock svPlace, B61/D5): 8px after the last line box of the
   text, centred on it; if it would leave the text's column it drops under
   the end of that line (decided once per pill on the wider "Saving…"); near
   the viewport bottom it sits beside the line or above the FIRST line;
   always clamped to the viewport. position:fixed, portalled to <body>,
   pointer-events:none, aria-hidden; re-pinned on scroll (capture), resize
   and layout shifts while visible; hidden while the field is focused or
   scrolled/clipped out of view. Bound to the mounted field instance: when
   the field unmounts the pill goes with it (the save continues). */

const MIN_SAVING_MS = 650;
const SAVED_HOLD_MS = 1500;
const FADE_MS = 400;
const REPIN_MS = 120;

type Phase = "idle" | "saving" | "saved" | "fade" | "failed";

let liveRegion: HTMLElement | null = null;
/** One shared, visually hidden polite region (mock #svlive). */
function saveLiveRegion(): HTMLElement {
  if (liveRegion && liveRegion.isConnected) return liveRegion;
  const el = document.createElement("div");
  el.className = "qz-sr-only";
  el.setAttribute("aria-live", "polite");
  el.setAttribute("data-qz-keep-live", "");
  document.body.appendChild(el);
  liveRegion = el;
  return el;
}

export type PillRect = { top: number; bottom: number; left: number; right: number; height: number };

/** Pure svPlace. `under` is decided by the caller once per pill (pass the
    previous decision, or null to decide now). */
export function placeSavePill(i: {
  lastLine: PillRect;
  firstLine: PillRect;
  column: { left: number; right: number };
  pill: { width: number; height: number };
  viewport: { width: number; height: number };
  under: boolean | null;
}): { left: number; top: number; under: boolean } {
  const e = i.lastLine;
  const w = i.pill.width;
  const h = i.pill.height || 20;
  const under = i.under ?? e.right + 8 + w > i.column.right;
  const x = under ? Math.max(i.column.left, Math.min(e.right, i.column.right) - w) : e.right + 8;
  let y = under ? e.bottom + 2 : e.top + e.height / 2 - h / 2;
  let x2 = x;
  if (y + h > i.viewport.height - 4) {
    // No room under the line: never fall back onto the text. Beside the last
    // line while it fits before the window edge, else above the FIRST line.
    if (e.right + 8 + w <= i.viewport.width - 4) {
      x2 = e.right + 8;
      y = e.top + e.height / 2 - h / 2;
    } else {
      y = Math.max(4, i.firstLine.top - h - 2);
    }
  }
  y = Math.min(Math.max(4, y), i.viewport.height - h - 4);
  x2 = Math.min(Math.max(4, x2), i.viewport.width - w - 4);
  return { left: Math.round(x2), top: Math.round(y), under };
}

function lineRects(field: HTMLElement): { first: PillRect; last: PillRect } {
  const range = document.createRange();
  range.selectNodeContents(field);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const box = field.getBoundingClientRect();
  const pick = (r: DOMRect | undefined): PillRect =>
    r
      ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
      : { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
  return { first: pick(rects[0]), last: pick(rects[rects.length - 1]) };
}

const CheckGlyph = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2.2 6.4 4.8 9 9.8 3.2" />
  </svg>
);
const WarnGlyph = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 1.6 11 10.4H1Z" />
    <path d="M6 5v2.3" />
    <path d="M6 8.9v.1" />
  </svg>
);

export function FieldSavePill({
  fieldRef,
  columnRef,
  token,
  onDone,
}: {
  /** The edited text element (the pill anchors to its last line box). */
  fieldRef: RefObject<HTMLElement | null>;
  /** The text's own column (title block, answer cell, table cell). Defaults
      to the field's parent element. */
  columnRef?: RefObject<HTMLElement | null>;
  /** The save token of the committed edit; null = no pill. A new token
      replaces the current pill. */
  token: SaveToken | null;
  /** Called when the pill is gone (faded, or dismissed by focusing the field). */
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<boolean | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => setReady(true), []);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    setPhase("idle");
    const live = liveRegion;
    if (live && live.textContent === "Saved") live.textContent = "";
    onDoneRef.current?.();
  }, [clearTimers]);

  // Drive the phases from the token.
  useEffect(() => {
    clearTimers();
    underRef.current = null;
    if (!token) {
      setPhase("idle");
      return;
    }
    setPhase("saving");
    const start = Date.now();
    const showSaved = () => {
      setPhase("saved");
      saveLiveRegion().textContent = "Saved";
      later(() => {
        setPhase("fade");
        later(finish, FADE_MS);
      }, SAVED_HOLD_MS);
    };
    const onStatus = (status: ReturnType<SaveToken["status"]>) => {
      if (status === "pending") return;
      clearTimers();
      const wait = Math.max(0, start + MIN_SAVING_MS - Date.now());
      later(() => (status === "saved" ? showSaved() : setPhase("failed")), wait);
    };
    const off = token.subscribe(onStatus);
    onStatus(token.status());
    return () => {
      off();
      clearTimers();
    };
  }, [token, clearTimers, later, finish]);

  // Focusing the field again dismisses the pill (mock focusin).
  useEffect(() => {
    const field = fieldRef.current;
    if (!field || phase === "idle") return;
    const onFocus = () => finish();
    field.addEventListener("focusin", onFocus);
    return () => field.removeEventListener("focusin", onFocus);
  }, [fieldRef, phase, finish]);

  const place = useCallback(() => {
    const pill = pillRef.current;
    const field = fieldRef.current;
    if (!pill) return;
    if (!field || !field.isConnected) {
      pill.style.visibility = "hidden";
      return;
    }
    const focused = field.contains(document.activeElement);
    if (focused || isElementOutOfView(field)) {
      pill.style.visibility = "hidden";
      return;
    }
    const col = (columnRef?.current ?? field.parentElement ?? field).getBoundingClientRect();
    const { first, last } = lineRects(field);
    const p = placeSavePill({
      lastLine: last,
      firstLine: first,
      column: { left: col.left, right: col.right },
      pill: { width: pill.offsetWidth, height: pill.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      under: underRef.current,
    });
    underRef.current = p.under;
    pill.style.left = `${p.left}px`;
    pill.style.top = `${p.top}px`;
    pill.style.visibility = "";
  }, [fieldRef, columnRef]);

  useLayoutEffect(() => {
    if (phase === "idle" || !ready) return;
    place();
  }, [phase, ready, place]);

  // Re-pin while visible: scroll (capture — inner scrollers count), resize,
  // and a short interval for layout shifts that fire no event (mock svStart).
  useEffect(() => {
    if (phase === "idle" || !ready) return;
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    const iv = setInterval(place, REPIN_MS);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      clearInterval(iv);
    };
  }, [phase, ready, place]);

  // The field unmounting takes the pill with it.
  useEffect(() => () => clearTimers(), [clearTimers]);

  if (!ready || phase === "idle") return null;
  const cls = phase === "fade" ? "is-saved is-fade" : `is-${phase}`;
  return createPortal(
    <div ref={pillRef} className={`qz-fsp ${cls}`} aria-hidden="true">
      {phase === "saving" ? (
        <>
          <span className="qz-fsp-spin" />
          Saving…
        </>
      ) : phase === "failed" ? (
        <>
          <WarnGlyph />
          Not saved
        </>
      ) : (
        <>
          <CheckGlyph />
          Saved
        </>
      )}
    </div>,
    document.body,
  );
}
