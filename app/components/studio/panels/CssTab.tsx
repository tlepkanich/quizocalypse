import { QzTextarea } from "../../qz";
import type { Quiz, QuizNode } from "../../../lib/quizSchema";
import { setNodeCss } from "../studioDoc";

// ════════════════════════════════════════════════════════════════════════════
// CSS panel — per-node custom CSS (Unified P0: extracted from StudioBuilder
// verbatim).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

export function CssTab({
  doc,
  node,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuizNode;
  onCommit: (doc: QuizDoc) => void;
}) {
  const css = doc.node_css[node.id] ?? "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
        Custom CSS scoped to this step. Selectors are prefixed automatically, or write bare
        declarations to style the step container. <code>&amp;</code> targets the root; reference a
        block by its <code>class</code>.
      </p>
      <QzTextarea
        value={css}
        onChange={(e) => onCommit(setNodeCss(doc, node.id, e.target.value))}
        rows={8}
        placeholder={"&:hover { box-shadow: 0 8px 30px rgba(0,0,0,.12); }\n.qz-block { letter-spacing: .2px; }"}
        style={{ fontFamily: "monospace", fontSize: 12 }}
      />
    </div>
  );
}
