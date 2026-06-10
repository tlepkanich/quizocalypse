import { useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { DesignLayerMode } from "../../lib/designLayers";
import { StepPreview } from "../runtime/StepPreview";
import { ContentTab } from "./panels/ContentTab";
import { LayoutTab } from "./panels/LayoutTab";
import { StyleTab } from "./panels/StyleTab";
import { CssTab } from "./panels/CssTab";
import { NODE_LABEL } from "./panels/nodeMeta";
import type { PickerProduct } from "./ImagePicker";

// ════════════════════════════════════════════════════════════════════════════
// ContextPanel (Unified P2) — the right-hand contextual editor of the unified
// workspace: select a step (rail click or preview click) and EVERYTHING about
// it is editable here. Content covers all 10 node types; Design exposes the
// per-node token layers (synced / desktop / mobile), the block Layout library,
// and per-node CSS — the full Advanced surface, one click from the preview.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Tab = "content" | "design";

export function ContextPanel({
  doc,
  nodeId,
  onCommit,
  onClose,
  products,
  productIndex,
  frameBreakpoint,
}: {
  doc: QuizDoc;
  nodeId: string;
  onCommit: (doc: QuizDoc) => void;
  onClose: () => void;
  products?: PickerProduct[];
  productIndex: IndexedProduct[];
  // The device-frame's current breakpoint — the Design tab's layer selector
  // defaults to it ("edit what you see"); synced stays one click away.
  frameBreakpoint: "desktop" | "mobile";
}) {
  const [tab, setTab] = useState<Tab>("content");
  // null = follow the frame ("edit what you see"); explicit pick overrides.
  const [layerOverride, setLayerOverride] = useState<DesignLayerMode | null>(null);
  const layer: DesignLayerMode = layerOverride ?? frameBreakpoint;

  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  return (
    <div className="qz-card" style={{ padding: 12, marginBottom: 16 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{NODE_LABEL[node.type]}</strong>
        <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
          <div className="qz-segmented" role="group" aria-label="Panel tab">
            <button type="button" aria-pressed={tab === "content"} onClick={() => setTab("content")}>
              Content
            </button>
            <button type="button" aria-pressed={tab === "design"} onClick={() => setTab("design")}>
              Design
            </button>
          </div>
          <button className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onClose} title="Close (Esc)">
            Done
          </button>
        </div>
      </div>

      {/* Live thumbnail of the selected step — renders from the same draft
          every keystroke commits to (the StepCard dual-pane pattern). */}
      <div
        style={{
          height: 200,
          overflow: "hidden",
          borderRadius: 10,
          border: "1px solid var(--qz-rule, #00000014)",
          marginBottom: 10,
          pointerEvents: "none",
        }}
        aria-hidden
      >
        <div style={{ width: 740, transform: "scale(0.485)", transformOrigin: "top left" }}>
          <StepPreview doc={doc} node={node} productIndex={productIndex} breakpoint={frameBreakpoint} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "48vh", overflowY: "auto", paddingRight: 2 }}>
        {tab === "content" ? (
          <ContentTab doc={doc} node={node} onCommit={onCommit} products={products} />
        ) : (
          <>
            <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
              <span className="qz-dim" style={{ fontSize: 11 }}>Layer:</span>
              <div className="qz-segmented" role="group" aria-label="Design layer">
                {(["synced", "desktop", "mobile"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={layer === m}
                    onClick={() => setLayerOverride(m)}
                    title={
                      m === "synced"
                        ? "Applies to every screen size"
                        : `Only when the quiz renders ${m === "desktop" ? "wide" : "narrow"}`
                    }
                  >
                    {m === "synced" ? "All" : m === "desktop" ? "Desktop" : "Mobile"}
                  </button>
                ))}
              </div>
              {layerOverride === null ? (
                <span className="qz-dim" style={{ fontSize: 10.5 }}>(following the preview)</span>
              ) : null}
            </div>
            <StyleTab doc={doc} node={node} mode={layer} onCommit={onCommit} />
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                Layout blocks
              </summary>
              <div style={{ marginTop: 8 }}>
                <LayoutTab doc={doc} node={node} onCommit={onCommit} />
              </div>
            </details>
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                Custom CSS
              </summary>
              <div style={{ marginTop: 8 }}>
                <CssTab doc={doc} node={node} onCommit={onCommit} />
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
