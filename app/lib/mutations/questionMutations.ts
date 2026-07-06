// BIC-2 C3a — question-node mutations (add/remove/duplicate questions, answers,
// type changes, spine reordering, points-model scoring). Pure move out of
// quizMutations.ts — every body is byte-identical to the original.
import { isFreeformType } from "../quizSchema";
import type { QuestionType } from "../quizSchema";
import { uid, nextPosition, type QuizDoc, type QuizNodeDoc } from "./shared";

// Question-Builder spec — splice `newNode` onto the linear spine relative to
// `refId` ("above" = before it, "below" = after it). Only plain (handle-less)
// spine edges are rewired, so per-answer routing edges are left intact. Pure.
function spliceQuestion(
  doc: QuizDoc,
  newNode: QuizNodeDoc,
  refId: string,
  where: "above" | "below",
): QuizDoc {
  const nodes = [...doc.nodes, newNode];
  if (where === "below") {
    const out = doc.edges.find((e) => e.source === refId && !e.source_handle);
    if (out) {
      const edges = [
        ...doc.edges.filter((e) => e.id !== out.id),
        { id: uid("e"), source: refId, target: newNode.id },
        { id: uid("e"), source: newNode.id, target: out.target },
      ];
      return { ...doc, nodes, edges };
    }
    return {
      ...doc,
      nodes,
      edges: [...doc.edges, { id: uid("e"), source: refId, target: newNode.id }],
    };
  }
  // above
  const inc = doc.edges.find((e) => e.target === refId && !e.source_handle);
  if (inc) {
    const edges = [
      ...doc.edges.filter((e) => e.id !== inc.id),
      { id: uid("e"), source: inc.source, target: newNode.id },
      { id: uid("e"), source: newNode.id, target: refId },
    ];
    return { ...doc, nodes, edges };
  }
  return {
    ...doc,
    nodes,
    edges: [...doc.edges, { id: uid("e"), source: newNode.id, target: refId }],
  };
}

// Deep-clone a question node's data with fresh answer ids + edge handles, so the
// duplicate routes independently of the original. Pure.
function cloneQuestionData(
  data: Extract<QuizNodeDoc, { type: "question" }>["data"],
): Extract<QuizNodeDoc, { type: "question" }>["data"] {
  const copy = JSON.parse(JSON.stringify(data)) as typeof data;
  copy.answers = copy.answers.map((a) => ({
    ...a,
    id: uid("a"),
    edge_handle_id: uid("h"),
  }));
  return copy;
}

// Question-Builder spec — duplicate a question, spliced in right after the
// original on the spine (fresh ids, no inherited per-answer routing). Pure.
export function duplicateQuestionNode(doc: QuizDoc, nodeId: string): QuizDoc {
  const orig = doc.nodes.find((n) => n.id === nodeId);
  if (!orig || orig.type !== "question") return doc;
  const clone: QuizNodeDoc = {
    id: uid("q"),
    type: "question",
    position: nextPosition(doc, nodeId),
    data: cloneQuestionData(orig.data),
  };
  return spliceQuestion(doc, clone, nodeId, "below");
}

// Question-Builder spec — insert a fresh blank question above/below a reference
// question, spliced into the spine. Pure.
export function insertQuestionRelative(
  doc: QuizDoc,
  refId: string,
  where: "above" | "below",
): QuizDoc {
  const blank: QuizNodeDoc = {
    id: uid("q"),
    type: "question",
    position: nextPosition(doc, refId),
    data: {
      text: "New question",
      question_type: "single_select",
      required: true,
      show_preview_after: false,
      answers: [
        { id: uid("a"), text: "Option 1", tags: [], edge_handle_id: uid("h") },
        { id: uid("a"), text: "Option 2", tags: [], edge_handle_id: uid("h") },
      ],
    },
  };
  return spliceQuestion(doc, blank, refId, where);
}

