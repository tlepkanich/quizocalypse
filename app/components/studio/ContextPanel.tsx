import { useState } from "react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import type { DesignLayerMode } from "../../lib/designLayers";
import { reachedBy, routingConflicts } from "../../lib/routeTrace";
import { setAnswerRoute, routeAnswerToEnd, straightThroughRun } from "../../lib/quizMutations";
import { computeBucketCoverage, type CoverageLevel } from "../../lib/bucketCoverage";
import { StepPreview } from "../runtime/StepPreview";
import { PathTester } from "../logic/PathTester";
import { ContentTab, type RegenApi } from "./panels/ContentTab";
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
  regen,
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
  // Optional per-question AI regenerate plumbing (studio only).
  regen?: RegenApi;
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
      regen={regen}
    />
  );
}

// Question-Builder spec — Bucket Coverage Indicator. A quiz-level read-out of
// how well each bucket is reachable from the answers authored so far: green =
// well covered, yellow = weak (< 50% of the best bucket), red = no answers
// point at it. Hover a pill for the exact answer count.
const COVERAGE_STYLE: Record<CoverageLevel, { bg: string; fg: string; dot: string }> = {
  strong: { bg: "color-mix(in srgb, #28c840 16%, transparent)", fg: "#1c7c2c", dot: "#28c840" },
  weak: { bg: "color-mix(in srgb, #febc2e 22%, transparent)", fg: "#8a5b00", dot: "#e0a116" },
  none: { bg: "color-mix(in srgb, #ff5f57 16%, transparent)", fg: "#b3241a", dot: "#ff5f57" },
};

function BucketCoveragePills({
  doc,
  categories,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
}) {
  if (categories.length === 0) return null;
  const coverage = computeBucketCoverage(
    doc,
    categories.map((c) => ({ id: c.id, name: c.name, tags: c.tags })),
  );
  return (
    <div>
      <div className="qz-label" style={{ marginBottom: 4, fontSize: 11 }}>
        Bucket coverage
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {coverage.map((c) => {
          const s = COVERAGE_STYLE[c.level];
          return (
            <span
              key={c.id}
              title={`${c.count} answer${c.count === 1 ? "" : "s"} point at “${c.name}”${
                c.level === "none"
                  ? " — no answers reach this bucket yet"
                  : c.level === "weak"
                    ? " — weak (under half of the best-covered bucket)"
                    : ""
              }`}
              className="qz-row"
              style={{
                gap: 5,
                alignItems: "center",
                fontSize: 11,
                borderRadius: 999,
                padding: "2px 9px",
                background: s.bg,
                color: s.fg,
              }}
            >
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: s.dot }} />
              {c.name}
              <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{c.count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Question-Builder spec — read-only Flow View. Questions in flow order, each
// with its explicit skip-rules drawn as arrows (default "next" routing is
// implied by the order). Visualization only — no editing here.
function QuizFlowView({ doc }: { doc: QuizDoc }) {
  const { run, tail } = straightThroughRun(doc);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const labelFor = (id: string | null): string => {
    if (!id) return "—";
    const n = byId.get(id);
    if (!n) return "(missing)";
    const d = n.data as Record<string, unknown>;
    const txt = (typeof d.text === "string" && d.text) || (typeof d.headline === "string" && d.headline) || NODE_LABEL[n.type];
    return `${NODE_LABEL[n.type]}: ${String(txt).slice(0, 28)}`;
  };
  const questions = run
    .map((id) => byId.get(id))
    .filter((n): n is Extract<QuizNode, { type: "question" }> => n?.type === "question");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        background: "var(--qz-cream-2, #00000008)",
      }}
    >
      {questions.map((q, i) => {
        const explicit = q.data.answers
          .map((a) => {
            const edge = doc.edges.find(
              (e) => e.source === q.id && e.source_handle === a.edge_handle_id,
            );
            return edge ? { a, targetId: edge.target } : null;
          })
          .filter((x): x is { a: (typeof q.data.answers)[number]; targetId: string } => x !== null);
        return (
          <div key={q.id} style={{ fontSize: 11.5 }}>
            <div style={{ fontWeight: 600 }}>
              <span style={{ opacity: 0.6 }}>{i + 1}.</span> {q.data.text.slice(0, 40) || "Untitled"}
            </div>
            {explicit.length > 0 ? (
              <div style={{ marginLeft: 12, marginTop: 2, color: "var(--qz-ink-2, #555)" }}>
                {explicit.map(({ a, targetId }) => (
                  <div key={a.id} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    ↳ &ldquo;{a.text.slice(0, 18)}&rdquo; → {labelFor(targetId)}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.85 }}>↦ {labelFor(tail)}</div>
    </div>
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
  // Destination options: any shopper-visible step except intro, end (offered via
  // the dedicated "End the quiz" option), and the node itself.
  const targets = doc.nodes.filter(
    (n) => n.type !== "intro" && n.type !== "end" && n.id !== node.id,
  );
  const conflicts = node.type === "question" ? routingConflicts(doc, node.id) : [];
  const [showFlow, setShowFlow] = useState(false);
  const targetLabel = (n: QuizNode) => {
    const d = n.data as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
    const title = s("text") || s("headline") || s("label") || s("persona_name") || NODE_LABEL[n.type];
    return `${NODE_LABEL[n.type]}: ${title.slice(0, 36)}`;
  };

  return (
    <>
      <BucketCoveragePills doc={doc} categories={categories} />
      <div>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          aria-pressed={showFlow}
          onClick={() => setShowFlow((v) => !v)}
          style={{ fontSize: 11 }}
        >
          {showFlow ? "▾ Flow view" : "▸ Flow view"}
        </button>
        {showFlow ? (
          <div style={{ marginTop: 6 }}>
            <QuizFlowView doc={doc} />
          </div>
        ) : null}
      </div>
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
              const targetNode = edge ? doc.nodes.find((n) => n.id === edge.target) : undefined;
              const selectValue =
                targetNode?.type === "end" ? "__end__" : edge?.target ?? "";
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
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__end__") onCommit(routeAnswerToEnd(doc, node.id, a.id));
                      else onCommit(setAnswerRoute(doc, node.id, a.id, v || null));
                    }}
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
                    <option value="__end__">⊗ End the quiz</option>
                  </select>
                </label>
              );
            })}
          </div>
          {conflicts.length > 0 ? (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {conflicts.map((c, i) => (
                <div
                  key={i}
                  className="qz-row"
                  style={{
                    gap: 6,
                    alignItems: "flex-start",
                    fontSize: 11,
                    color: c.severity === "error" ? "#b3241a" : "#8a5b00",
                  }}
                >
                  <span aria-hidden>{c.severity === "error" ? "⚠" : "⚑"}</span>
                  <span>{c.message}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="qz-dim" style={{ fontSize: 11, marginTop: 6 }}>
            Each answer is a skip-logic rule. &ldquo;Next step&rdquo; follows the flow order;
            picking a destination sends ONLY that answer there. &ldquo;End the quiz&rdquo; skips
            straight to the finish.
          </p>
        </div>
      ) : null}

      {node.type === "branch" ? (
        <div>
          <div className="qz-label" style={{ marginBottom: 4, fontSize: 11 }}>
            Branch slots (
            {node.data.mode === "ab_split"
              ? "A/B split"
              : node.data.mode === "points"
                ? "best match"
                : "rules"}
            )
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
  regen,
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
  regen?: RegenApi;
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
          <ContentTab doc={doc} node={node} onCommit={onCommit} products={products} regen={regen} />
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
