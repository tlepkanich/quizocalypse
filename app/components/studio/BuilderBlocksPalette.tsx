import { useState } from "react";
import type { ContentBlockType, Quiz, QuizNode } from "../../lib/quizSchema";
import { PALETTE_BLOCKS, makeBlock, setNodeLayout } from "./studioDoc";
import { synthesizeLayout } from "../../lib/synthesizeLayout";

// QB-4b / BLD-7 — the Editor tool's "Blocks" sub-tab. Click OR drag a tile
// onto the canvas to append the block to the target step (the selected step,
// else the one the canvas is showing) — undoable via the top bar. Inserting
// preserves an existing explicit layout (the pre-BLD-7 insert re-synthesized
// from the fixed template every time, silently discarding earlier custom
// blocks). Smart tiles only appear for the node type whose interactive
// region the runtime can render (answers→question, recommendations→result,
// email field→email gate); ai_chat/product_grid stay off the palette until
// their regions are extracted — offering them wrote invisible layouts.

type QuizDoc = Quiz;

// Smart block → the only node type it renders on (mirror of the runtime's
// RUNTIME_SMART_BLOCK_HOSTS).
const SMART_HOST: Record<string, QuizNode["type"]> = {
  answers: "question",
  recommendations: "result",
  email_input: "email_gate",
};
const UNSUPPORTED: ReadonlySet<string> = new Set(["ai_chat", "product_grid"]);

const CATEGORIES: { name: string; types: ContentBlockType[] }[] = [
  // QZY-10 §7 — the v1 inventory: video/logo join Media; the rich-text
  // content block + progress bar join Content.
  { name: "Media", types: ["image", "video", "logo"] },
  {
    name: "Content",
    types: [
      "heading",
      "text",
      "content",
      "divider",
      "spacer",
      "progress",
      "answers",
      "recommendations",
      "email_input",
    ],
  },
  { name: "Actions", types: ["button"] },
];

/** The block stack an insert appends to: the node's explicit layout when one
 *  exists, else its fixed template synthesized (first customization). */
export function currentLayout(doc: QuizDoc, node: QuizNode) {
  return doc.node_layouts[node.id] ?? synthesizeLayout(node);
}

/** Append `type` to `node`'s layout (shared by tile click + canvas drop). */
export function insertBlock(doc: QuizDoc, node: QuizNode, type: ContentBlockType): QuizDoc {
  return setNodeLayout(doc, node.id, [...currentLayout(doc, node), makeBlock(type)]);
}

export const BLOCK_DRAG_MIME = "application/x-qz-block";

// QZY-7 (build-tab §3) — the palette's QUESTION tiles are not free blocks:
// on a question screen they SWITCH the question's input type; elsewhere they
// create a NEW question screen. A second question can never join a screen.
const QUESTION_TILES: { kind: "single_select" | "slider"; label: string; glyph: string }[] = [
  { kind: "single_select", label: "Choice answers", glyph: "☑" },
  { kind: "slider", label: "Slider / scale", glyph: "⟷" },
];

export function BuilderBlocksPalette({
  doc,
  node,
  commit,
  onQuestionTile,
}: {
  doc: QuizDoc;
  /** The insert target: the selected step, else the step the canvas shows. */
  node: QuizNode | null;
  commit: (doc: QuizDoc) => void;
  /** QZY-7 — switch-or-create for the question tiles (host-implemented). */
  onQuestionTile?: (kind: "single_select" | "slider") => void;
}) {
  const byType = new Map(PALETTE_BLOCKS.map((p) => [p.type, p]));
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const insert = (type: ContentBlockType) => {
    if (!node) return;
    commit(insertBlock(doc, node, type));
  };
  const allowed = (t: ContentBlockType) => {
    if (UNSUPPORTED.has(t)) return false;
    const host = SMART_HOST[t];
    return !host || node?.type === host;
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <input
        className="qz-input"
        placeholder="Search elements"
        aria-label="Search elements"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!node ? (
        <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
          Select a step below (or click an element in the canvas) to add blocks to it.
        </p>
      ) : null}
      {onQuestionTile ? (
        <div>
          <div className="qz-label" style={{ marginBottom: 7, fontSize: 11 }}>
            Questions
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {QUESTION_TILES.filter(
              (q) => !needle || q.label.toLowerCase().includes(needle),
            ).map((q) => (
              <button
                key={q.kind}
                type="button"
                className="qz-block-tile"
                onClick={() => onQuestionTile(q.kind)}
                title={
                  node?.type === "question"
                    ? `Switch this question to ${q.label.toLowerCase()}`
                    : `Add a new ${q.label.toLowerCase()} question screen`
                }
              >
                <span className="qz-block-glyph" aria-hidden="true">
                  {q.glyph}
                </span>
                <span>{q.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {CATEGORIES.map((cat) => {
        const tiles = cat.types.filter(
          (t) =>
            allowed(t) &&
            byType.has(t) &&
            (!needle || byType.get(t)!.label.toLowerCase().includes(needle)),
        );
        if (tiles.length === 0) return null;
        return (
          <div key={cat.name}>
            <div className="qz-label" style={{ marginBottom: 7, fontSize: 11 }}>
              {cat.name}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {tiles.map((t) => {
                const p = byType.get(t)!;
                return (
                  <button
                    key={t}
                    type="button"
                    className="qz-block-tile"
                    disabled={!node}
                    draggable={!!node}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(BLOCK_DRAG_MIME, t);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => insert(t)}
                    title={
                      node
                        ? `Add ${p.label} to this step — click, or drag onto the canvas`
                        : "Select a step first"
                    }
                  >
                    <span className="qz-block-glyph" aria-hidden="true">
                      {p.glyph}
                    </span>
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