// Question-Builder spec (Question Bank) — append a pre-built library question to the
// END of the spine (after the last question, before the result), with fresh ids +
// edge handles. Mappings start empty; the merchant maps in the right panel. Pure.
export function appendBankQuestion(
  doc: QuizDoc,
  entry: {
    text: string;
    question_type: Extract<QuizNodeDoc, { type: "question" }>["data"]["question_type"];
    answers: string[];
  },
): QuizDoc {
  const { head, run } = straightThroughRun(doc);
  const anchor = run.length ? run[run.length - 1]! : head;
  const node: QuizNodeDoc = {
    id: uid("q"),
    type: "question",
    position: nextPosition(doc, anchor),
    data: {
      text: entry.text.slice(0, 150),
      question_type: entry.question_type,
      required: true,
      show_preview_after: false,
      answers: entry.answers.slice(0, 12).map((t) => ({
        id: uid("a"),
        text: t.slice(0, 60),
        tags: [],
        edge_handle_id: uid("h"),
      })),
    },
  };
  // No spine at all (a doc without an intro) — append the node standalone; the
  // merchant wires it in the rail. In practice every funnel/builder doc has an
  // intro, so `anchor` is a real node and we splice after the last question.
  if (!anchor) return { ...doc, nodes: [...doc.nodes, node] };
  return spliceQuestion(doc, node, anchor, "below");
}

export function addQuestionNode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("q");
  const node: QuizNodeDoc = {
    id,
    type: "question",
    position: nextPosition(doc, anchorId),
    data: {
      text: "New question",
      question_type: "single_select",
      required: true,
      show_preview_after: false,
      answers: [
        {
          id: uid("a"),
          text: "Option 1",
          tags: [],
          edge_handle_id: uid("h"),
        },
        {
          id: uid("a"),
          text: "Option 2",
          tags: [],
          edge_handle_id: uid("h"),
        },
      ],
    },
  };
  const edges = anchorId
    ? [
        ...doc.edges,
        {
          id: uid("e"),
          source: anchorId,
          target: id,
          ...(anchorHandle ? { source_handle: anchorHandle } : {}),
        },
      ]
    : doc.edges;
  return { ...doc, nodes: [...doc.nodes, node], edges };
}

export function addAnswer(doc: QuizDoc, questionNodeId: string): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== questionNodeId || n.type !== "question") return n;
      return {
        ...n,
        data: {
          ...n.data,
          answers: [
            ...n.data.answers,
            {
              id: uid("a"),
              text: `Option ${n.data.answers.length + 1}`,
              tags: [],
              edge_handle_id: uid("h"),
            },
          ],
        },
      };
    }),
  };
}

export function removeAnswer(
  doc: QuizDoc,
  questionNodeId: string,
  answerId: string,
): QuizDoc {
  // Find the answer's edge_handle_id so we can prune edges sourcing from it.
  const node = doc.nodes.find((n) => n.id === questionNodeId);
  let handleId: string | undefined;
  if (node && node.type === "question") {
    handleId = node.data.answers.find((a) => a.id === answerId)?.edge_handle_id;
  }
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== questionNodeId || n.type !== "question") return n;
      const remaining = n.data.answers.filter((a) => a.id !== answerId);
      // Card-style types need ≥2 answers per the Zod refine; freeform
      // types only need ≥1 (the seed). Refuse if it would drop below.
      const isFreeform = isFreeformType(n.data.question_type);
      const minAnswers = isFreeform ? 1 : 2;
      if (remaining.length < minAnswers) return n;
      return { ...n, data: { ...n.data, answers: remaining } };
    }),
    edges: handleId
      ? doc.edges.filter((e) => e.source_handle !== handleId)
      : doc.edges,
  };
}

// Node types that form the linear, drag-reorderable "spine" of a quiz. intro is
// always first (the entry), branch fans out, and result/end are terminals — none
// of those reorder, so they bound the run rather than belong to it.
const MOVABLE_STEP_TYPES = new Set<QuizNodeDoc["type"]>([
  "question",
  "message",
  "email_gate",
  "ask_ai",
  "product_cards",
  "integration",
]);

/**
 * The contiguous linear run of drag-reorderable steps after the intro: a chain
 * of single-inbound / single-outbound "movable" nodes (questions, messages,
 * gates, …). The walk stops at the first node that branches, merges, fans out,
 * or terminates — that node becomes the `tail`. `head` is the node before the
 * run (normally the intro). These three pieces are exactly what `moveStep` needs
 * to re-stitch the chain, and what the cascade UI needs to know which cards can
 * be dragged. Pure; relies on edges, never on `position`.
 */
