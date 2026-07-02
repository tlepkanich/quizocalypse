import { useMemo } from "react";
import type { Quiz } from "../../lib/quizSchema";
import { orderFlow } from "../../lib/flowOrder";
import { answerRoutes, reachedBy } from "../../lib/routeTrace";
import type { BuilderCategory } from "../builder/stepProps";

// ════════════════════════════════════════════════════════════════════════════
// LogicFlowMap (design refinement D2) — "How shoppers flow": the whole
// question → answer → result-page graph on one screen. Octane buries logic
// in per-element panels with no overview; this IS the overview. Lightweight
// DOM only (no React Flow): a vertical spine of step rows, divergent answers
// shown as routed chips, branch nodes as slot badges, terminating in a grid
// of result-page cards (bucket size + reached-by). Click a result card to
// select it in the mapping table below.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

const GLYPH: Record<string, string> = {
  intro: "⌂",
  question: "?",
  email_gate: "✉",
  message: "💬",
  branch: "⑂",
  ask_ai: "✨",
  product_cards: "▦",
  integration: "⇄",
  end: "■",
  result: "★",
};

function shortLabel(doc: QuizDoc, nodeId: string | null): string {
  if (!nodeId) return "next step";
  const n = doc.nodes.find((x) => x.id === nodeId);
  if (!n) return "?";
  if (n.type === "result") return n.data.headline || "Result";
  if (n.type === "question") {
    const qIdx = doc.nodes.filter((x) => x.type === "question").findIndex((x) => x.id === nodeId);
    return `Q${qIdx + 1}`;
  }
  return n.type.replace("_", " ");
}

export function LogicFlowMap({
  doc,
  categories,
  selectedNodeId,
  onSelectResult,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  selectedNodeId: string | null;
  onSelectResult: (nodeId: string) => void;
}) {
  const flow = useMemo(() => orderFlow(doc), [doc]);
  const bucketSize = useMemo(
    () => new Map(categories.map((c) => [c.id, c.productIds.length] as const)),
    [categories],
  );
  const resultNodes = doc.nodes.filter(
    (n): n is Extract<QuizDoc["nodes"][number], { type: "result" }> => n.type === "result",
  );

  // The spine WITHOUT results (results render as the destination grid).
  const spineSteps = flow.steps.filter((s) => {
    const n = doc.nodes.find((x) => x.id === s.nodeId);
    return n && n.type !== "result";
  });

  return (
    <section className="qz-card" style={{ padding: 16 }}>
      <div className="qz-label" style={{ marginBottom: 10 }}>
        How shoppers flow
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {spineSteps.map((step) => {
          const node = doc.nodes.find((n) => n.id === step.nodeId);
          if (!node) return null;

          if (node.type === "question") {
            const routes = answerRoutes(doc, node.id);
            const targets = new Set(routes.map((r) => r.targetNodeId ?? "__next"));
            const diverges = targets.size > 1;
            return (
              <div key={node.id} style={{ display: "flex", gap: 10 }}>
                <Rail glyph={GLYPH[node.type] ?? "•"} />
                <div style={{ flex: 1, minWidth: 0, paddingBottom: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {node.data.text}
                    {/* LOGIC v2 — gold decider marker. `role` only exists on
                        decider docs, so legacy flow maps render unchanged. */}
                    {node.data.role === "decides" ? (
                      <span className="qz-lfm-decider" title="This question decides the result">
                        ◆ Decides the result
                      </span>
                    ) : null}
                  </div>
                  <div className="qz-row" style={{ gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                    {routes.map((r) => (
                      <span
                        key={r.answerId}
                        title={diverges ? `→ ${r.targetLabel}` : undefined}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid var(--qz-rule, #e3ddd2)",
                          background: "var(--qz-paper, #fff)",
                          whiteSpace: "nowrap",
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.answerText}
                        {diverges ? (
                          <span className="qz-dim"> → {shortLabel(doc, r.targetNodeId)}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          if (node.type === "branch") {
            return (
              <div key={node.id} style={{ display: "flex", gap: 10 }}>
                <Rail glyph={GLYPH.branch!} />
                <div style={{ flex: 1, minWidth: 0, paddingBottom: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {node.data.label || "Branch"}
                    <span
                      className="qz-badge"
                      style={{ marginLeft: 8, fontSize: 10 }}
                    >
                      {node.data.mode === "ab_split" ? "A/B test" : "rules"}
                    </span>
                  </div>
                  <div className="qz-row" style={{ gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                    {node.data.slots.map((slot) => {
                      const edge = doc.edges.find(
                        (e) => e.source === node.id && e.source_handle === slot.id,
                      );
                      return (
                        <span
                          key={slot.id}
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: "1px dashed var(--qz-rule, #e3ddd2)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {slot.label}
                          {node.data.mode === "ab_split" && typeof slot.weight === "number"
                            ? ` ${slot.weight}%`
                            : ""}
                          <span className="qz-dim"> → {shortLabel(doc, edge?.target ?? null)}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          }

          // Other step types: a compact one-liner keeps the spine readable.
          const label =
            node.type === "intro"
              ? (node.data as { headline?: string }).headline || "Intro"
              : node.type.replace("_", " ");
          return (
            <div key={node.id} style={{ display: "flex", gap: 10 }}>
              <Rail glyph={GLYPH[node.type] ?? "•"} />
              <div className="qz-dim" style={{ flex: 1, fontSize: 12.5, paddingBottom: 14 }}>
                {label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Destinations: every result page as a clickable card. */}
      <div style={{ marginTop: 4 }}>
        <div className="qz-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", margin: "4px 0 8px" }}>
          ★ Lands on one of {resultNodes.length} result pages
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 10,
          }}
        >
          {resultNodes.map((r) => {
            const arrivals = reachedBy(doc, r.id);
            const size = r.data.category_id ? bucketSize.get(r.data.category_id) : undefined;
            const selected = selectedNodeId === r.id;
            const orphaned = flow.orphans.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectResult(r.id)}
                className="qz-card qz-interactive"
                style={{
                  textAlign: "left",
                  padding: 10,
                  cursor: "pointer",
                  border: selected
                    ? "2px solid var(--qz-accent, #2a6df4)"
                    : "1px solid var(--qz-rule, #e3ddd2)",
                  background: "var(--qz-paper, #fff)",
                  font: "inherit",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                  {r.data.headline || "Result"}
                  {orphaned ? (
                    <span title="No path reaches this page" style={{ marginLeft: 6, fontSize: 11 }}>⚠</span>
                  ) : null}
                </div>
                <div className="qz-dim" style={{ fontSize: 11, marginTop: 4 }}>
                  {typeof size === "number" ? `${size} products in its bucket` : "no bucket bound"}
                </div>
                {arrivals.length > 0 ? (
                  <div className="qz-dim" style={{ fontSize: 10.5, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Reached by: {arrivals.slice(0, 2).map((a) => a.label).join(" · ")}
                    {arrivals.length > 2 ? ` +${arrivals.length - 2}` : ""}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// The vertical spine gutter: glyph dot + connector line.
function Rail({ glyph }: { glyph: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flex: "0 0 auto" }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          border: "1px solid var(--qz-rule, #e3ddd2)",
          background: "var(--qz-cream-2, #f7f3ea)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          flex: "0 0 auto",
        }}
      >
        {glyph}
      </span>
      <span style={{ width: 1, flex: 1, background: "var(--qz-rule, #e3ddd2)", minHeight: 8 }} />
    </div>
  );
}
