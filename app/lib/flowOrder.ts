import type { Quiz as QuizDoc, QuizNode } from "./quizSchema";

// Pure flow-ordering for the quiz graph. Walks intro → … → result(s) along
// edges into a left-to-right ordered structure, modeling a `branch` node as N
// parallel lanes (one per slot). Mirrors quizValidation.ts's BFS-from-intro
// reachability approach. No React / DOM / prisma — deterministic, relying on
// `doc.nodes` / `doc.edges` array order (never on `position`).

export interface OrderedStep {
  nodeId: string;
  type: QuizNode["type"];
  // 0-based left-to-right rank = shortest hop count from intro.
  column: number;
  // "main" or `${branchNodeId}:${slotId}`.
  laneId: string;
  // Edge source node ids pointing at this node (merge detection).
  incomingFrom: string[];
}

export interface OrderedLane {
  laneId: string; // `${branchNodeId}:${slotId}`
  slotId: string;
  slotLabel: string;
  branchNodeId: string;
  // Steps down this slot until a merge/terminal; [] when the slot has no
  // outbound edge.
  steps: OrderedStep[];
}

export interface OrderedFlow {
  // The MAIN spine in column order, starting at intro.
  steps: OrderedStep[];
  // Every lane, flattened.
  branches: OrderedLane[];
  // Node ids never reached from intro.
  orphans: string[];
  // Node ids where a back-edge was detected and pruned.
  cycles: string[];
  // Index of every spine + lane step.
  byId: Map<string, OrderedStep>;
  introId: string | null;
}

interface OutEdge {
  edgeId: string;
  target: string;
  sourceHandle?: string;
}

const MAIN_LANE = "main";

