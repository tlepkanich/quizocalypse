import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/* Design-system-V2 §7.5 — Toast: non-blocking transient confirmations
   ("Saved", "Added", "Moved"). Bottom-center ink pill, 13px white text,
   auto-dismiss 2.4s, enters with fade + 16px rise. NEVER stacks — a new
   toast replaces the current one (queue of 1). Not clickable, no actions:
   if an action is needed, it isn't a toast.

   2026-09-22 owner ruling D7: one optional action (Undo). A toast may carry
   ONE action button (in practice always "Undo" / "Undo both" / "Undo all N",
   see studio/logicTab/useLogicUndo.ts). The pill itself stays
   pointer-events:none; only the action button takes the pointer. With an
   action the toast:
     • lasts 6s by default (a `duration` option overrides it);
     • pauses its timer while hovered (mouseenter/leave — the pill is
       pointer-events:none, so CSS :hover never matches) or while it holds a
       visible keyboard focus (:focus-visible), and re-arms on the way out;
     • answers Ctrl/Cmd+Z (no Shift, not while typing in a field) — only
       while it is showing, so a stale Undo can never roll back later edits;
     • is announced through an always-mounted polite live region (the pill
       itself mounts and unmounts, so it cannot be the region) as
       "<message>. Press Undo, or Ctrl+Z, to bring it back.";
     • never silently loses its action to a plain message (B7): a plain
       message that arrives while an action toast is up is dropped, and the
       action toast stays (queue-of-one keeps the Undo).
   While a toast is up the provider publishes `--qz-toast-reserve` (toast
   height + 28px) on :root; QzModal's scrim pads its bottom by it so a toast
   never covers an open window's footer (mock placeToast, B34). */

const AUTO_DISMISS_MS = 2400;
const ACTION_DISMISS_MS = 6000;
/** Space an open window keeps free under itself while a toast is up. */
const TOAST_RESERVE_GAP_PX = 28;
const RESERVE_VAR = "--qz-toast-reserve";

export type QzToastAction = { label: string; onAction: () => void };

/** Why a toast left the screen — handed to `onHide`. `updated` never fires:
    a same-key toast updates in place without hiding. */
export type QzToastHideReason = "timeout" | "replaced" | "action";

export type QzToastOptions = {
  /** ONE optional action (D7). */
  action?: QzToastAction;
  /** ms before auto-dismiss. Default 2400, or 6000 with an action. */
  duration?: number;
  /** Move focus to the action button when the toast shows — for the case
      where the control that triggered it was just destroyed. The action also
      takes focus automatically when focus has already fallen to <body>. */
  focusAction?: boolean;
  /** Where focus goes when the toast hides while holding it (so it never
      drops to <body>). */
  returnFocus?: () => void;
  /** Toasts sharing a key UPDATE each other in place (no onHide for the one
      being updated) — the Undo accumulator re-labels its own toast this way. */
  key?: string;
  /** Called once when this toast leaves the screen. */
  onHide?: (reason: QzToastHideReason) => void;
};

export type QzToastState = {
  id: number;
  message: string;
  action?: QzToastAction;
  duration?: number;
  focusAction?: boolean;
  returnFocus?: () => void;
  key?: string;
  onHide?: (reason: QzToastHideReason) => void;
};

export type QzToastFn = (message: string, options?: QzToastOptions) => number;

/** Pure queue-of-1 reducer semantics, exported for tests: a new message
    replaces the current one and restarts the clock — EXCEPT that a plain
    message never replaces a live action toast (B7: the Undo survives). */
export function nextToastState(
  current: QzToastState | null,
  message: string,
  id: number,
  options?: QzToastOptions,
): QzToastState {
  if (current?.action && !options?.action && (options?.key === undefined || options.key !== current.key)) {
    return current;
  }
  const next: QzToastState = { id, message };
  if (options?.action) next.action = options.action;
  if (options?.duration !== undefined) next.duration = options.duration;
  if (options?.focusAction) next.focusAction = true;
  if (options?.returnFocus) next.returnFocus = options.returnFocus;
  if (options?.key !== undefined) next.key = options.key;
  if (options?.onHide) next.onHide = options.onHide;
  return next;
}

/** Auto-dismiss time for a toast state. */
export function toastDuration(state: Pick<QzToastState, "action" | "duration">): number {
  return state.duration ?? (state.action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS);
}

/** The live-region sentence (mock toastLive). */
export function toastAnnouncement(state: Pick<QzToastState, "message" | "action"> | null): string {
  if (!state) return "";
  return state.message + (state.action ? ". Press Undo, or Ctrl+Z, to bring it back." : "");
}

/** Whether a keydown is the toast's Undo shortcut (Ctrl/Cmd+Z, no Shift, not
    inside a text field). Exported for tests. */
export function isToastUndoKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "target">): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return false;
  if (String(e.key).toLowerCase() !== "z") return false;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
    return false;
  }
  return true;
}

const noopToast: QzToastFn = () => 0;
const ToastContext = createContext<QzToastFn>(noopToast);

