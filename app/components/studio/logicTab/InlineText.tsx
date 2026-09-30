import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { SaveToken } from "../saveTracker";
import { FieldSavePill } from "./FieldSavePill";

/* Handoff §11 — the Logic step's inline text editor (mock `.ed` semantics),
   host-agnostic (D6): props only, no funnel imports, no ruleFlow gate.

   • Renders a span showing `value`; contenteditable (plaintext-only) when
     the host passes `onCommit`, plain text otherwise (read-only previews).
   • Never rewrites the text under a focused caret: the value is written
     into the element only while it is not focused.
   • Typing is local; `onDraftChange(text)` reports every input (after IME
     composition ends) so hosts can keep rule sentences / rail labels in step
     (mock syncText), or write each keystroke through their mutation.
   • Length cap held while typing (an insert that would pass the cap is
     refused, selected text counting as free room), on paste/drop (insert
     only what fits) and on commit (clamp — the IME backstop, B59).
   • Paste and drop insert plain text with every whitespace run collapsed.
   • Enter commits; it never inserts a line break. Esc writes the snapshot
     back, reports it through onDraftChange, and ends the edit with no pill
     — consumed in the capture phase on window so it never closes a dialog,
     popover or disarms anything. While an IME is composing, Enter and Esc
     belong to the IME. After Enter/Esc focus moves to the next control
     (never <body>) unless the host passes `onExit`.
   • End of the edit (Enter, Tab, click away): whitespace runs collapsed,
     trimmed, clamped. Empty → the snapshot comes back (unless `allowEmpty`,
     for scale points, whose host stores the point number and shows a
     `placeholder`). The final text is written back into the field; if it
     differs from the snapshot, `onCommit(final)` runs and, when it returns
     a SaveToken, the field save pill shows (D8). After the edit the field
     re-syncs to the STORED value, so text a mutation refused never stays
     on screen as if it had been saved.
   • textContent only — never innerHTML (B21). */

/** Collapse whitespace runs (line breaks, tabs, NBSP) to one space, trim,
    clamp to `max` without splitting a surrogate pair, trim again. */
export function normalizeInlineText(raw: string, max: number): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (t.length > max) {
    t = t.slice(0, max);
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  }
  return t.trim();
}

/** Room left for an insert: cap − length + selected length inside the field. */
function roomIn(el: HTMLElement, max: number): number {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  const len = (el.textContent ?? "").length;
  let selected = 0;
  if (sel && sel.rangeCount > 0 && sel.anchorNode && el.contains(sel.anchorNode)) {
    selected = sel.toString().length;
  }
  return max - len + selected;
}

/** Insert plain text at the caret: execCommand keeps the browser's own text
    undo; the Range path is the fallback where it is unavailable. */
function insertPlain(el: HTMLElement, text: string) {
  if (!text) return;
  const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (ok) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    el.textContent = (el.textContent ?? "") + text;
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';

/** The control Tab would reach after `el` (handoff: focus never drops to
    <body> after Enter/Esc). */
function nextTabbable(el: HTMLElement): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (x) => x === el || (x.tabIndex >= 0 && x.getClientRects().length > 0 && !x.closest("[inert]")),
  );
  const i = all.indexOf(el);
  return i >= 0 ? (all[i + 1] ?? null) : null;
}

export type InlineTextProps = {
  /** The stored text. Never written into the element while it is focused. */
  value: string;
  /** 150 for a question, 60 for an answer. */
  maxLength: number;
  /** Once, at the end of an edit whose text changed. Return the SaveToken of
      the commit to show the field save pill. Absent = read-only text. */
  onCommit?: (next: string) => SaveToken | void;
  /** Every input (plain, capped); Esc reports the restored snapshot. */
  onDraftChange?: (text: string) => void;
  /** Scale points: an emptied field commits "" (the host stores the number). */
  allowEmpty?: boolean;
  /** Shown while the field is empty (with allowEmpty), e.g. "Add label". */
  placeholder?: string;
  className?: string;
  /** Label by position from the shared copy, e.g. "Question 3 text". */
  ariaLabel: string;
  /** Inline inside a title or answer cell (mock `.paneh h3 .ed`). */
  inline?: boolean;
  /** The text's own column, for the pill (defaults to the parent element). */
  columnRef?: RefObject<HTMLElement | null>;
  /** Replaces the default "focus the next control" after Enter / Esc. */
  onExit?: (how: "enter" | "escape") => void;
};

