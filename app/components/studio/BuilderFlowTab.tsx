import { useMemo, useState } from "react";
import type { Quiz, QuizNode, ContentBlock } from "../../lib/quizSchema";
import type { OrderedFlow } from "../../lib/flowOrder";
import type { NodeIssue } from "../../lib/quizValidation";
import { moveStep, straightThroughRun } from "../../lib/quizMutations";
import {
  INSERTABLE_MODULES,
  insertModule,
  PALETTE_BLOCKS,
  blockMove,
  blockRemove,
  blockReorder,
  blockUpdate,
  setNodeLayout,
  type InsertKind,
} from "./studioDoc";
import { currentLayout } from "./BuilderBlocksPalette";
import { QzPopover } from "../qz-overlays";

// ════════════════════════════════════════════════════════════════════════════
// BuilderFlowTab (QRTZ-H4) — the mock s16 ed-panel Flow tab (shared.mjs
// 611–629): the ONE tree that is both the screen switcher and the layer
// tree. Step rows are the mock's .tree-row anatomy — twisty · number chip ·
// role name (+ .tree-sub) · Fix dot — and the ACTIVE screen's row is open,
// its blocks nested under it as .tree-kid rows (glyph letter + label).
// "Add a step" closes the panel at the foot (mock .add-step).
//
// It absorbs the retired ScreenCarousel (screen select / add / two-step
// delete naming the impact / duplicate) and BuilderLayersTab (block select /
// drag-reorder / hide / delete — the SAME studioDoc ops, identical results).
// Step actions the mock's static rows can't draw live in a hover-revealed
// ⋯ menu (the FlowRail v3 pattern; QzPopover portals to body — the
// builder-overlay-portal lesson).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

/** spec §3 — the delete warning names the impact: rules referencing the
 *  question + the answer mappings that will be removed. (Moved from the
 *  retired ScreenCarousel, verbatim.) */
export function deleteImpactCopy(doc: QuizDoc, node: QuizNode): string {
  if (node.type !== "question") return "Delete this screen?";
  const ruleCount = (doc.decision_rules ?? []).filter((r) =>
    r.conditions.some((c) => c.question_id === node.id),
  ).length;
  const mapped = node.data.answers.filter((a) => a.target_id).length;
  // Each part is a self-contained clause so any subset joins grammatically
  // after the shared "Delete?" stem.
  const parts: string[] = [];
  if (ruleCount > 0) parts.push(`This question is used in ${ruleCount} rule${ruleCount === 1 ? "" : "s"}`);
  if (mapped > 0) parts.push(`${mapped} mapping${mapped === 1 ? "" : "s"} will be removed`);
  return parts.length ? `Delete? ${parts.join(" · ")}.` : "Delete this question?";
}

/** The mock tree's role vocabulary (FLOW_TREE: "Intro page" · "Q1 · Skin
 *  type" · "Email capture" · "Results"). Questions carry their text. */
function screenName(node: QuizNode, qNum: number | null): string {
  switch (node.type) {
    case "intro":
      return "Intro page";
    case "question": {
      const t = typeof node.data.text === "string" ? node.data.text.trim() : "";
      return t ? `Q${qNum ?? "?"} · ${t}` : `Q${qNum ?? "?"}`;
    }
    case "email_gate":
      return "Email capture";
    case "result":
      return "Results";
    case "end":
      return "End";
    case "message":
      return "Message";
    case "ask_ai":
      return "Ask AI";
    case "product_cards":
      return "Products";
    case "integration":
      return "Integration";
    case "branch":
      return "Branch";
  }
}

/** mock .tree-sub — derived, never guessed: a multi-page result names its
 *  page count; an explicit node_layouts composition names its block count. */
function stepSub(doc: QuizDoc, node: QuizNode): string | null {
  if (node.type === "result" && node.data.stages.length > 1) {
    return `${node.data.stages.length} pages`;
  }
  const blocks = doc.node_layouts[node.id]?.length ?? 0;
  if (blocks > 0) return `${blocks} block${blocks === 1 ? "" : "s"}`;
  return null;
}

const KID_LABEL = new Map(PALETTE_BLOCKS.map((b) => [b.type, b.label]));

/** mock .kid-g — a single glyph letter (H · T · B). */
function kidGlyph(block: ContentBlock): string {
  const label = KID_LABEL.get(block.type) ?? block.type;
  return label.charAt(0).toUpperCase();
}

