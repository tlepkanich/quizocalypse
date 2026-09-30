import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/* =====================================================================
   Design-system-V2 §7.5 — the overlay contracts. Every popup in the
   product is ONE of the four surfaces (Modal · Drawer · Popover · Toast —
   Toast lives in qz-toast.tsx). If a new need doesn't fit, the design
   system gets amended first — no fifth surface in a feature branch.
   All portal to document.body (the builder-overlay-portal lesson: in-flow
   position:fixed gets pointer-trapped by container-type/zoom transforms).
   Z ladder: drawer 80 · modal 120 · toast 200. Modal-over-drawer is the
   ONE legal stack (the drawer's unsaved-changes intercept).

   LOGIC-STEP Phase 3 (2026-09) upgrades, all opt-in where they could change
   an existing screen:
     QzModal   — background inert while open (default on; the scrim already
                 blocks the pointer and the trap already holds Tab, so this
                 only stops assistive tech and stray focus reaching the page),
                 `draftSafe` scrim, `lockScroll`, `returnFocus` fallback, and
                 bottom room for a live toast (--qz-toast-reserve, CSS).
     QzPopover — re-anchors on resize / scroll / content change (always);
                 B27 flip-or-cap decided once per open with the
                 [data-qz-pop-list] list giving up height first (always);
                 `manageFocus` (focus in, arrows, Tab-out closes, focus back
                 to the trigger), `closeOnAnchorHidden`, `ariaHaspopup`,
                 `align`, `offset`, `width`, `ariaLabel`.
     QzMenu    — manages focus by default (the ARIA menu-button pattern),
                 arrow/Home/End roving, `checked` → menuitemradio.
   ===================================================================== */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Trap Tab focus inside `ref` while `active`; restore focus to the previously
    focused element on cleanup. Initial focus goes to `initialRef` when given
    (modals: the least-destructive action), else the first focusable.
    `onRestoreFail` (optional) runs instead when the previously focused
    element is gone by then, so focus never drops to <body>. */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  initialRef?: React.RefObject<HTMLElement | null>,
  onRestoreFail?: () => void,
) {
  const restoreFailRef = useRef(onRestoreFail);
  restoreFailRef.current = onRestoreFail;
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const initial =
      initialRef?.current ?? container.querySelector<HTMLElement>(FOCUSABLE) ?? container;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previous && previous.isConnected && previous !== document.body) previous.focus?.();
      else if (restoreFailRef.current) restoreFailRef.current();
      else previous?.focus?.();
    };
  }, [active, ref, initialRef]);
}

/** SSR-safe portal mount (nothing renders on the server). */
function usePortalReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

/** Make every body child except `keep` (and live regions / toasts marked
    data-qz-keep-live) inert while `active` — the mock's winSync. Restores
    only what it set, so stacked windows unwind correctly. */
function useInertBackground(keepRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const keep = keepRef.current;
    if (!active || !keep) return;
    const touched: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child === keep || child.contains(keep)) continue;
      if (child.hasAttribute("data-qz-keep-live")) continue;
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE" || child.tagName === "LINK") continue;
      if (child.inert) continue;
      child.inert = true;
      touched.push(child);
    }
    return () => {
      for (const el of touched) el.inert = false;
    };
  }, [keepRef, active]);
}

/** Opt-in page-scroll lock while `active`. */
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [active]);
}

/* ── Modal ──────────────────────────────────────────────────────────────
   Destructive-and-final confirms + critical decisions that must block the
   page. Sizes 440 (confirm) / 640 (content) / 880 (editor); centered;
   scrim + 2px blur; 18px radius; lift-3; fade+scale .97→1.
   Dismissal: Esc + scrim-click ONLY when non-destructive; destructive
   confirms require an explicit button press. ✕ only on content/editor
   modals, never on confirms. Focus trapped; initial focus = the least-
   destructive action (pass `initialFocusRef`, e.g. the Cancel button).
   `draftSafe` windows hold a draft: a scrim click never closes them (Esc,
   ✕ and the footer still do). */
