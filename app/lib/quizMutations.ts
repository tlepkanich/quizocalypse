import { ResultData, ResultStage, isFreeformType } from "./quizSchema";
import type { Quiz, QuestionType } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;
type QuizNodeDoc = QuizDoc["nodes"][number];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const NEW_NODE_OFFSET = 320;

function nextPosition(doc: QuizDoc, anchor: string | null) {
  if (anchor) {
    const a = doc.nodes.find((n) => n.id === anchor);
    if (a) return { x: a.position.x + NEW_NODE_OFFSET, y: a.position.y };
  }
  if (doc.nodes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...doc.nodes.map((n) => n.position.x));
  const avgY = doc.nodes.reduce((s, n) => s + n.position.y, 0) / doc.nodes.length;
  return { x: maxX + NEW_NODE_OFFSET, y: avgY };
}

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

export function addResultNode(
  doc: QuizDoc,
  anchorId: string | null,
  fallbackCollectionId: string,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("r");
  const node: QuizNodeDoc = {
    id,
    type: "result",
    position: nextPosition(doc, anchorId),
    // Parse through ResultData so all the v3 defaults (match_ladder,
    // ranking, min/max, oos_behavior, stages, …) are filled in.
    data: ResultData.parse({
      headline: "Your match",
      subtext: "",
      slot_count: 3,
      cta_label: "Shop now",
      fallback_collection_id: fallbackCollectionId,
    }),
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
  return {
    ...doc,
    nodes: [...doc.nodes, node],
    edges,
    results_pages: [
      ...doc.results_pages,
      { id, headline: "Your match", subtext: "", product_ids: [], match_strategy: "top_n" as const },
    ],
  };
}

// ── Rec-Page spec §1 — multi-section (1/2/3 sections per bucket) ───────────────
// Sections map to ResultData.stages[]: stages.length === 0 → ONE section (the
// node's top-level config, rendered by ResultView). stages.length === N (N≥2) →
// N sections (rendered by MultiStageResultView). Each stage carries its own
// heading / sub-filter / sort / count and resolves the SAME bound bucket pool
// (category_id inherited), narrowed by the section's sub-filter.

function resultNodeAt(doc: QuizDoc, nodeId: string) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  return node && node.type === "result" ? node : null;
}

// Immutable patch of a result node's data (quizMutations is studioDoc-free).
function patchResultData(
  doc: QuizDoc,
  nodeId: string,
  patch: Record<string, unknown>,
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId && n.type === "result" ? { ...n, data: { ...n.data, ...patch } } : n,
    ),
  };
}

// Patch a single section's fields (heading, sub_filter_tag/collection, ranking,
// min/max_products). No-op if the node or stage index is absent.
export function setResultStage(
  doc: QuizDoc,
  nodeId: string,
  index: number,
  patch: Partial<z.infer<typeof ResultStage>>,
): QuizDoc {
  const node = resultNodeAt(doc, nodeId);
  if (!node) return doc;
  const stages = [...node.data.stages];
  if (!stages[index]) return doc;
  stages[index] = { ...stages[index]!, ...patch };
  return patchResultData(doc, nodeId, { stages });
}

// Set the number of sections to n (1, 2, or 3). n<=1 clears stages (single
// section = the node's top-level config). n>=2 ensures exactly n stages, padding
// new ones that inherit the node's bucket binding (so each section resolves the
// same pool, then narrows by its own sub-filter) and trimming extras.
export function setResultSectionCount(doc: QuizDoc, nodeId: string, n: number): QuizDoc {
  const node = resultNodeAt(doc, nodeId);
  if (!node) return doc;
  const data = node.data;
  let stages = [...data.stages];
  if (n <= 1) {
    stages = [];
  } else {
    while (stages.length < n) {
      stages.push(
        ResultStage.parse({
          id: uid("stage"),
          headline: stages.length === 0 ? "Recommended for you" : "Complete your routine",
          match_ladder: data.match_ladder,
          category_id: data.category_id,
          ranking: data.ranking,
          min_products: 1,
          max_products: 4,
        }),
      );
    }
    stages = stages.slice(0, n);
  }
  return patchResultData(doc, nodeId, { stages });
}

