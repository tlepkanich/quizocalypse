import { useState } from "react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import { isFreeformType } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import type { DesignLayerMode } from "../../lib/designLayers";
import { reachedBy, routingConflicts } from "../../lib/routeTrace";
import {
  setAnswerRoute,
  routeAnswerToEnd,
  straightThroughRun,
  setAnswerBucketDirect,
  setAnswerBucketWeight,
  swapScoringModel,
  moveStep,
} from "../../lib/quizMutations";
import { updateNodeData } from "./studioDoc";
import type { InspectTarget } from "../runtime/QuizRuntime";
import { computeBucketCoverage, type CoverageLevel } from "../../lib/bucketCoverage";
import { StepPreview } from "../runtime/StepPreview";
import { PathTester } from "../logic/PathTester";
import { ContentTab, type RegenApi } from "./panels/ContentTab";
import { LayoutTab } from "./panels/LayoutTab";
import { StyleTab } from "./panels/StyleTab";
import { CssTab } from "./panels/CssTab";
import { NODE_LABEL } from "./panels/nodeMeta";
import type { PickerProduct } from "./ImagePicker";
import { MediaPicker } from "./MediaPicker";
import { copyOptionMediaToAll } from "../../lib/answerDisplay";

// ════════════════════════════════════════════════════════════════════════════
// ContextPanel (Unified P2) — the right-hand contextual editor of the unified
// workspace: select a step (rail click or preview click) and EVERYTHING about
// it is editable here. Content covers all 10 node types; Design exposes the
// per-node token layers (synced / desktop / mobile), the block Layout library,
// and per-node CSS — the full Advanced surface, one click from the preview.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Tab = "content" | "design" | "routing";
type QuestionNode = Extract<QuizNode, { type: "question" }>;

// build-tab v2.0 §1/§10 — the Build inspector is DESIGN-ONLY. Roles, result
// mapping and routing live exclusively in the Logic view; the old inline gold
// Logic section (role dropdown + per-answer mapping) was removed here. A single
// one-line pointer to Logic is all that remains (see DeciderInspectorBody).

/** QZY-8 (build-tab §5.1) — single-option scope: clicking one answer on the
 *  canvas scopes the inspector to THAT option; "Style all options" returns to
 *  question level. Media/label styling deepen in QZY-9 — this is the scoping
 *  mechanic + the option's text and its logic line. */