export function QzModal({
  open,
  onClose,
  size = "sm",
  width,
  title,
  icon,
  footer,
  destructive = false,
  initialFocusRef,
  className,
  draftSafe = false,
  lockScroll = false,
  inertBackground = true,
  returnFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** sm = 440 confirm · md = 640 content · lg = 880 editor */
  size?: "sm" | "md" | "lg";
  /** Exact-width override in px (a mock-specified modal, e.g. the start
      modal's 560). Wins over the size class; still capped to the viewport. */
  width?: number;
  title?: ReactNode;
  /** Optional 44px role-colored icon tile above the title. */
  icon?: ReactNode;
  footer?: ReactNode;
  destructive?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Extra class on the .qz-modal box (a mock-specified placement, e.g. the
      create-quiz dialog opening 8vh from the top). */
  className?: string;
  /** Scrim clicks never close the window (it holds a draft). */
  draftSafe?: boolean;
  /** Lock the page's scroll while open. */
  lockScroll?: boolean;
  /** Make the rest of the page inert while open (default true). */
  inertBackground?: boolean;
  /** Where focus goes on close when the control that opened the window is
      gone (focus otherwise returns to it). */
  returnFocus?: () => void;
  children?: ReactNode;
}) {
  const ready = usePortalReady();
  const scrimRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  // Trap only once the portal content exists: a modal mounted with open=true
  // runs this effect before `ready` flips, when boxRef is still null — gating
  // on `ready` re-arms it after the portal mounts so initial focus lands.
  useFocusTrap(boxRef, open && ready, initialFocusRef, returnFocus);
  useInertBackground(scrimRef, open && ready && inertBackground);
  useScrollLock(open && ready && lockScroll);

  useEffect(() => {
    if (!open || destructive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, destructive, onClose]);

  if (!ready || !open) return null;
  const scrimCloses = !destructive && !draftSafe;
  return createPortal(
    <div
      ref={scrimRef}
      className="qz-modal-scrim"
      onMouseDown={scrimCloses ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      <div
        ref={boxRef}
        className={`qz-modal qz-modal--${size}${className ? " " + className : ""}`}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        role={destructive ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={title ? labelId : undefined}
      >
        {/* §A2 — visible × on every non-destructive modal (any size).
            Destructive alertdialogs keep explicit Cancel/confirm only. */}
        {!destructive ? (
          <button type="button" className="qz-modal-x" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        ) : null}
        {icon ? <div className="qz-modal-icon">{icon}</div> : null}
        {title ? (
          <h2 id={labelId} className="qz-modal-title">
            {title}
          </h2>
        ) : null}
        <div className="qz-modal-body">{children}</div>
        {footer ? <div className="qz-modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ── Drawer ─────────────────────────────────────────────────────────────
   Editing config, previews, side-by-side workflows — the page behind stays
   relevant. Always slides from the RIGHT; min(496px, 40vw) × full height;
   scrim without blur; lift-3 on the leading edge. Esc / scrim / ✕ all
   close — unless `dirty`, in which case dismissal intercepts with a
   discard-confirm modal (modal-over-drawer: the one legal stack). */
export function QzDrawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width,
  dirty = false,
  onDiscard,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** When true, Esc/scrim/✕ open a discard-confirm instead of closing. */
  dirty?: boolean;
  onDiscard?: () => void;
  children: ReactNode;
}) {
  const ready = usePortalReady();
  const boxRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const [confirming, setConfirming] = useState(false);
  useFocusTrap(boxRef, open && !confirming);

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) {
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, confirming, requestClose]);

  if (!ready || !open) return null;
  return createPortal(
    <>
      <div
        className="qz-drawer-scrim"
        onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      >
        <div
          ref={boxRef}
          className="qz-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          style={width ? { width } : undefined}
        >
          <div className="qz-drawer-head">
            <div>
              <h2 id={labelId} className="qz-drawer-title">
                {title}
              </h2>
              {subtitle ? <div className="qz-drawer-sub">{subtitle}</div> : null}
            </div>
            <button type="button" className="qz-drawer-x" aria-label="Close" onClick={requestClose}>
              <X size={18} strokeWidth={2} />
            </button>
          </div>
          <div className="qz-drawer-body">{children}</div>
          {footer ? <div className="qz-drawer-foot">{footer}</div> : null}
        </div>
      </div>
      <QzModal
        open={confirming}
        onClose={() => setConfirming(false)}
        destructive
        title="Discard changes?"
        footer={
          <>
            <button type="button" className="qz-btn" onClick={() => setConfirming(false)}>
              Keep editing
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-danger"
              onClick={() => {
                setConfirming(false);
                onDiscard?.();
                onClose();
              }}
            >
              Discard
            </button>
          </>
        }
      >
        Your unsaved edits in this panel will be lost.
      </QzModal>
    </>,
    document.body,
  );
}

/* ── Popover placement (pure) ─────────────────────────────────────────── */

export type PopoverRect = { top: number; bottom: number; left: number; right: number };

export type PopoverPlacementInput = {
  anchor: PopoverRect;
  viewport: { width: number; height: number };
  /** Rendered popover size with no inline height cap. */
  popHeight: number;
  popWidth: number;
  /** Rendered height of the [data-qz-pop-list] list, if any. */
  listHeight: number | null;
  placement: "top" | "bottom";
  align: "start" | "end";
  offset: number;
  /** The side decided at open — kept for the life of the popover (B27). */
  decidedSide?: "top" | "bottom";
};

export type PopoverPlacement = {
  side: "top" | "bottom";
  left: number;
  /** For side bottom: the popover's top edge. For side top: the popover's
      bottom edge (so a growing popover grows upward). */
  edge: number;
  maxHeight: number | null;
  listMaxHeight: number | null;
};

const POP_MARGIN = 8;
const POP_MIN_ROOM = 120;
const POP_MIN_LIST = 96;

/** Mock placePop (B27): below the anchor when it fits, otherwise above when
    there is more room there; capped to that room either way, with the long
    list inside giving up its height first so the title, search and footer
    stay visible. Horizontal: start- or end-aligned, clamped to an 8px side
    margin. */
export function computePopoverPlacement(i: PopoverPlacementInput): PopoverPlacement {
  const below = i.viewport.height - i.anchor.bottom - i.offset - POP_MARGIN;
  const above = i.anchor.top - i.offset - POP_MARGIN;
  let side = i.decidedSide;
  if (!side) {
    if (i.placement === "bottom") side = i.popHeight > below && above > below ? "top" : "bottom";
    else side = i.popHeight > above && below > above ? "bottom" : "top";
  }
  const room = Math.max(POP_MIN_ROOM, side === "top" ? above : below);
  let maxHeight: number | null = null;
  let listMaxHeight: number | null = null;
  if (i.popHeight > room) {
    maxHeight = Math.floor(room);
    if (i.listHeight !== null) {
      listMaxHeight = Math.max(POP_MIN_LIST, Math.floor(i.listHeight - (i.popHeight - room)));
    }
  }
  const w = i.popWidth;
  const rawLeft = i.align === "end" ? i.anchor.right - w : i.anchor.left;
  const left = Math.max(POP_MARGIN, Math.min(rawLeft, i.viewport.width - w - POP_MARGIN));
  const edge = side === "bottom" ? i.anchor.bottom + i.offset : i.anchor.top - i.offset;
  return { side, left, edge, maxHeight, listMaxHeight };
}

/** Whether `rect` is scrolled out of the viewport or out of any clipping
    ancestor of `el` (mock placePop's "the anchor left view"). */
function anchorHidden(el: HTMLElement): boolean {
  if (!el.isConnected || el.getClientRects().length === 0) return true;
  const r = el.getBoundingClientRect();
  if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return true;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) continue;
    const c = p.getBoundingClientRect();
    if (r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right) return true;
  }
  return false;
}