export function useQzToast(): QzToastFn {
  return useContext(ToastContext);
}

function holdsVisibleFocus(el: HTMLElement): boolean {
  try {
    return el.querySelector(":focus-visible") !== null;
  } catch {
    // Engines without :focus-visible (old jsdom): any focus inside counts.
    return el.contains(document.activeElement);
  }
}

export function QzToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<QzToastState | null>(null);
  const toastRef = useRef<QzToastState | null>(null);
  const [ready, setReady] = useState(false);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const hot = useRef(false);

  useEffect(() => setReady(true), []);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hide = useCallback(
    (id: number, reason: QzToastHideReason) => {
      const current = toastRef.current;
      if (!current || current.id !== id) return;
      const pill = pillRef.current;
      const hadFocus = !!pill && pill.contains(document.activeElement);
      clearTimer();
      hot.current = false;
      toastRef.current = null;
      setToast(null);
      current.onHide?.(reason);
      if (hadFocus) current.returnFocus?.();
    },
    [clearTimer],
  );

  const arm = useCallback(() => {
    clearTimer();
    const current = toastRef.current;
    if (!current) return;
    const pill = pillRef.current;
    if (hot.current || (pill && holdsVisibleFocus(pill))) return;
    const id = current.id;
    timer.current = setTimeout(() => hide(id, "timeout"), toastDuration(current));
  }, [clearTimer, hide]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const show = useCallback<QzToastFn>(
    (message, options) => {
      const current = toastRef.current;
      counter.current += 1;
      const next = nextToastState(current, message, counter.current, options);
      if (next === current) return current.id; // B7: the live Undo stays
      const sameKey = current && options?.key !== undefined && current.key === options.key;
      toastRef.current = next;
      setToast(next);
      if (current && !sameKey) current.onHide?.("replaced");
      clearTimer();
      hot.current = false;
      const id = next.id;
      timer.current = setTimeout(() => hide(id, "timeout"), toastDuration(next));
      return id;
    },
    [clearTimer, hide],
  );

  const runAction = useCallback(() => {
    const current = toastRef.current;
    if (!current?.action) return;
    const { onAction } = current.action;
    hide(current.id, "action");
    onAction();
  }, [hide]);

  // Focus the action when asked, or when focus already fell to <body>.
  useEffect(() => {
    if (!toast?.action) return;
    const btn = actionRef.current;
    if (!btn) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (toast.focusAction || lost) btn.focus({ preventScroll: true });
    // Re-arm after a programmatic focus: a focus that is not :focus-visible
    // (mouse flow) must not hold the timer.
    arm();
  }, [toast, arm]);

  // Ctrl/Cmd+Z reaches the Undo while (and only while) it is showing. Capture
  // phase + stopImmediatePropagation, so a host ⌘Z history (the builder) does
  // not ALSO undo in the same keystroke.
  useEffect(() => {
    if (!toast?.action) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isToastUndoKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      runAction();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toast, runAction]);

  // Publish the reserve windows keep free (placeToast).
  useLayoutEffect(() => {
    const root = document.documentElement;
    const pill = pillRef.current;
    if (!toast || !pill) {
      root.style.removeProperty(RESERVE_VAR);
      return;
    }
    const publish = () => {
      const h = Math.round(pill.getBoundingClientRect().height) + TOAST_RESERVE_GAP_PX;
      root.style.setProperty(RESERVE_VAR, `${h}px`);
    };
    publish();
    if (typeof ResizeObserver === "undefined") return () => root.style.removeProperty(RESERVE_VAR);
    const ro = new ResizeObserver(publish);
    ro.observe(pill);
    return () => {
      ro.disconnect();
      root.style.removeProperty(RESERVE_VAR);
    };
  }, [toast]);

  const onEnter = useCallback(() => {
    hot.current = true;
    clearTimer();
  }, [clearTimer]);
  const onLeave = useCallback(() => {
    hot.current = false;
    setTimeout(arm);
  }, [arm]);
  const onFocusIn = useCallback(() => {
    const pill = pillRef.current;
    if (pill && holdsVisibleFocus(pill)) clearTimer();
  }, [clearTimer]);
  const onFocusOut = useCallback(() => {
    setTimeout(arm);
  }, [arm]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {ready
        ? createPortal(
            <>
              {/* B32: always in the tree, so the announcement is never lost
                  to the pill mounting in the same frame. */}
              <div className="qz-sr-only" role="status" aria-live="polite" aria-atomic="true" data-qz-keep-live="">
                {toastAnnouncement(toast)}
              </div>
              {toast ? (
                <div
                  ref={pillRef}
                  className={`qz-toast${toast.action ? " has-action" : ""}`}
                  key={toast.key ?? toast.id}
                  data-qz-keep-live=""
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  onFocus={onFocusIn}
                  onBlur={onFocusOut}
                >
                  {toast.message}
                  {toast.action ? (
                    <button ref={actionRef} type="button" className="qz-toast-action" onClick={runAction}>
                      {toast.action.label}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}
