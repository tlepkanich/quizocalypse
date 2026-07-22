import { useEffect, useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import type { BuilderCollection, BuilderCategory } from "../builder/stepProps";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { FunnelCounts } from "../../lib/abAnalytics";

// ════════════════════════════════════════════════════════════════════════════
// studioShared (Unified P8) — the pieces that outlived the AI/Advanced split:
// the editor-loader data slice, the click-to-rename title, and the placement
// vocabulary. Everything else from the old shells was retired with the flip.
// ════════════════════════════════════════════════════════════════════════════

// The slice of the editor loader's return that the workspace consumes. Both
// routes' loaders return a superset of this, so their data is assignable here.
export interface StudioBuilderData {
  quizId: string;
  name: string;
  version: number;
  valid: boolean;
  doc: Quiz | null;
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  brandVoiceName: string | null;
  previewUrl: string;
  // PNG data URL of a QR code for previewUrl (Phase E shareable surface).
  qrCode?: string | null;
  abAnalytics: Record<string, Record<string, FunnelCounts>>;
}

type Placement = NonNullable<Quiz["placement"]>;
export const PLACEMENTS: Array<{ value: Placement; label: string; hint: string }> = [
  // build-tab handoff §7 — ONE placement vocabulary everywhere: Settings and
  // the desktop stage-bar "Show as" mirror these labels.
  { value: "page", label: "Full page", hint: "share the link above, or add the App Block to any page." },
  { value: "popup", label: "Pop-up", hint: "add the Quizocalypse App Block and set it to open as a modal." },
  { value: "inline", label: "Inline", hint: "drop the App Block into a page section to embed it in-flow." },
  { value: "product_widget", label: "Product page widget", hint: "add the App Block to your product template as a compact launcher." },
];

// ── BLD-2 — inline canvas text editing (the DOM half) ────────────────────────
// Turns an already-rendered canvas element contenteditable in place: focus +
// select-all, Enter/blur commits the trimmed text, Escape cancels. Purely
// imperative on the LIVE DOM node — React never renders contenteditable, so
// the shopper runtime is untouched; on cancel the original text is restored
// so React's vdom stays truthful, and on commit the host writes the same text
// through the normal doc-commit seam (undo + autosave included).
export function startInlineTextEdit(
  el: HTMLElement,
  onCommit: (text: string) => void,
): void {
  if (el.isContentEditable) return; // already editing
  const prevText = el.textContent ?? "";
  el.contentEditable = "plaintext-only";
  // Safari < 17 doesn't know plaintext-only; plain true is fine for our
  // single-field commits (we read textContent, so pasted markup flattens).
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
  el.classList.add("qz-inline-editing");
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    el.removeEventListener("blur", onBlur);
    el.removeEventListener("keydown", onKey);
    el.removeAttribute("contenteditable");
    el.classList.remove("qz-inline-editing");
    const text = (el.textContent ?? "").trim();
    if (!commit || !text || text === prevText.trim()) {
      el.textContent = prevText;
      return;
    }
    onCommit(text);
  };
  const onBlur = () => finish(true);
  const onKey = (e: KeyboardEvent) => {
    // Keep the workspace's global shortcuts (Esc clears selection, Delete
    // arms a step delete) out of the edit session.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
      el.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
      el.blur();
    }
  };
  el.addEventListener("blur", onBlur);
  el.addEventListener("keydown", onKey);
}

export function EditableTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => {
    setValue(name);
  }, [name]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="Click to rename"
        style={{ cursor: "text" }}
      >
        {value || "Untitled quiz"}
      </span>
    );
  }
  const save = () => {
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setValue(name);
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setValue(name);
          setEditing(false);
        }
      }}
      style={{
        font: "inherit",
        color: "inherit",
        background: "transparent",
        border: "none",
        borderBottom: "2px solid var(--qz-ink, #222)",
        outline: "none",
        width: "100%",
        maxWidth: 520,
      }}
    />
  );
}