/** Items the arrow keys walk inside a focus-managed popover. */
const ROVE_SELECTOR =
  '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="option"]:not([aria-disabled="true"]), [role="radio"]:not([disabled])';

/** Next index for ArrowUp/ArrowDown/Home/End over `count` items (wrapping);
    -1 current = nothing focused yet. Returns null for other keys. */
export function nextRovingIndex(current: number, count: number, key: string): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}

/** Mock popFocus (B29): the chosen radio / menuitemradio, else the search
    box, else the first control, else the popover itself. */
export function pickPopoverInitialFocus(container: HTMLElement): HTMLElement {
  const chosen = container.querySelector<HTMLElement>(
    '[role="radio"][aria-checked="true"], [role="menuitemradio"][aria-checked="true"]',
  );
  if (chosen) return chosen;
  const search = container.querySelector<HTMLElement>('input[type="search"]:not([disabled])');
  if (search) return search;
  const first = container.querySelector<HTMLElement>(`${FOCUSABLE}, ${ROVE_SELECTOR}`);
  return first ?? container;
}

/* ── Popover ────────────────────────────────────────────────────────────
   Contextual info (ⓘ explainers, health checks), small pickers. Anchored
   to its trigger with an 8px offset, flips at viewport edges, no backdrop
   (page stays interactive), 14px radius, lift-3, 140ms fade+rise.
   ONE popover at a time — opening another closes the first (a module-level
   registry enforces it). Dismiss: outside-click, Esc, re-click trigger. */