export function straightThroughRun(doc: QuizDoc): {
  head: string | null;
  run: string[];
  tail: string | null;
} {
  const intro = doc.nodes.find((n) => n.type === "intro");
  if (!intro) return { head: null, run: [], tail: null };

  const typeById = new Map(doc.nodes.map((n) => [n.id, n.type] as const));
  const outOf = (id: string) => doc.edges.filter((e) => e.source === id);
  const inTo = (id: string) => doc.edges.filter((e) => e.target === id);

  const introOut = outOf(intro.id);
  // Intro must lead to exactly one next step for a simple linear run to exist.
  if (introOut.length !== 1) {
    return { head: intro.id, run: [], tail: introOut[0]?.target ?? null };
  }

  const run: string[] = [];
  let cur = introOut[0]!.target;
  // Walk while each node is movable AND a clean single-in/single-out link.
  while (true) {
    const t = typeById.get(cur);
    if (!t || !MOVABLE_STEP_TYPES.has(t)) break; // terminal / branch boundary
    if (inTo(cur).length !== 1) break; // a merge target — not simply reorderable
    const o = outOf(cur);
    if (o.length !== 1) break; // fan-out (e.g. per-answer routing) — boundary
    run.push(cur);
    cur = o[0]!.target;
    if (run.includes(cur)) break; // cycle guard
  }
  return { head: intro.id, run, tail: cur };
}

/**
 * Reorder a step within the linear run (drag-and-drop / move up/down). Moves
 * `movingId` to sit immediately before `beforeId` (or to the end of the run when
 * `beforeId` is null), then rebuilds the straight-through chain edges so the flow
 * stays intro → … → tail with the new order. Edges OUTSIDE the chain (branch
 * slots, lanes, per-answer routing) are untouched. A no-op (move to same spot,
 * or `movingId` not in the run) returns the doc unchanged.
 */
export function moveStep(
  doc: QuizDoc,
  movingId: string,
  beforeId: string | null,
): QuizDoc {
  const { head, run, tail } = straightThroughRun(doc);
  if (!run.includes(movingId)) return doc; // only run members reorder

  const without = run.filter((id) => id !== movingId);
  let at = beforeId == null ? without.length : without.indexOf(beforeId);
  if (at < 0) at = without.length; // beforeId not in run → append
  const newRun = [...without.slice(0, at), movingId, ...without.slice(at)];

  if (newRun.length === run.length && newRun.every((id, i) => id === run[i])) {
    return doc; // order unchanged
  }

  // Identify the existing chain edges (head→run[0]→…→run[n]→tail) by their
  // (source,target) pairs — all are plain, handle-less links by construction —
  // drop them, and re-link the new sequence.
  const seqEdgeIds = (seq: string[]): Set<string> => {
    const ids = new Set<string>();
    for (let i = 0; i + 1 < seq.length; i++) {
      const e = doc.edges.find(
        (e) => e.source === seq[i] && e.target === seq[i + 1] && !e.source_handle,
      );
      if (e) ids.add(e.id);
    }
    return ids;
  };
  const oldSeq = [head, ...run, tail].filter((x): x is string => Boolean(x));
  const drop = seqEdgeIds(oldSeq);

  const newSeq = [head, ...newRun, tail].filter((x): x is string => Boolean(x));
  const relinked: QuizDoc["edges"] = [];
  for (let i = 0; i + 1 < newSeq.length; i++) {
    relinked.push({ id: uid("e"), source: newSeq[i]!, target: newSeq[i + 1]! });
  }

  return {
    ...doc,
    edges: [...doc.edges.filter((e) => !drop.has(e.id)), ...relinked],
  };
}

// Shape-Your-Quiz spec — materialize a scoring choice onto an answer's `points`
// map (the one engine that serves both Direct and Weighted; the runtime tallies
// it via pickPointsWinner). Pure. Internal: replace an answer's whole points map.
function updateAnswerPoints(
  doc: QuizDoc,
  questionNodeId: string,
  answerId: string,
  points: Record<string, number> | undefined,
): QuizDoc {
  const node = doc.nodes.find((n) => n.id === questionNodeId);
  if (!node || node.type !== "question") return doc;
  if (!node.data.answers.some((a) => a.id === answerId)) return doc;
  const answers = node.data.answers.map((a) =>
    a.id === answerId
      ? points && Object.keys(points).length > 0
        ? { ...a, points }
        : (({ points: _drop, ...rest }) => rest)(a) // clear the map entirely
      : a,
  );
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === questionNodeId ? { ...node, data: { ...node.data, answers } } : n)) };
}

