import { useCallback, useLayoutEffect, useRef } from "react";
import type {
  ClipboardEvent,
  CompositionEvent,
  FocusEvent,
  FormEvent,
  KeyboardEvent,
} from "react";

/* quiz-step3 v3 §4.3 — the caret-safe contenteditable primitive (QL3-P2).
   UNCONTROLLED-WHILE-FOCUSED: a layout effect writes el.textContent = value
   ONLY when the element is NOT focused (and the content differs), so the
   caret can never jump by construction — while the merchant types, React
   re-renders (every input event commits through the doc) but never touches
   the DOM text. Commit cadence: onInput → onCommit on EVERY input event
   (instant local echo; the existing 700ms useQuizDraft debounce is the ONLY
   debounce — no second one here). IME composition defers commits to
   compositionend. contentEditable="plaintext-only" plus a paste sanitizer
   (plain-text insertText) and a beforeinput formatting-strip fallback keep
   the content plain text everywhere. Enter blurs (single-line semantics);
   blur does a final trim-commit; maxLength is enforced by truncation on
   commit (the not-focused rewrite snaps the DOM back after blur). */

export function useContentEditable({
  value,
  onCommit,
  maxLength,
  singleLine = true,
}: {
  value: string;
  onCommit: (text: string) => void;
  maxLength?: number;
  singleLine?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  // Last known value (prop or our own commit) — skips no-op commits so a
  // plain focus/blur pass never dirties the autosave.
  const valueRef = useRef(value);
  valueRef.current = value;

  // The invariant: never rewrite the DOM under a focused caret.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof document !== "undefined" && document.activeElement === el) return;
    if ((el.textContent ?? "") !== value) el.textContent = value;
  }, [value]);

  const commitFrom = useCallback(
    (el: HTMLElement, { trim = false }: { trim?: boolean } = {}) => {
      let text = el.textContent ?? "";
      if (singleLine) text = text.replace(/[\r\n]+/g, " ");
      if (trim) text = text.trim();
      if (maxLength !== undefined && text.length > maxLength) text = text.slice(0, maxLength);
      if (text === valueRef.current) return;
      valueRef.current = text;
      onCommit(text);
    },
    [singleLine, maxLength, onCommit],
  );

  const onInput = useCallback(
    (e: FormEvent<HTMLElement>) => {
      if (composing.current) return; // deferred to compositionend
      commitFrom(e.currentTarget);
    },
    [commitFrom],
  );

  const onCompositionStart = useCallback((_e: CompositionEvent<HTMLElement>) => {
    composing.current = true;
  }, []);

  const onCompositionEnd = useCallback(
    (e: CompositionEvent<HTMLElement>) => {
      composing.current = false;
      commitFrom(e.currentTarget);
    },
    [commitFrom],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (singleLine && e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
    [singleLine],
  );

  const onBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      commitFrom(e.currentTarget, { trim: true });
    },
    [commitFrom],
  );

  // Paste sanitizer — insert the clipboard's PLAIN text (newlines collapsed
  // for single-line fields); never let styled HTML into the editable.
  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLElement>) => {
      e.preventDefault();
      let text = e.clipboardData.getData("text/plain");
      if (singleLine) text = text.replace(/[\r\n]+/g, " ");
      document.execCommand("insertText", false, text);
    },
    [singleLine],
  );

  // Fallback for engines without contenteditable="plaintext-only": strip
  // formatting commands and (single-line) line breaks at the beforeinput gate.
  const onBeforeInput = useCallback(
    (e: FormEvent<HTMLElement>) => {
      const inputType = (e.nativeEvent as InputEvent).inputType ?? "";
      if (
        inputType.startsWith("format") ||
        (singleLine && (inputType === "insertParagraph" || inputType === "insertLineBreak"))
      ) {
        e.preventDefault();
      }
    },
    [singleLine],
  );

  return {
    ref,
    editableProps: {
      contentEditable: "plaintext-only" as const,
      onInput,
      onBeforeInput,
      onKeyDown,
      onBlur,
      onPaste,
      onCompositionStart,
      onCompositionEnd,
    },
  };
}
