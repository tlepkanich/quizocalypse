// BIC-2 C3a — node-level mutations for the non-question steps (email gate,
// message, end, integration, product cards, ask-AI) plus branch nodes/slots,
// node deletion, and canvas positioning. Pure move out of quizMutations.ts.
import { uid, nextPosition, type QuizDoc, type QuizNodeDoc } from "./shared";

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