let closeOpenPopover: (() => void) | null = null;

export type QzHaspopup = "dialog" | "menu" | "listbox" | "grid" | "tree" | "true";

export function QzPopover({
  trigger,
  content,
  placement = "bottom",
  maxWidth = 340,
  open: controlledOpen,
  onOpenChange,
  anchorRef: measureRef,
  ariaHaspopup = "dialog",
  ariaLabel,
  manageFocus = false,
  closeOnAnchorHidden = false,
  align = "start",
  offset = 8,
  width,
  className,
}: {
  /** The trigger element; the popover wires click + aria onto a wrapper. */
  trigger: ReactNode;
  content: ReactNode;
  placement?: "top" | "bottom";
  maxWidth?: number;
  /** Optional controlled mode (e.g. the health pill opened by Continue). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional element to POSITION against instead of the trigger wrapper —
   *  e.g. a card whose small count button opens a peek that should sit
   *  above the whole card (create-rule band). Click/dismiss wiring stays
   *  on the trigger. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** aria-haspopup on the trigger. "menu" also drops the surface's own
      role=dialog (the content's role=menu names it). */
  ariaHaspopup?: QzHaspopup;
  /** Accessible name of the dialog surface. */
  ariaLabel?: string;
  /** Focus moves in on open (chosen item → search → first control), arrows
      walk menu items, Tab out closes, and focus returns to the trigger. */
  manageFocus?: boolean;
  /** Close when the anchor is scrolled out of view or clipped. */
  closeOnAnchorHidden?: boolean;
  /** Left edges aligned ("start") or right edges aligned ("end"). */
  align?: "start" | "end";
  /** Gap between anchor and popover, px. */
  offset?: number;
  /** Fixed width, px (capped to the viewport minus 16). */
  width?: number;
  /** Extra class on the .qz-popover surface. */
  className?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (controlledOpen === undefined) setUncontrolled(next);
    },
    [controlledOpen, onOpenChange],
  );

  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<"top" | "bottom" | undefined>(undefined);
  const ready = usePortalReady();

  const triggerEl = useCallback((): HTMLElement | null => {
    const a = anchorRef.current;
    if (!a) return null;
    return a.querySelector<HTMLElement>(FOCUSABLE) ?? (a.firstElementChild as HTMLElement | null);
  }, []);

  // One-at-a-time registry.
  useEffect(() => {
    if (!open) return;
    closeOpenPopover?.();
    const close = () => setOpen(false);
    closeOpenPopover = close;
    return () => {
      if (closeOpenPopover === close) closeOpenPopover = null;
    };
  }, [open, setOpen]);

  // Position — imperative, so re-anchoring on scroll/resize/content change
  // never re-renders the content.
  const place = useCallback(() => {
    const el = popRef.current;
    const anchor = measureRef?.current ?? anchorRef.current;
    if (!el || !anchor) return;
    if (closeOnAnchorHidden && anchorHidden(anchor)) {
      setOpen(false);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    el.style.width = width ? `${Math.min(width, vw - 16)}px` : "";
    el.style.maxHeight = "";
    const list = el.querySelector<HTMLElement>("[data-qz-pop-list]");
    if (list) list.style.maxHeight = "";
    const r = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const p = computePopoverPlacement({
      anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      viewport: { width: vw, height: vh },
      popHeight: box.height,
      popWidth: box.width,
      listHeight: list ? list.getBoundingClientRect().height : null,
      placement,
      align,
      offset,
      decidedSide: sideRef.current,
    });
    sideRef.current = p.side;
    el.dataset.side = p.side;
    el.style.left = `${Math.round(p.left)}px`;
    if (p.side === "bottom") {
      el.style.top = `${Math.round(p.edge)}px`;
      el.style.bottom = "";
    } else {
      el.style.top = "";
      el.style.bottom = `${Math.round(vh - p.edge)}px`;
    }
    if (p.maxHeight !== null) el.style.maxHeight = `${p.maxHeight}px`;
    if (list && p.listMaxHeight !== null) list.style.maxHeight = `${p.listMaxHeight}px`;
  }, [measureRef, closeOnAnchorHidden, setOpen, width, placement, align, offset]);

  useLayoutEffect(() => {
    if (!open) {
      sideRef.current = undefined;
      return;
    }
    if (!ready) return;
    place();
  }, [open, ready, place, content]);

  // Re-anchor on resize, scroll (capture, so inner scrollers count — but not
  // the popover's own list) and on content/anchor size change.
  useEffect(() => {
    if (!open || !ready) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && popRef.current?.contains(t)) return;
      place();
    };
    window.addEventListener("resize", place);
    document.addEventListener("scroll", onScroll, true);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => place());
      if (popRef.current) ro.observe(popRef.current);
      const anchor = measureRef?.current ?? anchorRef.current;
      if (anchor) ro.observe(anchor);
    }
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", onScroll, true);
      ro?.disconnect();
    };
  }, [open, ready, place, measureRef]);

  // manageFocus: move focus in on open; hand it back to the trigger on
  // close when it would otherwise drop to <body>.
  useEffect(() => {
    if (!open || !ready || !manageFocus) return;
    const el = popRef.current;
    if (el) pickPopoverInitialFocus(el).focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || !!el?.contains(active);
      if (!lost) return;
      triggerEl()?.focus({ preventScroll: true });
    };
  }, [open, ready, manageFocus, triggerEl]);

  // Outside-click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  // manageFocus keyboard: arrows/Home/End rove menu items; Tab out closes
  // (a menu closes on any Tab) and carries on from the trigger.
  const onPopKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!manageFocus) return;
      const el = popRef.current;
      if (!el) return;
      if (e.key === "Tab") {
        const f = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (x) => x.getClientRects().length > 0,
        );
        const i = f.indexOf(document.activeElement as HTMLElement);
        const isMenu = !!el.querySelector('[role="menu"]');
        if (isMenu || i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1)) {
          triggerEl()?.focus({ preventScroll: true });
          setOpen(false);
        }
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.matches("input, textarea") && e.key !== "ArrowDown") return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(ROVE_SELECTOR));
      const j = nextRovingIndex(active ? items.indexOf(active) : -1, items.length, e.key);
      if (j === null) return;
      e.preventDefault();
      const target = items[j]!;
      if (target.getAttribute("role") === "radio") {
        for (const x of items) if (x.getAttribute("role") === "radio") x.tabIndex = x === target ? 0 : -1;
      }
      target.focus();
    },
    [manageFocus, triggerEl, setOpen],
  );

  const isMenu = ariaHaspopup === "menu";
  return (
    <>
      {/* BLD-6 (axe critical aria-allowed-attr): aria-expanded/haspopup are
          not valid on a plain span — clone them onto the trigger ELEMENT
          (every consumer passes a real <button>); the span stays a bare
          click/measure anchor. */}
      <span ref={anchorRef} className="qz-popover-anchor" onClick={() => setOpen(!open)}>
        {isValidElement(trigger)
          ? cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
              "aria-expanded": open,
              "aria-haspopup": ariaHaspopup,
            })
          : trigger}
      </span>
      {ready && open
        ? createPortal(
            <div
              ref={popRef}
              className={`qz-popover${className ? " " + className : ""}`}
              role={isMenu ? undefined : "dialog"}
              aria-label={isMenu ? undefined : ariaLabel}
              tabIndex={manageFocus ? -1 : undefined}
              onKeyDown={manageFocus ? onPopKeyDown : undefined}
              style={{ maxWidth }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ── Menu (P2 Edit 3) ─────────────────────────────────────────────────────
   Dropdown ACTIONS menu — a thin ergonomic over QzPopover (the dropdown
   primitive already in this file): a role=menu list where each item is an
   action. Reuses Popover's positioning, one-at-a-time registry, and
   outside-click/Esc dismiss, so it stays on the single overlay contract.
   LOGIC-STEP: items with `checked` render as menuitemradio + aria-checked
   (mock menuWrap/mitem, B29); focus moves into the menu on open (the chosen
   item first) and arrows/Home/End walk it. */
export type QzMenuItem = {
  label: ReactNode;
  onSelect: () => void;
  tone?: "default" | "crit";
  disabled?: boolean;
  /** Present on ANY item → the menu is a radio group (menuitemradio). */
  checked?: boolean;
  /** Right-aligned hint text. */
  hint?: ReactNode;
};

export function QzMenu({
  trigger,
  items,
  placement = "bottom",
  ariaLabel,
  title,
  width,
  align,
  manageFocus = true,
}: {
  trigger: ReactNode;
  items: QzMenuItem[];
  placement?: "top" | "bottom";
  /** Accessible name of the role=menu list. */
  ariaLabel?: string;
  /** Optional title line above the items (mock .pt). */
  title?: ReactNode;
  width?: number;
  align?: "start" | "end";
  manageFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const radio = items.some((it) => it.checked !== undefined);
  return (
    <QzPopover
      placement={placement}
      maxWidth={width ?? 260}
      width={width}
      align={align}
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      ariaHaspopup="menu"
      manageFocus={manageFocus}
      content={
        <>
          {title ? <div className="qz-menu-title">{title}</div> : null}
          <div className="qz-menu" role="menu" aria-label={ariaLabel}>
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                role={radio ? "menuitemradio" : "menuitem"}
                aria-checked={radio ? !!it.checked : undefined}
                disabled={it.disabled}
                className={`qz-menu-item${it.tone === "crit" ? " qz-menu-item-crit" : ""}${it.checked ? " is-on" : ""}`}
                onClick={() => {
                  it.onSelect();
                  setOpen(false);
                }}
              >
                {it.label}
                {it.hint ? <span className="qz-menu-hint">{it.hint}</span> : null}
              </button>
            ))}
          </div>
        </>
      }
    />
  );
}
