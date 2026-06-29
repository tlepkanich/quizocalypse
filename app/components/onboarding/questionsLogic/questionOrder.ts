import type { Quiz as QuizDoc, QuizNode, Answer } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import { orderFlow } from "../../../lib/flowOrder";

// Questions & Logic spec — flow-ordered question list + the SHARED mapping
// predicate. The spec's "Q{n}" numbering, the left-panel amber unmapped dot, the
// Table "Gaps only" filter, the Outcome-Coverage pills, and the Continue
// orphaned-bucket dialog ALL derive from the helpers here, so they can never
// disagree (the survey's "one predicate" rule). Pure — no React/DOM.

export type QuestionNode = Extract<QuizNode, { type: "question" }>;

export interface OrderedQuestion {
  node: QuestionNode;
  /** 1-based display number ("Q1", "Q2", …). */
  qIndex: number;
}

// Questions in shopper-flow order: the main spine first, then branch lanes (in
// the order orderFlow surfaces them). Each question gets a stable 1-based number.
// Falls back to doc.nodes order if there's no intro (orderFlow returns []).
export function orderedQuestions(doc: QuizDoc): OrderedQuestion[] {
  const flow = orderFlow(doc);
  const byId = new Map(doc.nodes.map((n) => [n.id, n] as const));
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    const n = byId.get(id);
    if (n?.type === "question") {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const s of flow.steps) push(s.nodeId);
  for (const lane of flow.branches) for (const s of lane.steps) push(s.nodeId);
  // Any question never reached from intro (orphan / no-intro doc) — append in
  // doc order so it still shows up and stays editable.
  for (const n of doc.nodes) if (n.type === "question") push(n.id);

  return ids.map((id, i) => ({ node: byId.get(id) as QuestionNode, qIndex: i + 1 }));
}

// The single category id an answer maps to under DIRECT scoring (first points
// key), or null when unmapped. The inline answer-row pill is direct-only.
export function answerBucketId(answer: Answer): string | null {
  return Object.keys(answer.points ?? {})[0] ?? null;
}

// An answer is "mapped" when it carries any points entry (works for both direct
// and weighted storage — the shared definition of mapped/unmapped).
export function isAnswerMapped(answer: Answer): boolean {
  return !!answer.points && Object.keys(answer.points).length > 0;
}

// A question shows the amber "unmapped" dot when it's a card-style question (not
// open-text/freeform — those have nothing to map) with at least one answer that
// carries no bucket mapping.
export function questionHasUnmappedAnswer(node: QuestionNode): boolean {
  if (isFreeformType(node.data.question_type)) return false;
  return node.data.answers.some((a) => !isAnswerMapped(a));
}

// The current "Skip to" value for an answer: "__end__" when it routes to an end
// node, the target node id when it routes elsewhere, or "" for the default (Next
// question). Shared by the Builder answer row + the Table view so the two can't
// disagree about what an answer's routing is.
export function answerSkipValue(doc: QuizDoc, questionId: string, answer: Answer): string {
  const edge = doc.edges.find(
    (e) => e.source === questionId && e.source_handle === answer.edge_handle_id,
  );
  if (!edge) return "";
  const target = doc.nodes.find((n) => n.id === edge.target);
  return target?.type === "end" ? "__end__" : edge.target;
}

// Per-bucket count of answers that EXPLICITLY map to it (points-based — the same
// definition as orphanedBucketIds, not tag-overlap, matching the spec's "answers
// mapped to it"). Drives the Outcome-Coverage pills: count ≥1 = green, 0 = amber.
export function bucketMappedCounts(doc: QuizDoc, bucketIds: string[]): Map<string, number> {
  const counts = new Map<string, number>(bucketIds.map((id) => [id, 0]));
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    for (const a of n.data.answers) {
      for (const cid of Object.keys(a.points ?? {})) {
        if (counts.has(cid)) counts.set(cid, (counts.get(cid) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// Category ids that NO answer maps to anywhere in the quiz (the spec's "orphaned"
// buckets — amber coverage pill + Continue-dialog warning). Derived from the same
// count so the pills, the left amber dot, and the Continue guard can't disagree.
export function orphanedBucketIds(doc: QuizDoc, bucketIds: string[]): string[] {
  const counts = bucketMappedCounts(doc, bucketIds);
  return bucketIds.filter((id) => (counts.get(id) ?? 0) === 0);
}
