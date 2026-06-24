import type { Quiz as QuizDoc, QuizNode } from "../../../lib/quizSchema";
import type { OrderedFlow } from "../../../lib/flowOrder";

// ───────────────────────────────────────────────────────────────────────────
// Pure flow-context for result pages — "which answers route to this page?"
//
// Step 3 (Results) shows, per result node, the answers / branch slots that lead
// to it (a top flow map + per-card "reached from" lines) and, when the page
// sits behind an `ab_split` branch, its A/B variant + normalized weight. This
// is a pure read over `doc.nodes` + `doc.edges` (+ `ordered` for reachability):
// no React, no engine call.
//
// How a result is reached (the smartBuild shape): intro → … → qN → branch →
// result. A branch slot's outgoing edge carries `source_handle = slot.id` and an
// `EdgeCondition` (tag | answer_id). A question's per-answer edge carries
// `source_handle = answer.edge_handle_id`. We trace a result's incoming edges
// back through pass-through nodes (message / email_gate / …) to the nearest
// DECISION node (question or branch) and describe that hop.
// ───────────────────────────────────────────────────────────────────────────

export type ReachedKind = "answer" | "tag" | "points" | "default" | "linear";

export interface ReachedFrom {
  // The decision source: a question's text, a branch label, or `Tagged "dry"`.
  questionLabel: string;
  // Human answer texts that take this path (may be empty for default/linear).
  answerLabels: string[];
  kind: ReachedKind;
}

export interface AbVariant {
  branchLabel: string;
  slotLabel: string;
  // Normalized share within the branch, 0–100 (rounded).
  weightPct: number;
}

export interface ResultFlowContext {
  reachedFrom: ReachedFrom[];
  abVariant?: AbVariant;
  // False when the result node is unreachable from intro (an orphan).
  reachable: boolean;
}

type QuestionNode = Extract<QuizNode, { type: "question" }>;
type BranchNode = Extract<QuizNode, { type: "branch" }>;
type Edge = QuizDoc["edges"][number];

// Pass-through node types we trace BACKWARD through to find the real decision
// (these don't themselves choose a path). Questions + branches are decisions and
// stop the trace; intro is the origin and also stops it.
const PASS_THROUGH = new Set<QuizNode["type"]>([
  "message",
  "email_gate",
  "ask_ai",
  "integration",
  "product_cards",
  "end",
]);

const MAX_HOPS = 16; // cycle / pathological-depth guard

function answerByHandle(
  q: QuestionNode,
  edge: Edge,
): QuestionNode["data"]["answers"][number] | undefined {
  const byHandle = q.data.answers.find((a) => a.edge_handle_id === edge.source_handle);
  if (byHandle) return byHandle;
  if (edge.condition?.answer_id) {
    return q.data.answers.find((a) => a.id === edge.condition!.answer_id);
  }
  return undefined;
}

function findAnswerById(doc: QuizDoc, answerId: string): { q: QuestionNode; text: string } | null {
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    const a = n.data.answers.find((ans) => ans.id === answerId);
    if (a) return { q: n, text: a.text };
  }
  return null;
}

function answersForTag(doc: QuizDoc, tag: string, cap = 4): string[] {
  const out: string[] = [];
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    for (const a of n.data.answers) {
      if (a.tags.includes(tag) && !out.includes(a.text)) {
        out.push(a.text);
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

function reachedFromQuestion(q: QuestionNode, edge: Edge): ReachedFrom {
  const a = answerByHandle(q, edge);
  return a
    ? { questionLabel: q.data.text, answerLabels: [a.text], kind: "answer" }
    : { questionLabel: q.data.text, answerLabels: [], kind: "linear" };
}

function reachedFromRulesBranch(doc: QuizDoc, branch: BranchNode, edge: Edge): ReachedFrom {
  const slot = branch.data.slots.find((s) => s.id === edge.source_handle);
  const cond = edge.condition;
  if (cond?.answer_id) {
    const hit = findAnswerById(doc, cond.answer_id);
    return {
      questionLabel: hit ? hit.q.data.text : branch.data.label,
      answerLabels: hit ? [hit.text] : slot ? [slot.label] : [],
      kind: "answer",
    };
  }
  if (cond?.tag) {
    return {
      questionLabel: `Tagged “${cond.tag}”`,
      answerLabels: answersForTag(doc, cond.tag),
      kind: "tag",
    };
  }
  if (cond?.points_category) {
    // `points` branch: this page wins when its bucket is the top-scoring match.
    return {
      questionLabel: slot ? `Top match · ${slot.label}` : "Top match",
      answerLabels: [],
      kind: "points",
    };
  }
  // Unconditioned slot = the catch-all / default path.
  return {
    questionLabel: branch.data.label || "Branch",
    answerLabels: slot ? [slot.label] : [],
    kind: "default",
  };
}

function abVariantFor(branch: BranchNode, edge: Edge): AbVariant {
  const slot = branch.data.slots.find((s) => s.id === edge.source_handle);
  const total = branch.data.slots.reduce((sum, s) => sum + (s.weight ?? 0), 0);
  const weight = slot?.weight ?? 0;
  const weightPct =
    total > 0
      ? Math.round((weight / total) * 100)
      : Math.round(100 / Math.max(1, branch.data.slots.length));
  return {
    branchLabel: branch.data.label || "A/B test",
    slotLabel: slot?.label ?? "Variant",
    weightPct,
  };
}

function dedupeReached(entries: ReachedFrom[]): ReachedFrom[] {
  const seen = new Set<string>();
  const out: ReachedFrom[] = [];
  for (const e of entries) {
    const key = `${e.kind}|${e.questionLabel}|${e.answerLabels.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Per-result-node flow context: how each result page is reached, plus its A/B
 * variant when behind an `ab_split` branch. Pure — safe to call on every render.
 */
export function resultPageFlowContext(
  doc: QuizDoc,
  ordered: OrderedFlow,
): Map<string, ResultFlowContext> {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const orphans = new Set(ordered.orphans);

  // target → incoming edges (preserves edge order for stable output).
  const incoming = new Map<string, Edge[]>();
  for (const edge of doc.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }

  const result = new Map<string, ResultFlowContext>();

  for (const node of doc.nodes) {
    if (node.type !== "result") continue;

    const reachedFrom: ReachedFrom[] = [];
    let abVariant: AbVariant | undefined;

    // Backward BFS through pass-through nodes to the nearest decision edges.
    const seen = new Set<string>();
    const stack: { id: string; depth: number }[] = [{ id: node.id, depth: 0 }];
    while (stack.length) {
      const { id, depth } = stack.pop()!;
      if (seen.has(id) || depth > MAX_HOPS) continue;
      seen.add(id);

      for (const edge of incoming.get(id) ?? []) {
        const src = nodeById.get(edge.source);
        if (!src) continue;

        if (src.type === "question") {
          reachedFrom.push(reachedFromQuestion(src, edge));
        } else if (src.type === "branch") {
          if (src.data.mode === "ab_split") {
            // First A/B branch on the path defines the variant badge.
            if (!abVariant) abVariant = abVariantFor(src, edge);
          } else {
            reachedFrom.push(reachedFromRulesBranch(doc, src, edge));
          }
        } else if (PASS_THROUGH.has(src.type) || src.type === "intro") {
          stack.push({ id: src.id, depth: depth + 1 });
        }
      }
    }

    result.set(node.id, {
      reachedFrom: dedupeReached(reachedFrom),
      abVariant,
      reachable: !orphans.has(node.id),
    });
  }

  return result;
}
