import { QzButton, QzCard } from "../../qz";
import { SHARED_RESULT_KEY } from "../../../lib/resultLayout";
import { StepPreview } from "../../runtime/StepPreview";
import { RecPageDiagram } from "../../studio/RecPageDiagram";
import { ResultSettingsPanel } from "../ResultSettingsPanel";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { BuilderCategory, BuilderCollection } from "../stepProps";

// Step 3 detail pane — the editor for one selected result page: a header
// (headline + on-template/customized status + Snap-to-template / Open-in-builder
// actions), the collapsible ResultSettingsPanel, and a co-located framed live
// preview. Lives next to the page rail in Step3Results' master-detail layout.

type ResultNode = Extract<QuizDoc["nodes"][number], { type: "result" }>;

// A result page is "customized" when it has a per-node layout or a per-node
// design override (in shared mode the __shared_result__ key doesn't count, as
// it's the template every page inherits). Shared by the rail + the editor.
export function isResultCustomized(doc: QuizDoc, nodeId: string): boolean {
  const shared = doc.result_layout_mode === "shared";
  return Boolean(
    doc.node_layouts[nodeId]?.length ||
      (shared
        ? doc.design_overrides[nodeId] && nodeId !== SHARED_RESULT_KEY
        : doc.design_overrides[nodeId]),
  );
}

export function ResultPageEditor({
  doc,
  node,
  onCommit,
  productIndex,
  categories,
  collections,
  goToStep,
}: {
  doc: QuizDoc;
  node: ResultNode;
  onCommit: (doc: QuizDoc) => void;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  goToStep: (n: number) => void;
}) {
  const customized = isResultCustomized(doc, node.id);

  const snapToTemplate = () => {
    const { [node.id]: _drop, ...rest } = doc.design_overrides;
    const layouts = { ...doc.node_layouts };
    delete layouts[node.id];
    onCommit({ ...doc, design_overrides: rest, node_layouts: layouts });
  };

  return (
    <div className="qz-col qz-gap-16" style={{ minWidth: 0 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{node.data.headline}</div>
          <div className="qz-dim" style={{ fontSize: 12 }}>
            {customized ? "Customized layout" : "On template"}
          </div>
        </div>
        <div className="qz-row qz-gap-8">
          {customized ? (
            <QzButton size="sm" variant="ghost" onClick={snapToTemplate}>
              Snap to template
            </QzButton>
          ) : null}
          <QzButton size="sm" variant="ghost" onClick={() => goToStep(2)}>
            Open in builder →
          </QzButton>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 340px)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <QzCard style={{ padding: 14 }}>
          <ResultSettingsPanel
            doc={doc}
            node={node}
            categories={categories}
            collections={collections}
            productIndex={productIndex}
            onCommit={onCommit}
          />
        </QzCard>

        <div className="qz-col qz-gap-12" style={{ minWidth: 0 }}>
          <RecPageDiagram doc={doc} node={node} productIndex={productIndex} categories={categories} />
          <FramedPreview doc={doc} node={node} productIndex={productIndex} categories={categories} />
        </div>
      </div>
    </div>
  );
}

// A small browser-chrome frame around the live result preview, echoing Step 4's
// DeviceFrame aesthetic. Sticky within the detail column so it stays in view as
// the settings scroll (co-located, not viewport-detached).
function FramedPreview({
  doc,
  node,
  productIndex,
  categories,
}: {
  doc: QuizDoc;
  node: ResultNode;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
}) {
  return (
    <div className="qz-card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="qz-row"
        style={{
          gap: 6,
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--qz-rule)",
          background: "var(--qz-cream-2)",
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span
            key={c}
            aria-hidden
            style={{ width: 9, height: 9, borderRadius: "50%", background: c, opacity: 0.7 }}
          />
        ))}
        <span className="qz-label" style={{ marginLeft: 6 }}>
          Live preview
        </span>
      </div>
      <div style={{ padding: 16, background: "#FAFAFA", maxHeight: "min(70vh, 640px)", overflow: "auto" }}>
        <StepPreview doc={doc} node={node} productIndex={productIndex} categories={categories} />
      </div>
    </div>
  );
}
