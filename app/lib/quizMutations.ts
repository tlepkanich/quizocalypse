import { ResultData } from "./quizSchema";
import type { Quiz } from "./quizSchema";
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
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== nodeId),
    edges: doc.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
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
      const isFreeform =
        n.data.question_type === "text" || n.data.question_type === "email";
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
