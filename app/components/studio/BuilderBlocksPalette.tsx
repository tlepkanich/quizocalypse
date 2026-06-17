import type { ContentBlockType, Quiz, QuizNode } from "../../lib/quizSchema";
import { PALETTE_BLOCKS, makeBlock, setNodeLayout } from "./studioDoc";
import { synthesizeLayout } from "../../lib/synthesizeLayout";

// QB-4b — the Editor tool's "Blocks" sub-tab: Quizell's categorized element
// palette (Media / Content / Actions) over our real content blocks. Clicking a
// block appends it to the selected step's layout (synthesizeLayout gives the
// step's current blocks; makeBlock builds the new one) — undoable via the top
// bar. The "Settings" sub-tab keeps the step list + node editor.

type QuizDoc = Quiz;

const CATEGORIES: { name: string; types: ContentBlockType[] }[] = [
  { name: "Media", types: ["image"] },
  {
    name: "Content",
    types: ["heading", "text", "divider", "spacer", "answers", "recommendations", "email_input", "ai_chat", "product_grid"],
  },
  { name: "Actions", types: ["button"] },
];

export function BuilderBlocksPalette({
  doc,
  node,
  commit,
}: {
  doc: QuizDoc;
  node: QuizNode | null;
  commit: (doc: QuizDoc) => void;
}) {
  const byType = new Map(PALETTE_BLOCKS.map((p) => [p.type, p]));
  const insert = (type: ContentBlockType) => {
    if (!node) return;
    commit(setNodeLayout(doc, node.id, [...synthesizeLayout(node), makeBlock(type)]));
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <input className="qz-input" placeholder="Search elements" aria-label="Search elements" disabled />
      {!node ? (
        <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
          Select a step below (or click an element in the canvas) to add blocks to it.
        </p>
      ) : null}
      {CATEGORIES.map((cat) => (
        <div key={cat.name}>
          <div className="qz-label" style={{ marginBottom: 7, fontSize: 11 }}>
            {cat.name}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {cat.types.map((t) => {
              const p = byType.get(t);
              if (!p) return null;
              return (
                <button
                  key={t}
                  type="button"
                  className="qz-block-tile"
                  disabled={!node}
                  onClick={() => insert(t)}
                  title={node ? `Add ${p.label} to this step` : "Select a step first"}
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
      ))}
    </div>
  );
}
