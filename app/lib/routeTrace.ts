import type { Quiz } from "./quizSchema";
import { resolveNextStep } from "./recommendationEngine";
import type { BranchContext } from "./recommendationEngine";

// Routing visibility (editor revamp P4). Two pure helpers the Logic view and
// FlowView use to SHOW how questions route to recommendation pages:
//   reachedBy(doc, resultNodeId)  — which answers / branch slots arrive at a
//                                   result page (its direct in-edges, labeled).
//   tracePath(doc, selections)    — walk the flow with chosen answers and
//                                   report every step + the landing result.
// Both reuse the runtime's own routing (resolveNextStep / edge semantics), so
// what the editor shows is exactly what a shopper would experience.

type QuizDoc = Quiz;
type AnyNode = QuizDoc["nodes"][number];

const truncate = (s: string, n = 38) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function nodeLabel(node: AnyNode): string {
  switch (node.type) {
    case "intro":
      return truncate(node.data.headline || "Intro");
    case "question":
      return truncate(node.data.text || "Question");
    case "result":
      return truncate(node.data.headline || "Result");
    case "branch":
      return truncate(node.data.label || "Branch");
    default:
      return node.type.replace(/_/g, " ");
  }
}

export interface ReachedByEntry {
  /** Human label, e.g. `“Dry skin” — How would you describe…` */
  label: string;
  via: "answer" | "branch" | "default";
  sourceNodeId: string;
}

/** The direct, labeled arrivals into a node (typically a result page). */
export function reachedBy(doc: QuizDoc, targetNodeId: string): ReachedByEntry[] {
  const entries: ReachedByEntry[] = [];
  for (const e of doc.edges) {
    if (e.target !== targetNodeId) continue;
    const src = doc.nodes.find((n) => n.id === e.source);
    if (!src) continue;
    if (src.type === "question" && e.source_handle) {
      const a = src.data.answers.find((x) => x.edge_handle_id === e.source_handle);
      entries.push({
        label: a ? `“${truncate(a.text, 26)}” — ${nodeLabel(src)}` : nodeLabel(src),
        via: "answer",
        sourceNodeId: src.id,
      });
    } else if (src.type === "branch") {
      const slot = src.data.slots.find((s) => s.id === e.source_handle);
      entries.push({
        label: `${nodeLabel(src)} → ${slot?.label ?? "slot"}`,
        via: "branch",
        sourceNodeId: src.id,
      });
    } else {
      entries.push({ label: nodeLabel(src), via: "default", sourceNodeId: src.id });
    }
  }
  return entries;
}

export interface TraceStep {
  nodeId: string;
  type: AnyNode["type"];
  label: string;
  pickedAnswerId?: string;
  pickedAnswerText?: string;
}

export interface PathTrace {
  steps: TraceStep[];
  resultNodeId: string | null;
}

/**
 * Walk the flow from the intro using the given answer selections
 * (questionNodeId → answerId; unanswered questions default to their first
 * answer). Branches resolve deterministically (rand → 0, i.e. the first
 * weighted slot) so the editor's trace is stable run-to-run.
 */
export function tracePath(doc: QuizDoc, selections: Record<string, string>): PathTrace {
  const ctx: BranchContext = {
    accumulatedTags: new Set<string>(),
    selectedAnswerIds: new Set<string>(),
    abAssignments: {},
    rand: () => 0,
  };
  const steps: TraceStep[] = [];
  const intro = doc.nodes.find((n) => n.type === "intro") ?? doc.nodes[0];
  if (!intro) return { steps, resultNodeId: null };

  let currentId: string | null = intro.id;
  for (let i = 0; i < 60 && currentId; i++) {
    const id: string = currentId;
    const node = doc.nodes.find((n) => n.id === id);
    if (!node) break;

    if (node.type === "question") {
      const picked =
        node.data.answers.find((a) => a.id === selections[node.id]) ?? node.data.answers[0];
      steps.push({
        nodeId: node.id,
        type: node.type,
        label: nodeLabel(node),
        ...(picked ? { pickedAnswerId: picked.id, pickedAnswerText: picked.text } : {}),
      });
      if (picked) {
        ctx.selectedAnswerIds.add(picked.id);
        for (const t of picked.tags) ctx.accumulatedTags.add(t);
      }
      currentId = resolveNextStep(doc, node.id, picked?.edge_handle_id ?? null, ctx);
      continue;
    }

    steps.push({ nodeId: node.id, type: node.type, label: nodeLabel(node) });
    if (node.type === "result" || node.type === "end") {
      return { steps, resultNodeId: node.type === "result" ? node.id : null };
    }
    currentId = resolveNextStep(doc, node.id, null, ctx);
  }
  const last = steps[steps.length - 1];
  return {
    steps,
    resultNodeId: last && last.type === "result" ? last.nodeId : null,
  };
}

/**
 * For a question, the distinct routing targets of its answers — used by
 * FlowView to badge answers when they diverge. Returns [] when every answer
 * goes to the same place (no badge noise on linear flows).
 */
export interface AnswerRoute {
  answerId: string;
  answerText: string;
  targetNodeId: string | null;
  targetLabel: string;
}

export function answerRoutes(doc: QuizDoc, questionNodeId: string): AnswerRoute[] {
  const node = doc.nodes.find((n) => n.id === questionNodeId);
  if (!node || node.type !== "question") return [];
  const routes: AnswerRoute[] = node.data.answers.map((a) => {
    const edge =
      doc.edges.find((e) => e.source === questionNodeId && e.source_handle === a.edge_handle_id) ??
      doc.edges.find((e) => e.source === questionNodeId && !e.source_handle);
    const target = edge ? doc.nodes.find((n) => n.id === edge.target) : undefined;
    return {
      answerId: a.id,
      answerText: a.text,
      targetNodeId: target?.id ?? null,
      targetLabel: target ? nodeLabel(target) : "—",
    };
  });
  const distinct = new Set(routes.map((r) => r.targetNodeId));
  return distinct.size > 1 ? routes : [];
}
