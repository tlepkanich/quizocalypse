import { useMemo } from "react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { OrderedFlow } from "../../lib/flowOrder";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import { StepPreview } from "../runtime/StepPreview";

// ════════════════════════════════════════════════════════════════════════════
// ScreenCarousel (QZY-7, build-tab spec §2) — the filmstrip of every screen at
// the bottom of the CENTER column only: live mini-previews (StepPreview, the
// same non-interactive renderer the inspector thumbnail uses) with labels
// (Intro · Q1 · Q2 · Email · Result), click-to-load, active outline, and a
// + tile that adds a question screen. Thumbnails re-render from the doc, so
// they update live as content changes.
//
// Screen delete lives here too (the FlowRail rows left the Build panel): the
// ✕ on the active thumbnail ARMS a two-step confirm that names the impact
// ("in N rules — mappings will be removed", spec §3) before deleting.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

function screenLabel(node: QuizNode, qIndex: number | null): string {
  switch (node.type) {
    case "intro":
      return "Intro";
    case "question":
      return `Q${qIndex ?? "?"}`;
    case "email_gate":
      return "Email";
    case "result":
      return "Result";
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

/** spec §3 — the delete warning names the impact: rules referencing the
 *  question + the answer mappings that will be removed. */
export function deleteImpactCopy(doc: QuizDoc, node: QuizNode): string {
  if (node.type !== "question") return "Delete this screen?";
  const ruleCount = (doc.decision_rules ?? []).filter((r) =>
    r.conditions.some((c) => c.question_id === node.id),
  ).length;
  const mapped = node.data.answers.filter((a) => a.target_id).length;
  const parts: string[] = [];
  if (ruleCount > 0) parts.push(`in ${ruleCount} rule${ruleCount === 1 ? "" : "s"}`);
  if (mapped > 0) parts.push(`${mapped} mapping${mapped === 1 ? "" : "s"} will be removed`);
  return parts.length ? `Delete? This question is ${parts.join(" · ")}.` : "Delete this question?";
}

export function ScreenCarousel({
  doc,
  ordered,
  activeId,
  onSelect,
  onAddScreen,
  confirmDeleteId,
  onConfirmDelete,
  onDelete,
  onDuplicate,
  productIndex,
  categories,
}: {
  doc: QuizDoc;
  ordered: OrderedFlow;
  /** The screen the canvas is showing (selection first, live step second). */
  activeId: string | null;
  onSelect: (nodeId: string) => void;
  onAddScreen: () => void;
  /** Two-step delete: the armed node id (lifted, same state the keyboard flow arms). */
  confirmDeleteId: string | null;
  onConfirmDelete: (nodeId: string | null) => void;
  onDelete: (nodeId: string) => void;
  /** Question screens only (the FlowRail ⋯ action, kept). */
  onDuplicate?: (nodeId: string) => void;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
}) {
  const byId = useMemo(
    () => new Map(doc.nodes.map((n) => [n.id, n])),
    [doc.nodes],
  );
  // The spine, in column order; branch lanes are appended so no screen is
  // unreachable from the strip.
  const screens = useMemo(() => {
    const ids = ordered.steps.map((s) => s.nodeId);
    for (const lane of ordered.branches) for (const s of lane.steps) ids.push(s.nodeId);
    let q = 0;
    return ids
      .map((id) => byId.get(id))
      .filter((n): n is QuizNode => Boolean(n))
      .map((node) => ({
        node,
        label: screenLabel(node, node.type === "question" ? ++q : null),
      }));
  }, [ordered, byId]);

  return (
    <nav className="qz-screens" aria-label="Screens">
      {screens.map(({ node, label }) => {
        const active = node.id === activeId;
        const armed = confirmDeleteId === node.id;
        return (
          <div key={node.id} className={`qz-screens-item${active ? " is-active" : ""}`}>
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              className="qz-screens-thumb"
              title={label}
              onClick={() => onSelect(node.id)}
            >
              <div className="qz-screens-scale" aria-hidden>
                <StepPreview
                  doc={doc}
                  node={node}
                  productIndex={productIndex}
                  categories={categories}
                  breakpoint="mobile"
                  chrome="minimal"
                />
              </div>
            </button>
            <div className="qz-screens-caption">
              <span className="qz-screens-label">{label}</span>
              {active && node.type === "question" && !armed && onDuplicate ? (
                <button
                  type="button"
                  className="qz-screens-del qz-screens-dup"
                  aria-label={`Duplicate ${label}`}
                  title="Duplicate question"
                  onClick={() => onDuplicate(node.id)}
                >
                  ⧉
                </button>
              ) : null}
              {active && node.type !== "intro" ? (
                armed ? (
                  <span className="qz-screens-confirm" role="alertdialog">
                    <span>{deleteImpactCopy(doc, node)}</span>
                    <button
                      type="button"
                      className="qz-screens-confirm-yes"
                      onClick={() => onDelete(node.id)}
                    >
                      Delete
                    </button>
                    <button type="button" onClick={() => onConfirmDelete(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="qz-screens-del"
                    aria-label={`Delete ${label}`}
                    onClick={() => onConfirmDelete(node.id)}
                  >
                    ✕
                  </button>
                )
              ) : null}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="qz-screens-add"
        aria-label="Add a screen"
        title="Add a question screen"
        onClick={onAddScreen}
      >
        +
      </button>
    </nav>
  );
}
