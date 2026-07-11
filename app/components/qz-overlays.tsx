import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
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
   ===================================================================== */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Trap Tab focus inside `ref` while `active`; restore focus to the previously
    focused element on cleanup. Initial focus goes to `initialRef` when given
    (modals: the least-destructive action), else the first focusable. */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  initialRef?: React.RefObject<HTMLElement | null>,
) {
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
      previous?.focus?.();
    };
  }, [active, ref, initialRef]);
}

/** SSR-safe portal mount (nothing renders on the server). */
function usePortalReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

/* ── Modal ──────────────────────────────────────────────────────────────
   Destructive-and-final confirms + critical decisions that must block the
   page. Sizes 440 (confirm) / 640 (content) / 880 (editor); centered;
   scrim + 2px blur; 18px radius; lift-3; fade+scale .97→1.
   Dismissal: Esc + scrim-click ONLY when non-destructive; destructive
   confirms require an explicit button press. ✕ only on content/editor
   modals, never on confirms. Focus trapped; initial focus = the least-
   destructive action (pass `initialFocusRef`, e.g. the Cancel button). */
export function QzModal({
  open,
  onClose,
  size = "sm",
  title,
  icon,
  footer,
  destructive = false,
  initialFocusRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** sm = 440 confirm · md = 640 content · lg = 880 editor */
  size?: "sm" | "md" | "lg";
  title?: ReactNode;
  /** Optional 44px role-colored icon tile above the title. */
  icon?: ReactNode;
  footer?: ReactNode;
  destructive?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  const ready = usePortalReady();
  const boxRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  useFocusTrap(boxRef, open);

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
  return createPortal(
    <div
      className="qz-modal-scrim"
      onMouseDown={destructive ? undefined : (e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={boxRef}
        className={`qz-modal qz-modal--${size}`}
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

/* ── Popover ────────────────────────────────────────────────────────────
   Contextual info (ⓘ explainers, health checks), small pickers. Anchored
   to its trigger with an 8px offset, flips at viewport edges, no backdrop
   (page stays interactive), 14px radius, lift-3, 140ms fade+rise.
   ONE popover at a time — opening another closes the first (a module-level
   registry enforces it). Dismiss: outside-click, Esc, re-click trigger. */
let closeOpenPopover: (() => void) | null = null;

export function QzPopover({
  trigger,
  content,
  placement = "bottom",
  maxWidth = 340,
  open: controlledOpen,
  onOpenChange,
}: {
  /** The trigger element; the popover wires click + aria onto a wrapper. */
  trigger: ReactNode;
  content: ReactNode;
  placement?: "top" | "bottom";
  maxWidth?: number;
  /** Optional controlled mode (e.g. the health pill opened by Continue). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  const ready = usePortalReady();
  const [pos, setPos] = useState<{ top: number; left: number; side: "top" | "bottom" } | null>(null);

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

  // Position: anchored 8px off the trigger, flip at viewport edges.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const estH = Math.min(popRef.current?.offsetHeight ?? 240, window.innerHeight * 0.6);
    let side: "top" | "bottom" = placement;
    if (side === "bottom" && r.bottom + 8 + estH > window.innerHeight && r.top - 8 - estH > 0) side = "top";
    if (side === "top" && r.top - 8 - estH < 0) side = "bottom";
    const left = Math.max(8, Math.min(r.left, window.innerWidth - maxWidth - 8));
    setPos({ top: side === "bottom" ? r.bottom + 8 : r.top - 8, left, side });
  }, [open, placement, maxWidth]);

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
              "aria-haspopup": "dialog",
            })
          : trigger}
      </span>
      {ready && open && pos
        ? createPortal(
            <div
              ref={popRef}
              className={`qz-popover is-${pos.side}`}
              role="dialog"
              style={{
                top: pos.side === "bottom" ? pos.top : undefined,
                bottom: pos.side === "top" ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                maxWidth,
              }}
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
   outside-click/Esc dismiss, so it stays on the single overlay contract. */
export function QzMenu({
  trigger,
  items,
  placement = "bottom",
}: {
  trigger: ReactNode;
  items: Array<{
    label: ReactNode;
    onSelect: () => void;
    tone?: "default" | "crit";
    disabled?: boolean;
  }>;
  placement?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  return (
    <QzPopover
      placement={placement}
      maxWidth={260}
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      content={
        <div className="qz-menu" role="menu">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={`qz-menu-item${it.tone === "crit" ? " qz-menu-item-crit" : ""}`}
              onClick={() => {
                it.onSelect();
                setOpen(false);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      }
    />
  );
}
