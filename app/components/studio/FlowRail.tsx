import { useMemo, useState } from "react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { NodeIssue } from "../../lib/quizValidation";
import type { OrderedFlow } from "../../lib/flowOrder";
import { answerRoutes } from "../../lib/routeTrace";
import {
  deleteNode,
  duplicateQuestionNode,
  insertQuestionRelative,
  moveStep,
  straightThroughRun,
} from "../../lib/quizMutations";
import { INSERTABLE_MODULES, insertModule, updateNodeData, type InsertKind } from "./studioDoc";
import { NODE_LABEL } from "./panels/nodeMeta";
import { QuestionBankDrawer } from "./QuestionBankDrawer";
import { LogicFlowMap } from "../logic/LogicFlowMap";
import { QzPopover } from "../qz-overlays";
import type { BuilderCategory } from "../builder/stepProps";

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

// QZY-6 — "settings" joined for the standalone 5-rail (build-tab spec §1);
// "results" stays for deep links + the embedded switcher, but the standalone
// rail no longer offers it (result screens edit in Build).
export type WorkspaceView = "build" | "products" | "results" | "logic" | "settings";

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

// The data field nodeTitle reads for each node type — i.e. what an inline rename
// writes back. Mirror of nodeTitle so the displayed name round-trips.
function titleField(type: QuizNode["type"]): string {
  switch (type) {
    case "question":
    case "message":
      return "text";
    case "ask_ai":
      return "persona_name";
    case "branch":
    case "integration":
      return "label";
    default:
      return "headline";
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
  confirmDeleteId,
  onConfirmDelete,
  hideViewSwitcher,
  variant = "classic",
  categories = [],
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
  // Armed-delete state lifted to the workspace so a Delete/Backspace keystroke on
  // the selected step can arm the same two-step confirm (UnifiedWorkspace owns it).
  confirmDeleteId: string | null;
  onConfirmDelete: (nodeId: string | null) => void;
  // Standalone hides FlowRail's own view switcher — the builder chrome's nav
  // rail carries the views instead. The embedded `body` layout (no top bar)
  // keeps it as the primary view nav.
  hideViewSwitcher?: boolean;
  // BLD-2 — "v3" renders the questionsLogicV3 row anatomy (26px mono chip +
  // connector + 2-line-clamped title, gold decider chip) with the row actions
  // in a portaled ⋯ menu instead of inline buttons. Standalone-only opt-in;
  // the embedded surface keeps the classic rows untouched.
  variant?: "classic" | "v3";
  // B4 — the confirmed buckets, so the Flow View's result cards can show each
  // page's bound bucket + size. Optional (defaults []) for any future caller.
  categories?: BuilderCategory[];
}) {
  const [adding, setAdding] = useState(false);
  // Question Bank drawer (B5) — a searchable library of pre-built questions.
  const [bankOpen, setBankOpen] = useState(false);
  // BLD-2 (v3) — which row's ⋯ actions menu is open (one at a time).
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // B4 — swap the step list for a read-only skip-logic diagram (LogicFlowMap).
  const [showFlowView, setShowFlowView] = useState(false);
  // Inline rename: the node being renamed + the working value (double-click a row).
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const run = straightThroughRun(doc).run;
  const runIndex = new Map(run.map((id, i) => [id, i]));
  // Question-Builder spec — 1-based question number in flow order (for the
  // row's number badge). Only question nodes are counted.
  const questionNumber = new Map<string, number>();
  let qn = 0;
  for (const id of run) {
    if (byId.get(id)?.type === "question") questionNumber.set(id, ++qn);
  }

  const duplicate = (nodeId: string) => {
    const next = duplicateQuestionNode(doc, nodeId);
    onCommit(next);
  };
  const insertRelative = (refId: string, where: "above" | "below") => {
    onCommit(insertQuestionRelative(doc, refId, where));
  };

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

  const startRename = (node: QuizNode) => {
    onConfirmDelete(null);
    setRenameVal(nodeTitle(node));
    setRenaming(node.id);
  };
  const commitRename = (node: QuizNode) => {
    const v = renameVal.trim();
    if (v && v !== nodeTitle(node)) {
      onCommit(updateNodeData(doc, node.id, { [titleField(node.type)]: v }));
    }
    setRenaming(null);
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
            onConfirmDelete(null); // navigating away disarms a pending delete
            onSelect(sel ? null : nodeId);
          }}
          onDoubleClick={() => startRename(node)}
          role="button"
          aria-pressed={sel}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onConfirmDelete(null);
              onSelect(sel ? null : nodeId);
            }
          }}
        >
          <span
            aria-hidden
            title={questionNumber.has(nodeId) ? `Question ${questionNumber.get(nodeId)}` : undefined}
            style={{
              width: 18,
              textAlign: "center",
              fontSize: questionNumber.has(nodeId) && currentId !== nodeId ? 10.5 : 11,
              opacity: 0.7,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {currentId === nodeId
              ? "▸"
              : questionNumber.has(nodeId)
                ? questionNumber.get(nodeId)
                : GLYPH[node.type]}
          </span>
          {renaming === nodeId ? (
            <input
              className="qz-input"
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename(node);
                else if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={() => commitRename(node)}
              style={{ flex: 1, minWidth: 0, fontSize: 12.5, height: 26, padding: "0 6px" }}
            />
          ) : (
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
              title={`${nodeTitle(node)} — double-click to rename`}
            >
              {nodeTitle(node)}
            </span>
          )}
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
              {node.type === "question" ? (
                <>
                  <button
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title="Add question above"
                    aria-label={`Add a question above ${nodeTitle(node)}`}
                    onClick={() => insertRelative(nodeId, "above")}
                    style={{ padding: "0 4px" }}
                  >
                    ＋↑
                  </button>
                  <button
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title="Add question below"
                    aria-label={`Add a question below ${nodeTitle(node)}`}
                    onClick={() => insertRelative(nodeId, "below")}
                    style={{ padding: "0 4px" }}
                  >
                    ＋↓
                  </button>
                  <button
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title="Duplicate question"
                    aria-label={`Duplicate ${nodeTitle(node)}`}
                    onClick={() => duplicate(nodeId)}
                    style={{ padding: "0 4px" }}
                  >
                    ⧉
                  </button>
                </>
              ) : null}
              {node.type !== "intro" ? (
                confirmDeleteId === nodeId ? (
                  <>
                    <button
                      className="qz-btn qz-btn-sm"
                      title="Confirm delete"
                      aria-label={`Confirm delete ${nodeTitle(node)}`}
                      onClick={() => {
                        remove(nodeId);
                        onConfirmDelete(null);
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
                      onClick={() => onConfirmDelete(null)}
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
                    onClick={() => onConfirmDelete(nodeId)}
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

  // ── BLD-2 — the v3 row: 26px mono number chip (gold when the question
  // decides the result, ✉/◆ tints for capture/result termini), 2-line-clamped
  // title, red issue dot, and ONE ⋯ menu (QzPopover → document.body, so the
  // scrollable panel can't clip it — the overlay-portal lesson) holding the
  // actions the classic row crammed inline (＋↑ ＋↓ ⧉ ✕ truncated the title).
  // The two-step delete confirm lives inside the menu; closing it disarms.
  const menuItem = (
    label: string,
    onClick: () => void,
    opts?: { destructive?: boolean },
  ) => (
    <button
      type="button"
      className={`qz-railmenu-item${opts?.destructive ? " is-crit" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );

  const rowV3 = (nodeId: string, indent = 0) => {
    const node = byId.get(nodeId);
    if (!node) return null;
    const sel = selectedId === nodeId;
    const issues = issuesByNode.get(nodeId)?.length ?? 0;
    const movable = runIndex.has(nodeId) && node.type !== "intro";
    const qNum = questionNumber.get(nodeId);
    const isDecider =
      node.type === "question" && (node.data as Record<string, unknown>).role === "decides";
    const chipClass = isDecider
      ? " is-decider"
      : node.type === "email_gate"
        ? " is-capture"
        : node.type === "result" || node.type === "end"
          ? " is-reveal"
          : "";
    const armed = confirmDeleteId === nodeId;
    const selectRow = () => {
      onConfirmDelete(null);
      onSelect(sel ? null : nodeId);
    };
    return (
      <div key={nodeId} style={{ marginLeft: indent ? 14 : 0 }}>
        <div
          className={`qz-s3-row qz-railrow${sel ? " is-active" : ""}${currentId === nodeId ? " is-current" : ""}`}
          onClick={selectRow}
          onDoubleClick={() => startRename(node)}
          role="button"
          aria-pressed={sel}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectRow();
            }
          }}
        >
          <span
            className={`qz-s3-numchip${chipClass}`}
            aria-hidden
            title={
              isDecider
                ? "The deciding question"
                : qNum
                  ? `Question ${qNum}`
                  : NODE_LABEL[node.type]
            }
          >
            {qNum ?? GLYPH[node.type]}
          </span>
          {renaming === nodeId ? (
            <input
              className="qz-input"
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename(node);
                else if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={() => commitRename(node)}
              style={{ flex: 1, minWidth: 0, fontSize: 12.5, height: 26, padding: "0 6px" }}
            />
          ) : (
            <span
              className="qz-s3-rowtitle"
              style={{ flex: "1 1 auto" }}
              title={`${nodeTitle(node)} — double-click to rename`}
            >
              {nodeTitle(node)}
            </span>
          )}
          {issues > 0 ? (
            <span className="qz-raildot" title={`${issues} issue${issues > 1 ? "s" : ""} to fix`} />
          ) : null}
          <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <QzPopover
              open={menuOpenId === nodeId}
              onOpenChange={(o) => {
                setMenuOpenId(o ? nodeId : null);
                if (!o) onConfirmDelete(null);
              }}
              placement="bottom"
              maxWidth={200}
              trigger={
                <button
                  type="button"
                  className={`qz-railmenu-btn${menuOpenId === nodeId ? " is-open" : ""}`}
                  aria-label={`Step actions for ${nodeTitle(node)}`}
                >
                  ⋯
                </button>
              }
              content={
                <div className="qz-railmenu">
                  {menuItem("Rename", () => {
                    setMenuOpenId(null);
                    startRename(node);
                  })}
                  {movable
                    ? menuItem("Move up", () => move(nodeId, -1))
                    : null}
                  {movable
                    ? menuItem("Move down", () => move(nodeId, 1))
                    : null}
                  {node.type === "question"
                    ? menuItem("Add question above", () => {
                        setMenuOpenId(null);
                        insertRelative(nodeId, "above");
                      })
                    : null}
                  {node.type === "question"
                    ? menuItem("Add question below", () => {
                        setMenuOpenId(null);
                        insertRelative(nodeId, "below");
                      })
                    : null}
                  {node.type === "question"
                    ? menuItem("Duplicate", () => {
                        setMenuOpenId(null);
                        duplicate(nodeId);
                      })
                    : null}
                  {node.type !== "intro" ? (
                    armed ? (
                      <>
                        {menuItem(
                          "Confirm delete",
                          () => {
                            setMenuOpenId(null);
                            onConfirmDelete(null);
                            remove(nodeId);
                          },
                          { destructive: true },
                        )}
                        {menuItem("Cancel", () => onConfirmDelete(null))}
                      </>
                    ) : (
                      menuItem("Delete…", () => onConfirmDelete(nodeId), { destructive: true })
                    )
                  ) : null}
                </div>
              }
            />
          </span>
        </div>
        {node.type === "question" ? (
          <div style={{ marginLeft: 34 }}>
            <RouteBadges doc={doc} nodeId={nodeId} />
          </div>
        ) : null}
      </div>
    );
  };

  const renderRow = variant === "v3" ? rowV3 : row;

  return (
    <div className="qz-card" style={{ padding: 10, position: "sticky", top: 8 }}>
      {!hideViewSwitcher && (
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
      )}

      {view === "build" ? (
        <>
          <div className="qz-row qz-row-between" style={{ marginBottom: 8 }}>
            <span className="qz-label" style={{ fontSize: 11 }}>
              {showFlowView ? "Flow diagram" : "Steps"}
            </span>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              aria-pressed={showFlowView}
              aria-label="Toggle between the step list and the flow diagram"
              title="See how answers route to result pages"
              onClick={() => setShowFlowView((v) => !v)}
            >
              {showFlowView ? "Edit view" : "Flow view"}
            </button>
          </div>
          {showFlowView ? (
            <div className="qz-railflow" style={{ maxHeight: "62vh", overflowY: "auto" }}>
              <LogicFlowMap
                doc={doc}
                categories={categories}
                selectedNodeId={selectedId}
                onSelectResult={(id) => {
                  // Read-only diagram: clicking a result page selects it and
                  // drops back to the edit list focused on that node.
                  onSelect(id);
                  setShowFlowView(false);
                }}
              />
            </div>
          ) : (
            <>
          <div
            className={variant === "v3" ? "qz-s3-flow" : undefined}
            style={{ display: "flex", flexDirection: "column", gap: variant === "v3" ? 4 : 2, maxHeight: "62vh", overflowY: "auto" }}
          >
            {ordered.steps.map((s) => renderRow(s.nodeId))}
            {ordered.branches.map((lane) =>
              lane.steps.length > 0 ? (
                <div key={lane.laneId} style={{ marginTop: 2 }}>
                  <div className="qz-dim" style={{ fontSize: 10.5, margin: "4px 0 2px 22px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    ⑂ {lane.slotLabel}
                  </div>
                  {lane.steps.map((s) => renderRow(s.nodeId, 1))}
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
              {ordered.orphans.map((id) => renderRow(id))}
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
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => setAdding(true)}
                  title="Insert a step after the selected one"
                >
                  + Add step
                </button>
                <button
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  onClick={() => setBankOpen(true)}
                  title="Browse a library of pre-built questions"
                >
                  Question library
                </button>
              </div>
            )}
          </div>
            </>
          )}
          {bankOpen ? (
            <QuestionBankDrawer
              doc={doc}
              onCommit={onCommit}
              onClose={() => setBankOpen(false)}
            />
          ) : null}
        </>
      ) : (
        <p className="qz-dim" style={{ fontSize: 12, margin: "4px 2px" }}>
          {view === "products"
            ? "Group your catalog into recommendations — they become the result pages answers route to."
            : view === "results"
              ? "Design the result pages: layout model, ranking rules, and discounts."
              : "Recommendation mapping, path testing, and A/B splits."}
        </p>
      )}
    </div>
  );
}