function AnswerScopePanel({
  doc,
  node,
  answerId,
  onCommit,
  onClearScope,
  products,
}: {
  doc: QuizDoc;
  node: QuestionNode;
  answerId: string;
  onCommit: (doc: QuizDoc) => void;
  onClearScope: () => void;
  products?: PickerProduct[];
}) {
  const answer = node.data.answers.find((a) => a.id === answerId);
  if (!answer) return null;
  const setAnswer = (patch: Record<string, unknown>) =>
    onCommit(
      updateNodeData(doc, node.id, {
        answers: node.data.answers.map((a) => (a.id === answerId ? { ...a, ...patch } : a)),
      }),
    );
  return (
    <div className="qz-insp-scope">
      <div className="qz-insp-scope-head">
        <span className="qz-label" style={{ fontSize: 11 }}>
          Option
        </span>
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onClearScope}>
          Style all options
        </button>
      </div>
      <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
        <span className="qz-dim" style={{ fontSize: 11.5 }}>
          Label
        </span>
        <input
          className="qz-input"
          value={answer.text}
          maxLength={60}
          onChange={(e) => setAnswer({ text: e.target.value })}
        />
      </label>
      {/* QZY-R4 §8 — per-option media via the ONE shared picker (emoji · icons ·
          upload · url · products), scoped to THIS option only. */}
      <div style={{ display: "grid", gap: 4 }}>
        <span className="qz-dim" style={{ fontSize: 11.5 }}>
          Icon or image
        </span>
        <MediaPicker
          glyph={answer.icon}
          image={answer.image_url}
          onGlyph={(v) => setAnswer({ icon: v })}
          onImage={(v) => setAnswer({ image_url: v })}
          onClear={() => setAnswer({ icon: undefined, image_url: undefined })}
          products={products}
        />
      </div>
      {/* §3.2 — push this option's media across the whole set. */}
      {node.data.answers.length > 1 ? (
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() =>
            onCommit(
              updateNodeData(doc, node.id, {
                answers: copyOptionMediaToAll(node.data.answers, answerId),
              }),
            )
          }
        >
          Apply this option&rsquo;s look to all options
        </button>
      ) : null}
      {/* build-tab v2.0 §1 — design-only: this option's result mapping / filter
          match lives in the Logic view, never here. */}
      <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
        Layout &amp; option styling apply to every option — set them under Answer display.
      </p>
    </div>
  );
}

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
  inspectTarget,
  onClearScope,
  onArmDelete,
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
  // QZY-8 — the exact canvas element clicked (single-option scoping).
  inspectTarget?: InspectTarget | null;
  onClearScope?: () => void;
  // QZY-8 — footer delete arms the carousel's two-step confirm.
  onArmDelete?: (nodeId: string) => void;
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
      inspectTarget={inspectTarget}
      onClearScope={onClearScope}
      onArmDelete={onArmDelete}
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
        Recommendation coverage
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {coverage.map((c) => {
          const s = COVERAGE_STYLE[c.level];
          return (
            <span
              key={c.id}
              title={`${c.count} answer${c.count === 1 ? "" : "s"} point at “${c.name}”${
                c.level === "none"
                  ? " — no answers reach this recommendation yet"
                  : c.level === "weak"
                    ? " — weak (under half of the best-covered recommendation)"
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

// ── Answer Mapping (Question-Builder spec) — assign each answer to recommendation
// buckets. Direct mapping = one bucket dropdown per answer (weight 1); Weighted =
// a points grid (answers × buckets, 0–10). Both materialize into answer.points,
// which the engine's points strategy already consumes. The model is the quiz's
// scoring_model (set on Shape Your Quiz; togglable here).
function AnswerMappingSection({
  doc,
  node,
  categories,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuizNode;
  categories: BuilderCategory[];
  onCommit: (doc: QuizDoc) => void;
}) {
  if (node.type !== "question") return null;
  // LOGIC v2 (L2-10f) — decider docs resolve results via target_id + rules;
  // the legacy points editors below would write fields the runtime ignores.
  // Replace them with an honest pointer instead of a silent no-effect editor.
  if (doc.logic_model === "decider") {
    return (
      <div className="qz-card" style={{ padding: 10 }}>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 4 }}>
          ◆ Decider logic
        </div>
        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          This quiz picks results with one deciding question (plus optional rules), not
          answer points — edit its answer→result mapping in the create flow&rsquo;s
          Questions &amp; Logic step.
        </p>
      </div>
    );
  }
  // Open-text / freeform questions have no answer options to map — their responses
  // are zero-party data, not scored (Question-Builder spec §Open Text).
  if (isFreeformType(node.data.question_type)) {
    return (
      <div className="qz-card" style={{ padding: 10 }}>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 4 }}>
          Answer scoring
        </div>
        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          Open-text answers aren&rsquo;t scored — responses are stored as customer data,
          not used to pick a recommendation.
        </p>
      </div>
    );
  }
  const answers = node.data.answers;
  const model = doc.scoring_model ?? "direct";
  // Switching preserves BOTH models' data (swap points↔points_alt), so a merchant
  // can flip back and forth without losing their other mapping.
  const setModel = (m: "direct" | "weighted") => onCommit(swapScoringModel(doc, m));

  return (
    <div>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", marginBottom: 6 }}>
        <div className="qz-label" style={{ fontSize: 11 }}>Answer scoring</div>
        <div className="qz-row" style={{ gap: 4 }}>
          {(["direct", "weighted"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModel(m)}
              className={`qz-btn qz-btn-sm ${model === m ? "qz-btn-accent" : "qz-btn-ghost"}`}
              style={{ fontSize: 11, textTransform: "capitalize", padding: "2px 8px" }}
              aria-pressed={model === m}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {categories.length === 0 ? (
        <p className="qz-dim" style={{ fontSize: 11, margin: 0 }}>
          No recommendations yet — add recommendations to map answers to.
        </p>
      ) : model === "direct" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {answers.map((a) => {
            const current = Object.keys(a.points ?? {})[0] ?? "";
            return (
              <label key={a.id} className="qz-row" style={{ gap: 8, alignItems: "center", fontSize: 12 }}>
                <span
                  style={{ flex: "0 0 38%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={a.text}
                >
                  {a.icon ? `${a.icon} ` : ""}
                  {a.text}
                </span>
                <select
                  value={current}
                  onChange={(e) => onCommit(setAnswerBucketDirect(doc, node.id, a.id, e.target.value || null))}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    font: "inherit",
                    fontSize: 12,
                    padding: "4px 6px",
                    borderRadius: 6,
                    border: "1px solid #00000022",
                  }}
                  aria-label={`Recommendation for answer: ${a.text}`}
                >
                  <option value="">No recommendation</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr>
                <th aria-hidden style={{ position: "sticky", left: 0, background: "var(--qz-paper, #fff)" }} />
                {categories.map((c) => (
                  <th
                    key={c.id}
                    style={{ padding: "2px 5px", fontWeight: 600, whiteSpace: "nowrap" }}
                    title={c.name}
                  >
                    {c.name.length > 12 ? `${c.name.slice(0, 11)}…` : c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answers.map((a) => (
                <tr key={a.id}>
                  <td
                    style={{
                      padding: "2px 6px",
                      maxWidth: 130,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      position: "sticky",
                      left: 0,
                      background: "var(--qz-paper, #fff)",
                    }}
                    title={a.text}
                  >
                    {a.icon ? `${a.icon} ` : ""}
                    {a.text}
                  </td>
                  {categories.map((c) => (
                    <td key={c.id} style={{ padding: "1px 3px", textAlign: "center" }}>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={a.points?.[c.id] ?? 0}
                        onChange={(e) => {
                          const w = Math.max(0, Math.min(10, Number(e.target.valueAsNumber) || 0));
                          onCommit(setAnswerBucketWeight(doc, node.id, a.id, c.id, w));
                        }}
                        style={{
                          width: 38,
                          font: "inherit",
                          fontSize: 11,
                          padding: "2px 4px",
                          textAlign: "center",
                          borderRadius: 5,
                          border: "1px solid #00000022",
                        }}
                        aria-label={`Points ${a.text} awards toward ${c.name}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  // The spec's right-panel tabs: Mapping (bucket assignment) | Logic (skip logic).
  // Bucket-coverage pills sit ABOVE the tabs (persistent across both).
  const [view, setView] = useState<"mapping" | "logic">("mapping");
  const targetLabel = (n: QuizNode) => {
    const d = n.data as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
    const title = s("text") || s("headline") || s("label") || s("persona_name") || NODE_LABEL[n.type];
    return `${NODE_LABEL[n.type]}: ${title.slice(0, 36)}`;
  };

  return (
    <>
      <BucketCoveragePills doc={doc} categories={categories} />

      <div className="qz-segmented qz-segmented--fill" role="group" aria-label="Mapping or Logic">
        <button type="button" aria-pressed={view === "mapping"} onClick={() => setView("mapping")}>
          Mapping
        </button>
        <button type="button" aria-pressed={view === "logic"} onClick={() => setView("logic")}>
          Logic
        </button>
      </div>

      {/* ── MAPPING tab — per-answer bucket assignment (direct / weighted) ── */}
      {view === "mapping" ? (
        <>
          {node.type === "question" ? (
            <AnswerMappingSection doc={doc} node={node} categories={categories} onCommit={onCommit} />
          ) : node.type === "result" ? (
            <div>
              <div className="qz-label" style={{ marginBottom: 4, fontSize: 11 }}>
                Recommendations
              </div>
              <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
                {(() => {
                  const catId = node.data.category_id;
                  const cat = catId ? categories.find((c) => c.id === catId) : null;
                  return cat
                    ? `Bound to the “${cat.name}” recommendation (${cat.productIds.length} products), with tag-match ranking on top.`
                    : "Ranked by answer-tag overlap with a collection fallback (no recommendation binding).";
                })()}
              </p>
              {onOpenLogic ? (
                <button
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={onOpenLogic}
                >
                  Full product mapping (Logic) →
                </button>
              ) : null}
            </div>
          ) : (
            <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
              Select a question to map its answers to recommendations.
            </p>
          )}
          <details style={{ flex: "0 0 auto" }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Try a path</summary>
            <div style={{ marginTop: 8 }}>
              <PathTester doc={doc} productIndex={productIndex} categories={categories} compact />
            </div>
          </details>
        </>
      ) : null}

      {/* ── LOGIC tab — skip-logic rules + flow ── */}
      {view !== "logic" ? null : (
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
            Skip logic — where each answer goes
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
      </>
      )}
    </>
  );
}

/** The design-layer selector (synced / desktop / mobile) — shared by the legacy
 *  Design tab and the decider inspector's style surface. */
function LayerSelector({
  layer,
  layerOverride,
  setLayerOverride,
}: {
  layer: DesignLayerMode;
  layerOverride: DesignLayerMode | null;
  setLayerOverride: (m: DesignLayerMode | null) => void;
}) {
  return (
    <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
      <span className="qz-dim" style={{ fontSize: 11 }}>
        Layer:
      </span>
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
        <span className="qz-dim" style={{ fontSize: 10.5 }}>
          (following the preview)
        </span>
      ) : null}
    </div>
  );
}

// ── Decider inspector (build-tab v2.0) — the CORRECTED right panel: purely
// selection-driven DESIGN. No tabs, no logic, no page-background (that lives in
// the left Background tab). Content + style for the selected element, then a
// single one-line pointer to the Logic view. Legacy docs keep the old tabbed
// ContextPanelBody untouched. (Element-granular per-element control sets are
// R7; this phase makes the panel tab-less and logic-free.)
function DeciderInspectorBody({
  doc,
  node,
  layer,
  layerOverride,
  setLayerOverride,
  onCommit,
  products,
  regen,
  scopedAnswerId,
  onClearScope,
  onOpenLogic,
}: {
  doc: QuizDoc;
  node: QuizNode;
  layer: DesignLayerMode;
  layerOverride: DesignLayerMode | null;
  setLayerOverride: (m: DesignLayerMode | null) => void;
  onCommit: (doc: QuizDoc) => void;
  products?: PickerProduct[];
  regen?: RegenApi;
  scopedAnswerId: string | null;
  onClearScope?: () => void;
  onOpenLogic?: () => void;
}) {
  // Single-option scope (build-tab §5.1): the option's own label + media only.
  if (scopedAnswerId && node.type === "question" && onClearScope) {
    return (
      <AnswerScopePanel
        doc={doc}
        node={node}
        answerId={scopedAnswerId}
        onCommit={onCommit}
        onClearScope={onClearScope}
        products={products}
      />
    );
  }
  return (
    <>
      <ContentTab doc={doc} node={node} onCommit={onCommit} products={products} regen={regen} />
      <LayerSelector layer={layer} layerOverride={layerOverride} setLayerOverride={setLayerOverride} />
      {/* §1 — hideBackground: the screen background lives ONLY in the left tab. */}
      <StyleTab doc={doc} node={node} mode={layer} onCommit={onCommit} hideBackground />
      <details style={{ flex: "0 0 auto" }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Layout blocks</summary>
        <div style={{ marginTop: 8 }}>
          <LayoutTab doc={doc} node={node} onCommit={onCommit} />
        </div>
      </details>
      <details style={{ flex: "0 0 auto" }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Custom CSS</summary>
        <div style={{ marginTop: 8 }}>
          <CssTab doc={doc} node={node} onCommit={onCommit} />
        </div>
      </details>
      {/* §1/§10 — the ONE allowed line of logic on this page: a pointer, not UI. */}
      {node.type === "question" ? (
        <div
          className="qz-row qz-row-between"
          style={{
            gap: 8,
            alignItems: "center",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--qz-rule)",
          }}
        >
          <span className="qz-dim" style={{ fontSize: 11.5 }}>
            Roles, result mapping &amp; routing live in the Logic view.
          </span>
          {onOpenLogic ? (
            <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onOpenLogic}>
              Open Logic →
            </button>
          ) : null}
        </div>
      ) : null}
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
  inspectTarget,
  onClearScope,
  onArmDelete,
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
  inspectTarget?: InspectTarget | null;
  onClearScope?: () => void;
  onArmDelete?: (nodeId: string) => void;
}) {
  // QZY-8 — single-option scope: a canvas click on ONE answer scopes the
  // Content tab to that option (build-tab §5.1).
  const scopedAnswerId =
    node.type === "question" &&
    inspectTarget?.nodeId === node.id &&
    inspectTarget.part === "answer" &&
    inspectTarget.answerId
      ? inspectTarget.answerId
      : null;
  const isDecider = doc.logic_model === "decider";

  // QZY-8 — footer move/delete (§2): reorder within the straight-through run;
  // delete arms the carousel's impact-naming confirm.
  const run = straightThroughRun(doc).run;
  const runIdx = run.indexOf(node.id);
  const movable = runIdx >= 0;

  return (
    <div className="qz-card" style={{ padding: 12, marginBottom: 16 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{NODE_LABEL[node.type]}</strong>
        <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
          {/* build-tab v2.0 §1 — decider docs have NO tab bar (design-only,
              selection-driven). Legacy docs keep Content/Design/Routing. */}
          {!isDecider ? (
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
          ) : null}
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
        {isDecider ? (
          <DeciderInspectorBody
            doc={doc}
            node={node}
            layer={layer}
            layerOverride={layerOverride}
            setLayerOverride={setLayerOverride}
            onCommit={onCommit}
            products={products}
            regen={regen}
            scopedAnswerId={scopedAnswerId}
            onClearScope={onClearScope}
            onOpenLogic={onOpenLogic}
          />
        ) : (
          <>
        {tab === "content" && scopedAnswerId && node.type === "question" && onClearScope ? (
          <AnswerScopePanel
            doc={doc}
            node={node}
            answerId={scopedAnswerId}
            onCommit={onCommit}
            onClearScope={onClearScope}
            products={products}
          />
        ) : tab === "content" ? (
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
            {/* BLD-7 — flex:0 0 auto: a <details> flex item otherwise shrinks
                to its summary height and its OPEN content paints past the
                scrollport (the block list's lower rows were unreachable). */}
            <details style={{ flex: "0 0 auto" }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                Layout blocks
              </summary>
              <div style={{ marginTop: 8 }}>
                <LayoutTab doc={doc} node={node} onCommit={onCommit} />
              </div>
            </details>
            <details style={{ flex: "0 0 auto" }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                Custom CSS
              </summary>
              <div style={{ marginTop: 8 }}>
                <CssTab doc={doc} node={node} onCommit={onCommit} />
              </div>
            </details>
          </>
        )}
          </>
        )}
      </div>
      {/* QZY-8 §2 — footer actions for the selected screen. */}
      {(movable || (onArmDelete && node.type !== "intro")) ? (
        <div className="qz-insp-foot">
          {movable ? (
            <>
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                disabled={runIdx <= 0}
                onClick={() => onCommit(moveStep(doc, node.id, run[runIdx - 1]!))}
              >
                ↑ Move
              </button>
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                disabled={runIdx >= run.length - 1}
                onClick={() =>
                  onCommit(
                    moveStep(doc, node.id, runIdx + 2 < run.length ? run[runIdx + 2]! : null),
                  )
                }
              >
                ↓ Move
              </button>
            </>
          ) : null}
          {onArmDelete && node.type !== "intro" ? (
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm qz-insp-foot-del"
              onClick={() => onArmDelete(node.id)}
              title="Arms the confirm in the screen strip below"
            >
              Delete step…
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