export function orderFlow(doc: QuizDoc): OrderedFlow {
  // 1. Adjacency. Iterate edges in array order for determinism.
  const out = new Map<string, OutEdge[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of doc.edges) {
    const outList = out.get(edge.source) ?? [];
    outList.push({
      edgeId: edge.id,
      target: edge.target,
      sourceHandle: edge.source_handle,
    });
    out.set(edge.source, outList);

    const inList = incoming.get(edge.target) ?? [];
    inList.push(edge.source);
    incoming.set(edge.target, inList);
  }

  const typeById = new Map<string, QuizNode["type"]>();
  for (const node of doc.nodes) typeById.set(node.id, node.type);

  // 2. Locate the single intro entry point.
  const intro = doc.nodes.find((n) => n.type === "intro");
  if (!intro) {
    return {
      steps: [],
      branches: [],
      orphans: doc.nodes.filter((n) => n.type !== "intro").map((n) => n.id),
      cycles: [],
      byId: new Map(),
      introId: null,
    };
  }

  const visited = new Set<string>();
  const column = new Map<string, number>();
  const cycles: string[] = [];
  const cycleSeen = new Set<string>(); // de-dupe cycle reports

  // First-visit-wins column assignment, shared across spine + lane walks so a
  // node reachable via several routes keeps its shortest hop count.
  const assignColumn = (id: string, col: number): void => {
    const prev = column.get(id);
    if (prev === undefined || col < prev) column.set(id, col);
  };

  const isBranch = (id: string): boolean => typeById.get(id) === "branch";

  // A node is terminal for lane-walking purposes when it has no outbound edge.
  // (result / end are the natural terminals, but any sink stops the walk.)
  const hasOutbound = (id: string): boolean => (out.get(id)?.length ?? 0) > 0;

  // BFS the MAIN spine from intro. We do NOT inline a branch node's targets —
  // when we reach a branch we record its column but stop descending; its slots
  // are explored as separate lanes below.
  assignColumn(intro.id, 0);
  visited.add(intro.id);
  const spineOrder: string[] = [intro.id];

  // Parent links from the spine BFS tree. An edge u → v where v is an ANCESTOR
  // of u (on the path from intro to u) is a back-edge → cycle. An edge to an
  // already-visited NON-ancestor node is a forward/cross merge.
  const parent = new Map<string, string>();
  const isAncestorOf = (ancestor: string, node: string): boolean => {
    let cur: string | undefined = node;
    while (cur !== undefined) {
      if (cur === ancestor) return true;
      cur = parent.get(cur);
    }
    return false;
  };
  const recordCycle = (id: string): void => {
    if (cycleSeen.has(id)) return;
    cycleSeen.add(id);
    cycles.push(id);
  };

  const spineQueue: string[] = [intro.id];
  while (spineQueue.length) {
    const id = spineQueue.shift()!;
    if (isBranch(id)) continue; // do not inline branch successors on the spine
    const col = column.get(id) ?? 0;
    for (const edge of out.get(id) ?? []) {
      const target = edge.target;
      if (!visited.has(target)) {
        visited.add(target);
        parent.set(target, id);
        assignColumn(target, col + 1);
        spineOrder.push(target);
        spineQueue.push(target);
      } else if (target === id || isAncestorOf(target, id)) {
        // Back-edge onto the active path → cycle. Prune (don't re-enqueue).
        recordCycle(target);
      } else {
        // Already on the spine, non-ancestor: a merge. column stays
        // first-visit-wins.
        assignColumn(target, col + 1);
      }
    }
  }

  // 3 + 4. Explore branch lanes. Each branch slot opens a lane; we BFS the
  // subgraph from edges whose source === branchId && source_handle === slotId,
  // collecting steps until reaching a node already on the main spine (a merge —
  // leave it on the spine) or a terminal. Cycle-safe via a per-walk active set.
  const branches: OrderedLane[] = [];

  for (const node of doc.nodes) {
    if (node.type !== "branch") continue;
    if (!visited.has(node.id)) continue; // unreachable branch → its slots are orphans too
    const branchCol = column.get(node.id) ?? 0;

    for (const slot of node.data.slots) {
      const laneId = `${node.id}:${slot.id}`;
      const laneStepIds: string[] = [];

      // Seed: edges from this branch on this slot's handle.
      const seeds = (out.get(node.id) ?? []).filter(
        (e) => e.sourceHandle === slot.id,
      );

      // Per-lane BFS. `active` tracks the lane's own path for back-edge
      // detection; `laneVisited` prevents re-processing within the lane.
      const laneVisited = new Set<string>();
      const active = new Set<string>([node.id]);
      const queue: { id: string; col: number }[] = [];
      for (const seed of seeds) {
        queue.push({ id: seed.target, col: branchCol + 1 });
      }

      while (queue.length) {
        const { id: cur, col } = queue.shift()!;

        // Back-edge into the branch itself or onto this lane's active path.
        if (active.has(cur)) {
          recordCycle(cur);
          continue;
        }

        // Merge onto the main spine: stop here, leave the node on the spine.
        // The branch is already recorded in its incomingFrom via the edge.
        if (visited.has(cur)) {
          assignColumn(cur, col);
          continue;
        }

        if (laneVisited.has(cur)) continue;
        laneVisited.add(cur);
        active.add(cur);
        visited.add(cur); // reachable from intro (via this lane)
        assignColumn(cur, col);
        laneStepIds.push(cur);

        // Terminal (no outbound) → stop. Nested branch → record column but do
        // not inline; its own slots get their own lanes in the outer loop.
        if (!hasOutbound(cur) || isBranch(cur)) continue;

        for (const edge of out.get(cur) ?? []) {
          queue.push({ id: edge.target, col: col + 1 });
        }
      }

      const steps: OrderedStep[] = laneStepIds.map((id) => ({
        nodeId: id,
        type: typeById.get(id)!,
        column: column.get(id) ?? 0,
        laneId,
        incomingFrom: incoming.get(id) ?? [],
      }));

      branches.push({
        laneId,
        slotId: slot.id,
        slotLabel: slot.label,
        branchNodeId: node.id,
        steps,
      });
    }
  }

  // 5. Orphans: non-intro nodes never reached from intro.
  const orphans = doc.nodes
    .filter((n) => n.type !== "intro" && !visited.has(n.id))
    .map((n) => n.id);

  // Materialize spine steps in BFS discovery order (already column-sorted-ish
  // since BFS visits shallower nodes first; sort defensively by column with
  // discovery order as the tiebreaker for determinism).
  const spineDiscovery = new Map<string, number>();
  spineOrder.forEach((id, idx) => spineDiscovery.set(id, idx));
  const sortedSpine = [...spineOrder].sort((a, b) => {
    const ca = column.get(a) ?? 0;
    const cb = column.get(b) ?? 0;
    if (ca !== cb) return ca - cb;
    return (spineDiscovery.get(a) ?? 0) - (spineDiscovery.get(b) ?? 0);
  });

  const steps: OrderedStep[] = sortedSpine.map((id) => ({
    nodeId: id,
    type: typeById.get(id)!,
    column: column.get(id) ?? 0,
    laneId: MAIN_LANE,
    incomingFrom: incoming.get(id) ?? [],
  }));

  // 6. Index every spine step and every lane step.
  const byId = new Map<string, OrderedStep>();
  for (const step of steps) byId.set(step.nodeId, step);
  for (const lane of branches) {
    for (const step of lane.steps) byId.set(step.nodeId, step);
  }

  return {
    steps,
    branches,
    orphans,
    cycles,
    byId,
    introId: intro.id,
  };
}
