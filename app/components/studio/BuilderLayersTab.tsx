import { useMemo, useState } from "react";
import type { Quiz, QuizNode, ContentBlock } from "../../lib/quizSchema";
import {
  PALETTE_BLOCKS,
  blockMove,
  blockRemove,
  blockReorder,
  blockUpdate,
  setNodeLayout,
} from "./studioDoc";
import { currentLayout } from "./BuilderBlocksPalette";

// ════════════════════════════════════════════════════════════════════════════
// BuilderLayersTab (QZY-7, build-tab spec §2) — the current screen's block
// list: click to select (scrolls the inspector's Layout-blocks editor to it
// via the same selection), ↑/↓ reorder (the SAME blockMove the inspector
// uses — spec acceptance: identical results), 👁 hide/show (the QZY-7
// `hidden` flag — kept in the layout, never rendered), ✕ delete. Editing a
// row's fields stays the inspector's job; this tab is structure.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

const GLYPH = new Map(PALETTE_BLOCKS.map((b) => [b.type, b.glyph]));
const LABEL = new Map(PALETTE_BLOCKS.map((b) => [b.type, b.label]));

function rowLabel(block: ContentBlock): string {
  const base = LABEL.get(block.type) ?? block.type;
  const text =
    block.type === "heading" || block.type === "text"
      ? block.text
      : block.type === "button"
        ? block.label
        : "";
  return text?.trim() ? `${base} · ${text.trim().slice(0, 28)}` : base;
}

export function BuilderLayersTab({
  doc,
  node,
  commit,
  onSelectNode,
}: {
  doc: QuizDoc;
  /** The screen whose blocks are listed (the canvas's current step). */
  node: QuizNode | null;
  commit: (doc: QuizDoc) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const blocks = useMemo(
    () => (node ? currentLayout(doc, node) : []),
    [doc, node],
  );
  // BT4 — drag-to-reorder. `dragId` = the row being dragged; `overIndex` = the
  // row it is hovering, for a drop-line indicator. Cleared on drop/leave.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  if (!node) {
    return (
      <div className="qz-card" style={{ padding: 14 }}>
        <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
          Select a screen in the carousel below to see its blocks.
        </p>
      </div>
    );
  }
  const apply = (next: ContentBlock[]) => commit(setNodeLayout(doc, node.id, next));

  return (
    <div className="qz-layers">
      <div className="qz-label" style={{ fontSize: 11, marginBottom: 6 }}>
        Layers — {blocks.length} block{blocks.length === 1 ? "" : "s"}
      </div>
      {blocks.map((b, i) => (
        <div
          key={b.id}
          className={`qz-layers-row${b.hidden ? " is-hidden" : ""}${
            dragId === b.id ? " is-dragging" : ""
          }${overIndex === i && dragId && dragId !== b.id ? " is-drop-target" : ""}`}
          draggable
          onDragStart={(e) => {
            setDragId(b.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overIndex !== i) setOverIndex(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== b.id) apply(blockReorder(blocks, dragId, i));
            setDragId(null);
            setOverIndex(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverIndex(null);
          }}
        >
          <span
            className="qz-layers-grip"
            aria-hidden
            title="Drag to reorder"
            style={{ cursor: "grab", userSelect: "none", opacity: 0.45, paddingRight: 2 }}
          >
            ⠿
          </span>
          <button
            type="button"
            className="qz-layers-main"
            title="Open this screen's blocks in the inspector"
            onClick={() => onSelectNode(node.id)}
          >
            <span className="qz-block-glyph" aria-hidden>
              {GLYPH.get(b.type) ?? "▢"}
            </span>
            <span className="qz-layers-name">{rowLabel(b)}</span>
          </button>
          <div className="qz-layers-actions">
            <button
              type="button"
              aria-label={b.hidden ? "Show block" : "Hide block"}
              title={b.hidden ? "Show" : "Hide"}
              onClick={() => apply(blockUpdate(blocks, b.id, { hidden: b.hidden ? undefined : true }))}
            >
              {b.hidden ? "🚫" : "👁"}
            </button>
            <button
              type="button"
              aria-label="Move block up"
              disabled={i === 0}
              onClick={() => apply(blockMove(blocks, b.id, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move block down"
              disabled={i === blocks.length - 1}
              onClick={() => apply(blockMove(blocks, b.id, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Delete block"
              onClick={() => apply(blockRemove(blocks, b.id))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {blocks.length === 0 ? (
        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          Empty screen — add blocks from the Add tab.
        </p>
      ) : null}
    </div>
  );
}
