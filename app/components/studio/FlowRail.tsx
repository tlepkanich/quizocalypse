import { useMemo, useState } from "react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { NodeIssue } from "../../lib/quizValidation";
import type { OrderedFlow } from "../../lib/flowOrder";
import { answerRoutes } from "../../lib/routeTrace";
import { deleteNode, moveStep, straightThroughRun } from "../../lib/quizMutations";
import { INSERTABLE_MODULES, insertModule, type InsertKind } from "./studioDoc";
import { NODE_LABEL } from "./panels/nodeMeta";

// Per-answer divergence chips ("answer → destination") — shown under question
// rows whenever a question's answers route to different places. Moved here
// from the retired StudioBuilder (Unified P8); FlowRail is the sole consumer.
function RouteBadges({ doc, nodeId }: { doc: QuizDoc; nodeId: string }) {
  const routes = useMemo(() => answerRoutes(doc, nodeId), [doc, nodeId]);
  if (routes.length === 0) return null;
  return (
    <div
      className="qz-row"
      style={{ gap: 6, flexWrap: "wrap", padding: "8px 12px 10px", justifyContent: "center" }}
    >
      {routes.map((r) => (
        <span
          key={r.answerId}
          className="qz-dim"
          style={{
            fontSize: 10.5,
            border: "1px solid var(--qz-rule, #e5e5e5)",
            borderRadius: 999,
            padding: "2px 8px",
            background: "var(--qz-paper, #faf8f3)",
            whiteSpace: "nowrap",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={`“${r.answerText}” routes to: ${r.targetLabel}`}
        >
          “{r.answerText.length > 16 ? `${r.answerText.slice(0, 15)}…` : r.answerText}” → {r.targetLabel}
        </span>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FlowRail (Unified P2) — the left-hand flow hierarchy of the unified
// workspace: a compact, always-visible list of every step (Octane's left-nav
// pattern), with branch lanes indented, orphans surfaced, and add / reorder /
// delete inline. Selecting a row drives the ContextPanel; the heavy lifting
// (orderFlow, moveStep, insertModule, deleteNode) is all existing pure code.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

export type WorkspaceView = "build" | "products" | "results" | "logic";

const GLYPH: Record<QuizNode["type"], string> = {
  intro: "▶",
  question: "?",
  email_gate: "✉",
  result: "★",
  message: "“",
  end: "◼",
  branch: "⑂",
  ask_ai: "✦",
  integration: "⚙",
  product_cards: "▦",
};

// One-line merchant-readable summary per node.
function nodeTitle(node: QuizNode): string {
  const d = node.data as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (node.type) {
    case "question":
      return s("text") || "Untitled question";
    case "message":
      return s("text") || "Message";
    case "ask_ai":
      return s("persona_name") || "Ask AI";
    case "branch":
    case "integration":
      return s("label") || NODE_LABEL[node.type];
    default:
      return s("headline") || NODE_LABEL[node.type];
  }
}

export function FlowRail({
  doc,
  ordered,
  issuesByNode,
  selectedId,
  currentId,
  onSelect,
  onCommit,
  fallbackCollection,
  view,
  onView,
}: {
  doc: QuizDoc;
  ordered: OrderedFlow;
  issuesByNode: Map<string, NodeIssue[]>;
  selectedId: string | null;
  // The step the live preview is showing right now (Unified P3) — gets a ▸
  // marker so walking the quiz keeps the rail oriented.
  currentId?: string | null;
  onSelect: (nodeId: string | null) => void;
  onCommit: (doc: QuizDoc) => void;
  fallbackCollection: string;
  view: WorkspaceView;
  onView: (v: WorkspaceView) => void;
}) {
  const [adding, setAdding] = useState(false);
  // The node whose delete is armed (two-step confirm before the destructive op).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const run = straightThroughRun(doc).run;
  const runIndex = new Map(run.map((id, i) => [id, i]));

  const insert = (kind: InsertKind) => {
    // Insert after the selected step when it's on the spine; else at the end.
    const anchor =
      selectedId && runIndex.has(selectedId) ? selectedId : run[run.length - 1] ?? null;
    const { doc: next, newNodeId } = insertModule(doc, kind, anchor, undefined, fallbackCollection);
    onCommit(next);
    setAdding(false);
    if (newNodeId) onSelect(newNodeId);
  };

  const move = (nodeId: string, dir: -1 | 1) => {
    const i = runIndex.get(nodeId);
    if (i === undefined) return;
    // moveStep places nodeId BEFORE the given id (null = end of run).
    const beforeId = dir === -1 ? run[i - 1] ?? null : run[i + 2] ?? null;
    if (dir === -1 && i === 0) return;
    onCommit(moveStep(doc, nodeId, beforeId));
  };

  const remove = (nodeId: string) => {
    onCommit(deleteNode(doc, nodeId));
    if (selectedId === nodeId) onSelect(null);
  };

  const row = (nodeId: string, indent = 0) => {
    const node = byId.get(nodeId);
    if (!node) return null;
    const sel = selectedId === nodeId;
    const issues = issuesByNode.get(nodeId)?.length ?? 0;
    const movable = runIndex.has(nodeId) && node.type !== "intro";
    return (
      <div key={nodeId} style={{ marginLeft: indent ? 14 : 0 }}>
        <div
          className="qz-row"
          style={{
            gap: 6,
            alignItems: "center",
            padding: "5px 8px",
            borderRadius: 8,
            cursor: "pointer",
            background: sel ? "color-mix(in srgb, var(--qz-accent, #2a6df4) 10%, transparent)" : undefined,
            border: sel ? "1px solid var(--qz-accent, #2a6df4)" : "1px solid transparent",
          }}
          onClick={() => {
            setConfirmDelete(null); // navigating away disarms a pending delete
            onSelect(sel ? null : nodeId);
          }}
          role="button"
          aria-pressed={sel}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setConfirmDelete(null);
              onSelect(sel ? null : nodeId);
            }
          }}
        >
          <span aria-hidden style={{ width: 16, textAlign: "center", fontSize: 11, opacity: 0.7 }}>
            {currentId === nodeId ? "▸" : GLYPH[node.type]}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontWeight: sel ? 600 : 400,
            }}
            title={nodeTitle(node)}
          >
            {nodeTitle(node)}
          </span>
          {issues > 0 ? (
            <span
              title={`${issues} issue${issues > 1 ? "s" : ""} to fix`}
              style={{ width: 8, height: 8, borderRadius: 999, background: "#D72C0D", flex: "0 0 auto" }}
            />
          ) : null}
          {sel ? (
            <span className="qz-row" style={{ gap: 1 }} onClick={(e) => e.stopPropagation()}>
              {movable ? (
                <>
                  <button
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title="Move up"
                    aria-label={`Move ${nodeTitle(node)} up`}
                    onClick={() => move(nodeId, -1)}
                    style={{ padding: "0 4px" }}
                  >
                    ↑
                  </button>
                  <button
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title="Move down"
                    aria-label={`Move ${nodeTitle(node)} down`}
                    onClick={() => move(nodeId, 1)}
                    style={{ padding: "0 4px" }}
                  >
                    ↓
                  </button>
                </>
              ) : null}
              {node.type !== "intro" ? (
                confirmDelete === nodeId ? (
                  <>
                    <button
                      className="qz-btn qz-btn-sm"
                      title="Confirm delete"
                      aria-label={`Confirm delete ${nodeTitle(node)}`}
                      onClick={() => {
                        remove(nodeId);
                        setConfirmDelete(null);
                      }}
                      style={{
                        padding: "0 7px",
                        color: "#fff",
                        background: "#D72C0D",
                        borderColor: "#D72C0D",
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="qz-btn qz-btn-ghost qz-btn-sm"
                      title="Cancel"
                      aria-label={`Cancel deleting ${nodeTitle(node)}`}
                      onClick={() => setConfirmDelete(null)}
                      style={{ padding: "0 4px" }}
                    >
                      ↩
                    </button>
                  </>
                ) : (
                  <button
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title="Delete step"
                    aria-label={`Delete ${nodeTitle(node)}`}
                    onClick={() => setConfirmDelete(nodeId)}
                    style={{ padding: "0 4px" }}
                  >
                    ✕
                  </button>
                )
              ) : null}
            </span>
          ) : null}
        </div>
        {node.type === "question" ? (
          <div style={{ marginLeft: 22 }}>
            <RouteBadges doc={doc} nodeId={nodeId} />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="qz-card" style={{ padding: 10, position: "sticky", top: 8 }}>
      <div className="qz-segmented qz-segmented--fill" role="group" aria-label="Workspace view" style={{ width: "100%", marginBottom: 10 }}>
        <button type="button" aria-pressed={view === "build"} onClick={() => onView("build")}>
          Build
        </button>
        <button type="button" aria-pressed={view === "products"} onClick={() => onView("products")}>
          Products
        </button>
        <button type="button" aria-pressed={view === "results"} onClick={() => onView("results")}>
          Results
        </button>
        <button type="button" aria-pressed={view === "logic"} onClick={() => onView("logic")}>
          Logic
        </button>
      </div>

      {view === "build" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "62vh", overflowY: "auto" }}>
            {ordered.steps.map((s) => row(s.nodeId))}
            {ordered.branches.map((lane) =>
              lane.steps.length > 0 ? (
                <div key={lane.laneId} style={{ marginTop: 2 }}>
                  <div className="qz-dim" style={{ fontSize: 10.5, margin: "4px 0 2px 22px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    ⑂ {lane.slotLabel}
                  </div>
                  {lane.steps.map((s) => row(s.nodeId, 1))}
                </div>
              ) : null,
            )}
          </div>

          {ordered.orphans.length > 0 ? (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--qz-rule, #00000014)" }}>
              <div className="qz-row qz-row-between" style={{ alignItems: "center", marginBottom: 4 }}>
                <span className="qz-dim" style={{ fontSize: 11 }}>
                  Unreachable ({ordered.orphans.length})
                </span>
                <button
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  onClick={() => {
                    let next = doc;
                    for (const id of ordered.orphans) next = deleteNode(next, id);
                    onCommit(next);
                    if (selectedId && ordered.orphans.includes(selectedId)) onSelect(null);
                  }}
                >
                  Clean up
                </button>
              </div>
              {ordered.orphans.map((id) => row(id))}
            </div>
          ) : null}

          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--qz-rule, #00000014)" }}>
            {adding ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {INSERTABLE_MODULES.map((m) => (
                  <button
                    key={m.kind}
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title={m.hint}
                    onClick={() => insert(m.kind)}
                  >
                    {m.glyph} {m.label}
                  </button>
                ))}
                <button className="qz-btn qz-btn-ghost qz-btn-sm" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="qz-btn qz-btn-ghost qz-btn-sm"
                style={{ width: "100%" }}
                onClick={() => setAdding(true)}
                title="Insert a step after the selected one"
              >
                + Add step
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="qz-dim" style={{ fontSize: 12, margin: "4px 2px" }}>
          {view === "products"
            ? "Group your catalog into buckets — they become the result pages answers route to."
            : view === "results"
              ? "Design the result pages: layout model, ranking rules, and discounts."
              : "Recommendation mapping, path testing, and A/B splits."}
        </p>
      )}
    </div>
  );
}
