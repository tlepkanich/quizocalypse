import { useState } from "react";
import { QzBadge, QzButton } from "../../qz";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { OrderedFlow, OrderedLane } from "../../../lib/flowOrder";

// Compact, collapsible answers→branches→pages overview for Step 3. Built purely
// from `ordered` (orderFlow, already in StepProps): a path breadcrumb of the
// spine questions, each branch fanning out to its target result pages (with A/B
// weights), plus any pages reached directly. Read-only — routing is authored in
// Step 2 / the Optimize view; clicking a result chip selects it in the rail.

type BranchNode = Extract<QuizDoc["nodes"][number], { type: "branch" }>;

export function ResultsFlowMap({
  doc,
  ordered,
  selectedId,
  onSelect,
}: {
  doc: QuizDoc;
  ordered: OrderedFlow;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const questions = ordered.steps.filter((s) => s.type === "question");
  const branchNodes = doc.nodes.filter((n): n is BranchNode => n.type === "branch");

  const lanesByBranch = new Map<string, OrderedLane[]>();
  for (const lane of ordered.branches) {
    const arr = lanesByBranch.get(lane.branchNodeId) ?? [];
    arr.push(lane);
    lanesByBranch.set(lane.branchNodeId, arr);
  }

  // Result pages that live inside a branch lane vs. reached directly on the spine.
  const laneResultIds = new Set(
    ordered.branches.flatMap((l) =>
      l.steps.filter((s) => s.type === "result").map((s) => s.nodeId),
    ),
  );
  const directResults = ordered.steps.filter(
    (s) => s.type === "result" && !laneResultIds.has(s.nodeId),
  );

  const chip = (nodeId: string) => {
    const n = byId.get(nodeId);
    if (!n || n.type !== "result") return null;
    const active = nodeId === selectedId;
    return (
      <button
        type="button"
        onClick={() => onSelect(nodeId)}
        className="qz-card"
        style={{
          padding: "4px 10px",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12,
          border: active ? "1.5px solid var(--qz-accent)" : "1px solid var(--qz-rule)",
          boxShadow: active ? "var(--qz-shadow-focus)" : undefined,
          whiteSpace: "nowrap",
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        ● {n.data.headline}
      </button>
    );
  };

  return (
    <div className="qz-card" style={{ padding: 14 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <div className="qz-label">Flow map</div>
        <QzButton size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </QzButton>
      </div>

      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
          {/* Path breadcrumb */}
          {questions.length > 0 ? (
            <div className="qz-row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="qz-dim" style={{ fontSize: 11 }}>
                Path
              </span>
              {questions.map((q, i) => {
                const n = byId.get(q.nodeId);
                const text = n && n.type === "question" ? n.data.text : "Question";
                return (
                  <span key={q.nodeId} className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                    {i > 0 ? <span className="qz-dim">→</span> : null}
                    <span
                      className="qz-mono qz-dim"
                      style={{
                        fontSize: 11,
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {text}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}

          {/* Branch fan-out */}
          {branchNodes.map((br) => {
            const lanes = lanesByBranch.get(br.id) ?? [];
            const total = br.data.slots.reduce((s, x) => s + (x.weight ?? 0), 0) || 1;
            return (
              <div key={br.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
                  <QzBadge tone={br.data.mode === "ab_split" ? "draft" : "ok"}>
                    {br.data.mode === "ab_split" ? "A/B" : "Branch"}
                  </QzBadge>
                  <strong style={{ fontSize: 13 }}>{br.data.label || "Branch"}</strong>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    paddingLeft: 12,
                    borderLeft: "2px solid var(--qz-rule)",
                  }}
                >
                  {br.data.slots.map((slot) => {
                    const lane = lanes.find((l) => l.slotId === slot.id);
                    const resultStep = lane?.steps.find((s) => s.type === "result");
                    const pct = Math.round(((slot.weight ?? 0) / total) * 100);
                    return (
                      <div
                        key={slot.id}
                        className="qz-row"
                        style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
                      >
                        <span className="qz-dim" style={{ fontSize: 11.5 }}>
                          {slot.label}
                          {br.data.mode === "ab_split" ? ` · ${pct}%` : ""}
                        </span>
                        <span className="qz-dim">→</span>
                        {resultStep ? (
                          chip(resultStep.nodeId)
                        ) : (
                          <span className="qz-dim" style={{ fontSize: 11.5, fontStyle: "italic" }}>
                            not wired
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Pages reached directly (no branch) */}
          {directResults.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {branchNodes.length > 0 ? (
                <span className="qz-dim" style={{ fontSize: 11 }}>
                  Direct
                </span>
              ) : null}
              <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {directResults.map((r) => (
                  <span key={r.nodeId}>{chip(r.nodeId)}</span>
                ))}
              </div>
            </div>
          ) : null}

          {ordered.steps.length === 0 ? (
            <span className="qz-dim" style={{ fontSize: 12 }}>
              Add questions in the Build view to see routing here.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
