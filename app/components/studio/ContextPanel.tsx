import { useState } from "react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import type { DesignLayerMode } from "../../lib/designLayers";
import { reachedBy } from "../../lib/routeTrace";
import { setAnswerRoute } from "../../lib/quizMutations";
import { StepPreview } from "../runtime/StepPreview";
import { PathTester } from "../logic/PathTester";
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
type Tab = "content" | "design" | "routing";

export function ContextPanel({
  doc,
  nodeId,
  onCommit,
  onClose,
  products,
  productIndex,
  categories,
  frameBreakpoint,
  onOpenLogic,
}: {
  doc: QuizDoc;
  nodeId: string;
  onCommit: (doc: QuizDoc) => void;
  onClose: () => void;
  products?: PickerProduct[];
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  // The device-frame's current breakpoint — the Design tab's layer selector
  // defaults to it ("edit what you see"); synced stays one click away.
  frameBreakpoint: "desktop" | "mobile";
  // Jump to the Logic view (full recommendation mapping lives there).
  onOpenLogic?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("content");
  // null = follow the frame ("edit what you see"); explicit pick overrides.
  const [layerOverride, setLayerOverride] = useState<DesignLayerMode | null>(null);
  const layer: DesignLayerMode = layerOverride ?? frameBreakpoint;

  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return (
    <ContextPanelBody
      key={nodeId}
      doc={doc}
      node={node}
      tab={tab}
      setTab={setTab}
      layer={layer}
      layerOverride={layerOverride}
      setLayerOverride={setLayerOverride}
      onCommit={onCommit}
      onClose={onClose}
      products={products}
      productIndex={productIndex}
      categories={categories}
      frameBreakpoint={frameBreakpoint}
      onOpenLogic={onOpenLogic}
    />
  );
}

// ── Routing tab (Unified P4) — "how does this step route, and what reaches it" ─
function RoutingBody({
  doc,
  node,
  onCommit,
  productIndex,
  categories,
  onOpenLogic,
}: {
  doc: QuizDoc;
  node: QuizNode;
  onCommit: (doc: QuizDoc) => void;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  onOpenLogic?: () => void;
}) {
  const arrivals = reachedBy(doc, node.id);
  // Destination options: any shopper-visible step except intro and the node itself.
  const targets = doc.nodes.filter((n) => n.type !== "intro" && n.id !== node.id);
  const targetLabel = (n: QuizNode) => {
    const d = n.data as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
    const title = s("text") || s("headline") || s("label") || s("persona_name") || NODE_LABEL[n.type];
    return `${NODE_LABEL[n.type]}: ${title.slice(0, 36)}`;
  };

  return (
    <>
      {arrivals.length > 0 ? (
        <div>
          <div className="qz-label" style={{ marginBottom: 4, fontSize: 11 }}>
            Reached by
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {arrivals.slice(0, 6).map((a, i) => (
              <span
                key={i}
                className="qz-dim"
                style={{
                  fontSize: 11,
                  border: "1px solid var(--qz-rule, #00000014)",
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                {a.label}
              </span>
            ))}
            {arrivals.length > 6 ? (
              <span className="qz-dim" style={{ fontSize: 11 }}>+{arrivals.length - 6} more</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {node.type === "question" ? (
        <div>
          <div className="qz-label" style={{ marginBottom: 4, fontSize: 11 }}>
            Where each answer goes
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {node.data.answers.map((a) => {
              const edge = doc.edges.find(
                (e) => e.source === node.id && e.source_handle === a.edge_handle_id,
              );
              return (
                <label key={a.id} className="qz-row" style={{ gap: 8, alignItems: "center", fontSize: 12 }}>
                  <span
                    style={{
                      flex: "0 0 38%",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={a.text}
                  >
                    {a.icon ? `${a.icon} ` : ""}{a.text}
                  </span>
                  <select
                    value={edge?.target ?? ""}
                    onChange={(e) =>
                      onCommit(setAnswerRoute(doc, node.id, a.id, e.target.value || null))
                    }
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: "inherit",
                      fontSize: 12,
                      padding: "4px 6px",
                      borderRadius: 6,
                      border: "1px solid #00000022",
                    }}
                    aria-label={`Destination for answer: ${a.text}`}
                  >
                    <option value="">→ Next step (default)</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        → {targetLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <p className="qz-dim" style={{ fontSize: 11, marginTop: 6 }}>
            &ldquo;Next step&rdquo; follows the flow order; picking a destination sends ONLY that
            answer there. Unreachable steps appear in the rail for cleanup.
          </p>
        </div>
      ) : null}

      {node.type === "branch" ? (
        <div>
          <div className="qz-label" style={{ marginBottom: 4, fontSize: 11 }}>
            Branch slots ({node.data.mode === "ab_split" ? "A/B split" : "rules"})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {node.data.slots.map((s) => {
              const edge = doc.edges.find(
                (e) => e.source === node.id && e.source_handle === s.id,
              );
              const target = edge ? doc.nodes.find((n) => n.id === edge.target) : null;
              return (
                <div key={s.id} className="qz-dim" style={{ fontSize: 12 }}>
                  ⑂ {s.label} → {target ? targetLabel(target) : "(not connected)"}
                </div>
              );
            })}
          </div>
          <p className="qz-dim" style={{ fontSize: 11, marginTop: 6 }}>
            Slot rules and A/B weights live in the Logic view.
            {onOpenLogic ? (
              <>
                {" "}
                <button className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onOpenLogic}>
                  Open Logic →
                </button>
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {node.type === "result" ? (
        <div>
          <div className="qz-label" style={{ marginBottom: 4, fontSize: 11 }}>
            Recommendations
          </div>
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            {(() => {
              const catId = node.data.category_id;
              const cat = catId ? categories.find((c) => c.id === catId) : null;
              return cat
                ? `Bound to the “${cat.name}” bucket (${cat.productIds.length} products), with tag-match ranking on top.`
                : "Ranked by answer-tag overlap with a collection fallback (no bucket binding).";
            })()}
          </p>
          {onOpenLogic ? (
            <button className="qz-btn qz-btn-ghost qz-btn-sm" style={{ marginTop: 6 }} onClick={onOpenLogic}>
              Full product mapping (Logic) →
            </button>
          ) : null}
        </div>
      ) : null}

      <details>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
          Try a path
        </summary>
        <div style={{ marginTop: 8 }}>
          <PathTester doc={doc} productIndex={productIndex} categories={categories} compact />
        </div>
      </details>
    </>
  );
}

function ContextPanelBody({
  doc,
  node,
  tab,
  setTab,
  layer,
  layerOverride,
  setLayerOverride,
  onCommit,
  onClose,
  products,
  productIndex,
  categories,
  frameBreakpoint,
  onOpenLogic,
}: {
  doc: QuizDoc;
  node: QuizNode;
  tab: Tab;
  setTab: (t: Tab) => void;
  layer: DesignLayerMode;
  layerOverride: DesignLayerMode | null;
  setLayerOverride: (m: DesignLayerMode | null) => void;
  onCommit: (doc: QuizDoc) => void;
  onClose: () => void;
  products?: PickerProduct[];
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  frameBreakpoint: "desktop" | "mobile";
  onOpenLogic?: () => void;
}) {

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
            <button type="button" aria-pressed={tab === "routing"} onClick={() => setTab("routing")}>
              Routing
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
        ) : tab === "routing" ? (
          <RoutingBody
            doc={doc}
            node={node}
            onCommit={onCommit}
            productIndex={productIndex}
            categories={categories}
            onOpenLogic={onOpenLogic}
          />
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
