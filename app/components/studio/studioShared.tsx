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
  { value: "page", label: "Dedicated page", hint: "share the link above, or add the App Block to any page." },
  { value: "popup", label: "Popup", hint: "add the Quizocalypse App Block and set it to open as a modal." },
  { value: "inline", label: "Inline embed", hint: "drop the App Block into a page section to embed it in-flow." },
  { value: "product_widget", label: "Product page widget", hint: "add the App Block to your product template as a compact launcher." },
];

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