export function addEmailGateNode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("eg");
  const node: QuizNodeDoc = {
    id,
    type: "email_gate",
    position: nextPosition(doc, anchorId),
    data: {
      headline: "Get your results",
      subtext: "We'll send a copy of your personalized picks.",
      email_required: true,
      name_optional: true,
      skip_allowed: false,
      collect_phone: false,
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

export function addMessageNode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("m");
  const node: QuizNodeDoc = {
    id,
    type: "message",
    position: nextPosition(doc, anchorId),
    data: {
      text: "Thanks — your answers are in.",
      supports_merge_tags: true,
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

export function addEndNode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("end");
  const node: QuizNodeDoc = {
    id,
    type: "end",
    position: nextPosition(doc, anchorId),
    data: {
      headline: "All done",
      subtext: "Thanks for taking the quiz.",
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

export function addIntegrationNode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("int");
  const node: QuizNodeDoc = {
    id,
    type: "integration",
    position: nextPosition(doc, anchorId),
    data: {
      label: "Integration",
      continue_on_error: true,
      actions: [
        {
          kind: "webhook",
          url: "https://example.com/webhook",
          label: "Outbound webhook",
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

export function addProductCardsNode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("pc");
  const node: QuizNodeDoc = {
    id,
    type: "product_cards",
    position: nextPosition(doc, anchorId),
    data: {
      headline: "You might like these",
      subtext: "",
      // Seed with one empty placeholder ID so the schema validates; merchant
      // edits in the drawer. Tests will replace with real IDs.
      product_ids: ["placeholder"],
      cta_label: "Shop",
      continue_label: "Continue",
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

export function addAskAINode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("ai");
  const node: QuizNodeDoc = {
    id,
    type: "ask_ai",
    position: nextPosition(doc, anchorId),
    data: {
      system_prompt:
        "You are a friendly shopping assistant. Help the shopper based on the quiz context. " +
        "Recommend products only if relevant; otherwise answer clearly and briefly.",
      persona_name: "Assistant",
      opening_message: "Hi! Anything you'd like to ask before we wrap up?",
      suggested_questions: [
        "How should I use this?",
        "What's the best one for sensitive skin?",
      ],
      max_turns: 6,
      continue_label: "Continue",
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

export function addBranchNode(
  doc: QuizDoc,
  anchorId: string | null,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("br");
  const node: QuizNodeDoc = {
    id,
    type: "branch",
    position: nextPosition(doc, anchorId),
    data: {
      label: "Branch",
      mode: "rules",
      slots: [
        { id: uid("sl"), label: "A", weight: 1 },
        { id: uid("sl"), label: "B", weight: 1 },
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

// Add a new output slot to a branch node. The new slot has a unique id used
// as source_handle on its outgoing edge.
export function addBranchSlot(doc: QuizDoc, branchNodeId: string): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== branchNodeId || n.type !== "branch") return n;
      const nextLetter = String.fromCharCode(65 + n.data.slots.length);
      return {
        ...n,
        data: {
          ...n.data,
          slots: [
            ...n.data.slots,
            { id: uid("sl"), label: nextLetter, weight: 1 },
          ],
        },
      };
    }),
  };
}

// Remove a slot from a branch node, also pruning any edges that source from
// that slot. Refuses to drop below 2 slots since the schema requires it.
export function removeBranchSlot(
  doc: QuizDoc,
  branchNodeId: string,
  slotId: string,
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== branchNodeId || n.type !== "branch") return n;
      const remaining = n.data.slots.filter((s) => s.id !== slotId);
      if (remaining.length < 2) return n;
      return { ...n, data: { ...n.data, slots: remaining } };
    }),
    edges: doc.edges.filter(
      (e) => !(e.source === branchNodeId && e.source_handle === slotId),
    ),
  };
}

// Set a branch slot's weighted-random share (ab_split mode). Clamped to a
// non-negative integer to satisfy BranchSlot.weight (z.number().int().min(0)).
export function setSlotWeight(
  doc: QuizDoc,
  branchNodeId: string,
  slotId: string,
  weight: number,
): QuizDoc {
  const w = Math.max(0, Math.round(Number.isFinite(weight) ? weight : 0));
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== branchNodeId || n.type !== "branch") return n;
      return {
        ...n,
        data: {
          ...n.data,
          slots: n.data.slots.map((s) =>
            s.id === slotId ? { ...s, weight: w } : s,
          ),
        },
      };
    }),
  };
}

// Promote one A/B variant to 100% of traffic (Phase F auto-promote): the winning
// slot takes weight 100, the rest go to 0. Immutable + reversible (re-weight to
// undo); preserves slots + edges. The winner is decided upstream by pickAbWinner
// — this only applies the chosen slot's weights.
export function promoteAbWinner(
  doc: QuizDoc,
  branchNodeId: string,
  winnerSlotId: string,
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== branchNodeId || n.type !== "branch") return n;
      return {
        ...n,
        data: {
          ...n.data,
          slots: n.data.slots.map((s) => ({
            ...s,
            weight: s.id === winnerSlotId ? 100 : 0,
          })),
        },
      };
    }),
  };
}

// Switch a branch between rules-based routing and A/B weighted split. Slots are
// preserved (weights only matter in ab_split mode; conditions only in rules).
export function setBranchMode(
  doc: QuizDoc,
  branchNodeId: string,
  mode: "rules" | "ab_split",
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== branchNodeId || n.type !== "branch") return n;
      return { ...n, data: { ...n.data, mode } };
    }),
  };
}

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

