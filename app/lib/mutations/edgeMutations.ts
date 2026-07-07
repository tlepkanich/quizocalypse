// BIC-2 C3a — edge mutations: the one-edge-per-(source,handle) routing writes
// (addEdge / deleteEdge / setAnswerRoute / routeAnswerToEnd) plus branch-slot
// edge conditions. Pure move out of quizMutations.ts. Cross-module calls
// import the concrete module (never the barrel) so the graph stays acyclic.
import { uid, type QuizDoc } from "./shared";
import { addEndNode } from "./nodeMutations";
import { wouldCreateRevisit } from "../pathAnalyzer";

// Set the edge's condition (used by the per-slot Rule editor on Branch
// nodes). Pass `undefined` to clear it back to unconditional.
export function setEdgeCondition(
  doc: QuizDoc,
  edgeId: string,
  condition: { answer_id?: string; tag?: string; ab_slot?: string } | undefined,
): QuizDoc {
  return {
    ...doc,
    edges: doc.edges.map((e) => {
      if (e.id !== edgeId) return e;
      if (!condition) {
        const { condition: _drop, ...rest } = e;
        void _drop;
        return rest;
      }
      return { ...e, condition };
    }),
  };
}

export function deleteEdge(doc: QuizDoc, edgeId: string): QuizDoc {
  return { ...doc, edges: doc.edges.filter((e) => e.id !== edgeId) };
}

export function addEdge(
  doc: QuizDoc,
  source: string,
  target: string,
  sourceHandle?: string,
): QuizDoc {
  // ONE edge per (source, source_handle): an answer's edge_handle_id (or a branch
  // slot id) routes to exactly one target. Re-pointing a handle that already has an
  // edge REPLACES it — so the canvas drag-to-connect (handleConnect, which has no
  // pre-delete) can't leave a second, UI-invisible ghost edge on the same handle
  // (resolveNextStep/routeTrace use find() and would silently pick one, stranding
  // the other target). For the handle-LESS default edge, keep the exact (source,
  // target) dup guard — don't collapse a node's distinct default-vs-handled edges.
  let next = doc;
  if (sourceHandle) {
    const existing = doc.edges.find(
      (e) => e.source === source && e.source_handle === sourceHandle,
    );
    if (existing) {
      if (existing.target === target) return doc; // already correct — idempotent
      next = deleteEdge(doc, existing.id);
    }
  } else if (
    doc.edges.some(
      (e) => e.source === source && e.target === target && !e.source_handle,
    )
  ) {
    return doc; // exact handle-less duplicate
  }
  const edge = {
    id: uid("e"),
    source,
    target,
    ...(sourceHandle ? { source_handle: sourceHandle } : {}),
  };
  return { ...next, edges: [...next.edges, edge] };
}

// ── Unified P4 — per-answer routing ──────────────────────────────────────────
// Point ONE answer at a specific step, or back to the question's default.
// Routing model (matched by resolveNextStep): an answer routes via the edge
// keyed on its edge_handle_id; when that edge is absent, the question's
// default edge (no source_handle) applies. Passing target=null removes the
// per-answer edge — "follow the next step like everyone else".
// Question-Builder spec — route an answer to "End the quiz": send it to an end
// node, reusing an existing one or creating a fresh (unconnected) one. Pure.
export function routeAnswerToEnd(
  doc: QuizDoc,
  questionNodeId: string,
  answerId: string,
): QuizDoc {
  const node = doc.nodes.find((n) => n.id === questionNodeId);
  if (!node || node.type !== "question") return doc;
  if (!node.data.answers.some((a) => a.id === answerId)) return doc;
  const existingEnd = doc.nodes.find((n) => n.type === "end");
  if (existingEnd) return setAnswerRoute(doc, questionNodeId, answerId, existingEnd.id);
  const created = addEndNode(doc, null);
  const endNode = created.nodes[created.nodes.length - 1];
  if (!endNode) return doc;
  return setAnswerRoute(created, questionNodeId, answerId, endNode.id);
}

export function setAnswerRoute(
  doc: QuizDoc,
  questionNodeId: string,
  answerId: string,
  targetNodeId: string | null,
): QuizDoc {
  const node = doc.nodes.find((n) => n.id === questionNodeId);
  if (!node || node.type !== "question") return doc;
  const answer = node.data.answers.find((a) => a.id === answerId);
  if (!answer) return doc;
  // QZY-1 (quiz-logic spec §1) — refuse a route that would create a revisit
  // (cycle) on some path. The THEN GO TO dropdown disables these; the
  // mutation layer is the backstop (a cycling quiz traps the shopper).
  if (targetNodeId && wouldCreateRevisit(doc, questionNodeId, targetNodeId)) {
    return doc;
  }
  const handle = answer.edge_handle_id;
  // Delete EVERY edge on this answer's handle, not just the first — defense in
  // depth so a pre-corrupted doc carrying duplicate-handle edges (e.g. a legacy
  // canvas drag before addEdge enforced one-per-handle) self-heals on the next
  // reroute, instead of leaving a stale ghost edge that find()-based resolution
  // could silently follow. The clean single-edge happy path is unchanged.
  let next = doc;
  for (const e of doc.edges.filter(
    (e) => e.source === questionNodeId && e.source_handle === handle,
  )) {
    next = deleteEdge(next, e.id);
  }
  if (targetNodeId && targetNodeId !== questionNodeId) {
    next = addEdge(next, questionNodeId, targetNodeId, handle);
  }
  return next;
}