// Direct mapping: an answer awards points to EXACTLY ONE bucket (weight 1).
// Passing null clears the answer's mapping. Replaces any prior weights.
// Defense-in-depth: a no-op on a WEIGHTED quiz (the inline pill is direct-only,
// and the UIs disable it in weighted mode) so it can never silently flatten a
// weighted multi-bucket map down to {cat:1} — edit weighted maps via
// setAnswerBucketWeight instead.
export function setAnswerBucketDirect(
  doc: QuizDoc,
  questionNodeId: string,
  answerId: string,
  categoryId: string | null,
): QuizDoc {
  if ((doc.scoring_model ?? "direct") === "weighted") return doc;
  return updateAnswerPoints(
    doc,
    questionNodeId,
    answerId,
    categoryId ? { [categoryId]: 1 } : undefined,
  );
}

// Weighted scoring: set ONE bucket's weight in the answer's points map,
// preserving the others. A weight ≤ 0 removes just that bucket. Pure.
export function setAnswerBucketWeight(
  doc: QuizDoc,
  questionNodeId: string,
  answerId: string,
  categoryId: string,
  weight: number,
): QuizDoc {
  const node = doc.nodes.find((n) => n.id === questionNodeId);
  if (!node || node.type !== "question") return doc;
  const answer = node.data.answers.find((a) => a.id === answerId);
  if (!answer) return doc;
  const nextPoints: Record<string, number> = { ...(answer.points ?? {}) };
  if (weight > 0) nextPoints[categoryId] = Math.round(weight);
  else delete nextPoints[categoryId];
  return updateAnswerPoints(doc, questionNodeId, answerId, nextPoints);
}

// Question-Builder spec — switch the active scoring model, preserving BOTH models'
// data. For every answer, swap `points` (the active store the engine + publish
// read) ↔ `points_alt` (the dormant other model). The model you're leaving moves
// to the sidecar; the model you're entering loads back from it. No-op if already
// on `next`. Runtime is unchanged — the engine always reads `points`.
// Questions & Logic spec §3.1 — change a question's type. PRESERVES the question
// text (and every other QuestionData field) but RESETS the answer options to
// type-appropriate defaults (card types ≥2, freeform a single seed) with fresh
// edge handles, and prunes any per-answer routing edges that sourced from the old
// (now-gone) answer handles so no stale skip edge dangles. Gate behind a "this
// resets your answers" confirm in the UI. No-op for a non-question node. Pure.
export function setQuestionType(
  doc: QuizDoc,
  nodeId: string,
  newType: QuestionType,
): QuizDoc {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "question") return doc;
  const oldHandles = new Set(node.data.answers.map((a) => a.edge_handle_id));
  const answers = isFreeformType(newType)
    ? [{ id: uid("a"), text: "Response", tags: [], edge_handle_id: uid("h") }]
    : [
        { id: uid("a"), text: "Option 1", tags: [], edge_handle_id: uid("h") },
        { id: uid("a"), text: "Option 2", tags: [], edge_handle_id: uid("h") },
      ];
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId && n.type === "question"
        ? {
            ...n,
            data: {
              ...n.data,
              question_type: newType,
              answers,
              // LOGIC v2 §2.2 — multi-select can never decide (one answer →
              // one target breaks with multiple picks), and neither can
              // freeform types (no discrete answers to map) — the SAME
              // predicate setQuestionRole refuses to promote. Switching a
              // DECIDING question to either auto-demotes it to qualifier in
              // the same mutation (no race with a separate role write).
              ...((newType === "multi_select" || isFreeformType(newType)) &&
              n.data.role === "decides"
                ? { role: "qualifier" as const }
                : {}),
            },
          }
        : n,
    ),
    edges: doc.edges.filter(
      (e) =>
        !(e.source === nodeId && e.source_handle != null && oldHandles.has(e.source_handle)),
    ),
  };
}

export function swapScoringModel(doc: QuizDoc, next: "direct" | "weighted"): QuizDoc {
  if ((doc.scoring_model ?? "direct") === next) return { ...doc, scoring_model: next };
  const nodes = doc.nodes.map((n) =>
    n.type === "question"
      ? {
          ...n,
          data: {
            ...n.data,
            answers: n.data.answers.map((a) => ({
              ...a,
              points: a.points_alt,
              points_alt: a.points,
            })),
          },
        }
      : n,
  );
  return { ...doc, nodes, scoring_model: next };
}