export function deleteNode(doc: QuizDoc, nodeId: string): QuizDoc {
  const { [nodeId]: _droppedBp, ...remainingBp } = doc.breakpoint_overrides;
  void _droppedBp;

  // Re-stitch a straight-through node (prev → node → next ⇒ prev → next) so
  // deleting a middle step never strands its successor. Only when the node has
  // exactly one inbound + one outbound edge (a fan-out/branch is ambiguous, so
  // leave it). The inbound edge's handle/condition is preserved, so a branch
  // slot keeps routing to `next`.
  const inbound = doc.edges.filter((e) => e.target === nodeId);
  const outbound = doc.edges.filter((e) => e.source === nodeId);
  const stitched: QuizDoc["edges"] = [];
  if (inbound.length === 1 && outbound.length === 1) {
    const inE = inbound[0]!;
    const outE = outbound[0]!;
    const dup = doc.edges.some(
      (e) =>
        e.source === inE.source &&
        e.target === outE.target &&
        e.source_handle === inE.source_handle,
    );
    if (inE.source !== outE.target && !dup) {
      stitched.push({
        id: uid("e"),
        source: inE.source,
        target: outE.target,
        ...(inE.source_handle ? { source_handle: inE.source_handle } : {}),
        ...(inE.condition ? { condition: inE.condition } : {}),
      });
    }
  }

  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== nodeId),
    edges: [
      ...doc.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      ...stitched,
    ],
    results_pages: doc.results_pages.filter((r) => r.id !== nodeId),
    breakpoint_overrides: remainingBp,
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
  // Avoid duplicates on the same handle pair.
  const exists = doc.edges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      e.source_handle === sourceHandle,
  );
  if (exists) return doc;
  const edge = {
    id: uid("e"),
    source,
    target,
    ...(sourceHandle ? { source_handle: sourceHandle } : {}),
  };
  return { ...doc, edges: [...doc.edges, edge] };
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

export function setNodePosition(
  doc: QuizDoc,
  nodeId: string,
  pos: { x: number; y: number },
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, position: pos } : n)),
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
  const handle = answer.edge_handle_id;
  const existing = doc.edges.find(
    (e) => e.source === questionNodeId && e.source_handle === handle,
  );
  let next = existing ? deleteEdge(doc, existing.id) : doc;
  if (targetNodeId && targetNodeId !== questionNodeId) {
    next = addEdge(next, questionNodeId, targetNodeId, handle);
  }
  return next;
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
        ? { ...n, data: { ...n.data, question_type: newType, answers } }
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