export function BuilderFlowTab({
  doc,
  ordered,
  issuesByNode,
  activeId,
  selectedBlockId,
  onSelectScreen,
  onSelectBlock,
  commit,
  fallbackCollection,
  confirmDeleteId,
  onConfirmDelete,
  onDelete,
  onDuplicate,
}: {
  doc: QuizDoc;
  ordered: OrderedFlow;
  issuesByNode: Map<string, NodeIssue[]>;
  /** The screen the canvas shows (selection first, live step second) — the
   *  tree's ONE open row. */
  activeId: string | null;
  /** The canvas block selection (blockSel), mirrored as the kid .is-sel. */
  selectedBlockId: string | null;
  onSelectScreen: (nodeId: string) => void;
  onSelectBlock: (nodeId: string, blockId: string) => void;
  commit: (doc: QuizDoc) => void;
  fallbackCollection: string;
  /** Two-step delete: the armed node id (lifted; the keyboard flow arms it). */
  confirmDeleteId: string | null;
  onConfirmDelete: (nodeId: string | null) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // BT4 — kid drag-to-reorder (the BuilderLayersTab pattern, kept).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);
  const run = straightThroughRun(doc).run;
  const runIndex = new Map(run.map((id, i) => [id, i]));

  // The spine in column order + branch lanes appended, so no screen is
  // unreachable from the tree (the ScreenCarousel reachability contract).
  const screens = useMemo(() => {
    const ids = ordered.steps.map((s) => s.nodeId);
    for (const lane of ordered.branches) for (const s of lane.steps) ids.push(s.nodeId);
    const nodes = ids
      .map((id) => byId.get(id))
      .filter((n): n is QuizNode => Boolean(n));
    let q = 0;
    return nodes.map((node, i) => ({
      node,
      n: i + 1,
      qNum: node.type === "question" ? ++q : null,
    }));
  }, [ordered, byId]);

  const move = (nodeId: string, dir: -1 | 1) => {
    const i = runIndex.get(nodeId);
    if (i === undefined) return;
    // moveStep places nodeId BEFORE the given id (null = end of run).
    const beforeId = dir === -1 ? run[i - 1] ?? null : run[i + 2] ?? null;
    if (dir === -1 && i === 0) return;
    commit(moveStep(doc, nodeId, beforeId));
  };

  const insert = (kind: InsertKind) => {
    // After the active step when it's on the spine; else at the end of the
    // MOVABLE run (the add-anchor rule — never the ordered spine's terminal).
    const anchor =
      activeId && runIndex.has(activeId) ? activeId : run[run.length - 1] ?? null;
    const { doc: next, newNodeId } = insertModule(doc, kind, anchor, undefined, fallbackCollection);
    commit(next);
    setAdding(false);
    if (newNodeId) onSelectScreen(newNodeId);
  };

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

  return (
    <div className="qz-flowtab">
      <ul className="qz-ftree">
        {screens.map(({ node, n, qNum }) => {
          const open = node.id === activeId;
          const name = screenName(node, qNum);
          const sub = stepSub(doc, node);
          const issues = issuesByNode.get(node.id)?.length ?? 0;
          const movable = runIndex.has(node.id) && node.type !== "intro";
          const armed = confirmDeleteId === node.id;
          const kids = open ? currentLayout(doc, node) : [];
          const applyKids = (next: ContentBlock[]) =>
            commit(setNodeLayout(doc, node.id, next));
          return (
            <li key={node.id}>
              <div className={`qz-ftree-row${open ? " is-open" : ""}`}>
                {/* One real <button> owns the row's interactive area (no
                    role=button wrapper — the ⋯ menu inside would nest
                    interactives); flag + menu sit beside it. */}
                <button
                  type="button"
                  className="qz-ftree-rowmain"
                  aria-expanded={open}
                  onClick={() => {
                    onConfirmDelete(null);
                    onSelectScreen(node.id);
                  }}
                >
                  <span className="qz-ftree-tw" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="qz-ftree-n" aria-hidden="true">
                    {n}
                  </span>
                  <span className="qz-ftree-name" title={name}>
                    {name}
                    {sub ? <span className="qz-ftree-sub"> {sub}</span> : null}
                  </span>
                </button>
                {issues > 0 ? (
                  <span
                    className="qz-ftree-flag"
                    title={`Fix — ${issues} issue${issues > 1 ? "s" : ""}`}
                  />
                ) : null}
                <span className="qz-ftree-rowact">
                  <QzPopover
                    open={menuOpenId === node.id}
                    onOpenChange={(o) => {
                      setMenuOpenId(o ? node.id : null);
                      if (!o) onConfirmDelete(null);
                    }}
                    placement="bottom"
                    maxWidth={200}
                    trigger={
                      <button
                        type="button"
                        className={`qz-railmenu-btn${menuOpenId === node.id ? " is-open" : ""}`}
                        aria-label={`Step actions for ${name}`}
                      >
                        ⋯
                      </button>
                    }
                    content={
                      <div className="qz-railmenu">
                        {movable ? menuItem("Move up", () => move(node.id, -1)) : null}
                        {movable ? menuItem("Move down", () => move(node.id, 1)) : null}
                        {node.type === "question"
                          ? menuItem("Duplicate", () => {
                              setMenuOpenId(null);
                              onDuplicate(node.id);
                            })
                          : null}
                        {node.type !== "intro"
                          ? menuItem(
                              "Delete…",
                              () => {
                                setMenuOpenId(null);
                                onConfirmDelete(node.id);
                              },
                              { destructive: true },
                            )
                          : null}
                      </div>
                    }
                  />
                </span>
              </div>
              {armed && node.type !== "intro" ? (
                <div className="qz-ftree-confirm" role="alertdialog">
                  <span>{deleteImpactCopy(doc, node)}</span>
                  <button
                    type="button"
                    className="qz-ftree-confirm-yes"
                    onClick={() => onDelete(node.id)}
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => onConfirmDelete(null)}>
                    Keep
                  </button>
                </div>
              ) : null}
              {open && kids.length > 0 ? (
                <ul className="qz-ftree-kids">
                  {kids.map((b, i) => (
                    <li
                      key={b.id}
                      className={`qz-ftree-kid${b.id === selectedBlockId ? " is-sel" : ""}${
                        b.hidden ? " is-hidden" : ""
                      }${dragId === b.id ? " is-dragging" : ""}${
                        overIndex === i && dragId && dragId !== b.id ? " is-drop-target" : ""
                      }`}
                      draggable
                      onDragStart={(e) => {
                        setDragId(b.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (overIndex !== i) setOverIndex(i);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId && dragId !== b.id) applyKids(blockReorder(kids, dragId, i));
                        setDragId(null);
                        setOverIndex(null);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverIndex(null);
                      }}
                    >
                      <button
                        type="button"
                        className="qz-ftree-kidmain"
                        title={KID_LABEL.get(b.type) ?? b.type}
                        onClick={() => onSelectBlock(node.id, b.id)}
                      >
                        <span className="qz-ftree-kidg" aria-hidden="true">
                          {kidGlyph(b)}
                        </span>
                        <span className="qz-ftree-kidname">
                          {KID_LABEL.get(b.type) ?? b.type}
                        </span>
                      </button>
                      <span className="qz-ftree-kidact" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={b.hidden ? "Show block" : "Hide block"}
                          title={b.hidden ? "Show" : "Hide"}
                          onClick={() =>
                            applyKids(blockUpdate(kids, b.id, { hidden: b.hidden ? undefined : true }))
                          }
                        >
                          {b.hidden ? "🚫" : "👁"}
                        </button>
                        <button
                          type="button"
                          aria-label="Move block up"
                          disabled={i === 0}
                          onClick={() => applyKids(blockMove(kids, b.id, -1))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label="Move block down"
                          disabled={i === kids.length - 1}
                          onClick={() => applyKids(blockMove(kids, b.id, 1))}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label="Delete block"
                          onClick={() => applyKids(blockRemove(kids, b.id))}
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div className="qz-ftree-adder">
          {INSERTABLE_MODULES.map((m) => (
            <button
              key={m.kind}
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              title={m.hint}
              onClick={() => insert(m.kind)}
            >
              {m.glyph} {m.label}
            </button>
          ))}
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="qz-ftree-addstep"
        onClick={() => setAdding((v) => !v)}
      >
        Add a step
      </button>
    </div>
  );
}