export function InlineText({
  value,
  maxLength,
  onCommit,
  onDraftChange,
  allowEmpty = false,
  placeholder,
  className,
  ariaLabel,
  inline = false,
  columnRef,
  onExit,
}: InlineTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const snapshot = useRef(value);
  const composing = useRef(false);
  const cancelled = useRef(false);
  const [token, setToken] = useState<SaveToken | null>(null);
  const props = useRef({ maxLength, onCommit, onDraftChange, allowEmpty, onExit });
  props.current = { maxLength, onCommit, onDraftChange, allowEmpty, onExit };
  const editable = !!onCommit;
  // Bumped at the end of an edit: the effect below then writes the stored
  // value back even when it did not change (a refused commit).
  const [resync, bumpResync] = useReducer((n: number) => n + 1, 0);

  // The invariant: never rewrite the DOM under a focused caret.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !editable) return;
    if (document.activeElement === el) return;
    if ((el.textContent ?? "") !== value) el.textContent = value;
  }, [value, editable, resync]);

  const report = useCallback((el: HTMLElement) => {
    const text = el.textContent ?? "";
    // A browser can leave a lone <br> in an emptied editable; clear it so
    // :empty (and the placeholder) match.
    if (text === "" && el.childNodes.length > 0) el.replaceChildren();
    props.current.onDraftChange?.(text.slice(0, props.current.maxLength));
  }, []);

  const exit = useCallback((el: HTMLElement, how: "enter" | "escape") => {
    const custom = props.current.onExit;
    if (custom) {
      el.blur();
      custom(how);
      return;
    }
    const next = nextTabbable(el);
    if (next) next.focus();
    else el.blur();
  }, []);

  // Native listeners: beforeinput (cap + no line breaks), paste, drop, and
  // the window-capture Enter/Esc that exists only while focused.
  useEffect(() => {
    const el = ref.current;
    if (!el || !editable) return;
    const onBeforeInput = (e: InputEvent) => {
      const t = e.inputType ?? "";
      if (t.startsWith("format") || t === "insertParagraph" || t === "insertLineBreak") {
        e.preventDefault();
        return;
      }
      if (!t.startsWith("insert") || composing.current) return;
      const data = e.data ?? "";
      if (data.length > roomIn(el, props.current.maxLength)) e.preventDefault();
    };
    const insertFrom = (raw: string) => {
      const text = raw.replace(/\s+/g, " ");
      insertPlain(el, text.slice(0, Math.max(0, roomIn(el, props.current.maxLength))));
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      insertFrom(e.clipboardData?.getData("text/plain") ?? "");
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      el.focus();
      insertFrom(e.dataTransfer?.getData("text/plain") ?? "");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== el) return;
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.stopPropagation();
      if (e.isComposing || composing.current) return; // the IME's key
      e.preventDefault();
      if (e.key === "Enter") {
        exit(el, "enter");
        return;
      }
      cancelled.current = true;
      el.textContent = snapshot.current;
      props.current.onDraftChange?.(snapshot.current);
      exit(el, "escape");
    };
    const onFocus = () => window.addEventListener("keydown", onKey, true);
    const onBlur = () => window.removeEventListener("keydown", onKey, true);
    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("paste", onPaste);
    el.addEventListener("drop", onDrop);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    if (document.activeElement === el) onFocus();
    return () => {
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [editable, exit]);

  const handleFocus = () => {
    const el = ref.current;
    if (!el) return;
    snapshot.current = el.textContent ?? "";
    cancelled.current = false;
    setToken(null); // focusing the field again dismisses its pill
  };

  const handleInput = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    report(el);
  };

  const handleBlur = () => {
    const el = ref.current;
    if (!el) return;
    composing.current = false;
    const orig = snapshot.current;
    if (cancelled.current) {
      cancelled.current = false;
      if ((el.textContent ?? "") !== orig) el.textContent = orig;
      return;
    }
    const { maxLength: max, allowEmpty: empties, onCommit: commit, onDraftChange } = props.current;
    const raw = el.textContent ?? "";
    let final = normalizeInlineText(raw, max);
    if (!final && !empties) final = orig;
    if (raw !== final) {
      el.textContent = final;
      onDraftChange?.(final);
    }
    if (final === normalizeInlineText(orig, max)) return;
    const saved = commit?.(final);
    if (saved) setToken(saved);
    bumpResync();
  };

  if (!editable) {
    return (
      <span className={className}>
        {value}
      </span>
    );
  }

  return (
    <>
      <span
        ref={ref}
        className={`qz-ed${inline ? " qz-ed--inline" : ""}${className ? " " + className : ""}`}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="false"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        data-ph={placeholder}
        tabIndex={0}
        spellCheck
        onFocus={handleFocus}
        onBlur={handleBlur}
        onInput={handleInput}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (ref.current) report(ref.current);
        }}
      />
      <FieldSavePill fieldRef={ref} columnRef={columnRef} token={token} onDone={() => setToken(null)} />
    </>
  );
}
