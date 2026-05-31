import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { orderFlow } from "./flowOrder";
import { Quiz } from "./quizSchema";

type QuizInput = z.input<typeof Quiz>;
type NodeInput = QuizInput["nodes"][number];
type EdgeInput = NonNullable<QuizInput["edges"]>[number];

// Minimal node builders. Each gives the type's required `data` shape so
// Quiz.parse accepts the doc. positions are arbitrary (ordering must NOT
// depend on them).
function intro(id: string): NodeInput {
  return {
    id,
    type: "intro",
    position: { x: 0, y: 0 },
    data: { headline: "Welcome" },
  };
}

function question(id: string): NodeInput {
  return {
    id,
    type: "question",
    position: { x: 0, y: 0 },
    data: {
      text: "Q?",
      question_type: "single_select",
      answers: [
        { id: `${id}-a1`, text: "A", tags: [], edge_handle_id: `${id}-h1` },
        { id: `${id}-a2`, text: "B", tags: [], edge_handle_id: `${id}-h2` },
      ],
    },
  };
}

function result(id: string): NodeInput {
  return {
    id,
    type: "result",
    position: { x: 0, y: 0 },
    data: { headline: "R", fallback_collection_id: "c1" },
  };
}

function branch(id: string, slots: { id: string; label: string }[]): NodeInput {
  return {
    id,
    type: "branch",
    position: { x: 0, y: 0 },
    data: {
      label: "Branch",
      mode: "rules",
      slots: slots.map((s) => ({ id: s.id, label: s.label, weight: 1 })),
    },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
): EdgeInput {
  return sourceHandle
    ? { id, source, target, source_handle: sourceHandle }
    : { id, source, target };
}

function makeQuiz(nodes: NodeInput[], edges: EdgeInput[]) {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: ["c1"] },
    nodes,
    edges,
  });
}

describe("orderFlow", () => {
  it("orders a linear intro→question→result", () => {
    const flow = orderFlow(
      makeQuiz(
        [intro("intro"), question("q1"), result("r1")],
        [edge("e1", "intro", "q1"), edge("e2", "q1", "r1")],
      ),
    );

    expect(flow.introId).toBe("intro");
    expect(flow.steps.map((s) => s.nodeId)).toEqual(["intro", "q1", "r1"]);
    expect(flow.steps.map((s) => s.column)).toEqual([0, 1, 2]);
    expect(flow.steps.every((s) => s.laneId === "main")).toBe(true);
    expect(flow.branches).toEqual([]);
    expect(flow.orphans).toEqual([]);
    expect(flow.cycles).toEqual([]);
    expect(flow.byId.get("r1")?.column).toBe(2);
  });

  it("increments columns across two questions in a row", () => {
    const flow = orderFlow(
      makeQuiz(
        [intro("intro"), question("q1"), question("q2"), result("r1")],
        [
          edge("e1", "intro", "q1"),
          edge("e2", "q1", "q2"),
          edge("e3", "q2", "r1"),
        ],
      ),
    );

    expect(flow.steps.map((s) => s.nodeId)).toEqual([
      "intro",
      "q1",
      "q2",
      "r1",
    ]);
    expect(flow.steps.map((s) => s.column)).toEqual([0, 1, 2, 3]);
  });

  it("models a branch as parallel lanes, one per slot", () => {
    const flow = orderFlow(
      makeQuiz(
        [
          intro("intro"),
          branch("b1", [
            { id: "s1", label: "Slot A" },
            { id: "s2", label: "Slot B" },
          ]),
          result("rA"),
          result("rB"),
        ],
        [
          edge("e1", "intro", "b1"),
          edge("e2", "b1", "rA", "s1"),
          edge("e3", "b1", "rB", "s2"),
        ],
      ),
    );

    // Spine stops at the branch — its targets are not inlined.
    expect(flow.steps.map((s) => s.nodeId)).toEqual(["intro", "b1"]);
    expect(flow.branches).toHaveLength(2);

    const laneA = flow.branches.find((l) => l.laneId === "b1:s1");
    const laneB = flow.branches.find((l) => l.laneId === "b1:s2");
    expect(laneA?.slotLabel).toBe("Slot A");
    expect(laneB?.slotLabel).toBe("Slot B");
    expect(laneA?.branchNodeId).toBe("b1");
    expect(laneA?.steps.map((s) => s.nodeId)).toEqual(["rA"]);
    expect(laneB?.steps.map((s) => s.nodeId)).toEqual(["rB"]);
    // Lane steps carry their lane id and a column past the branch.
    expect(laneA?.steps[0]?.laneId).toBe("b1:s1");
    expect(laneA?.steps[0]?.column).toBe(2);
    // Indexed in byId.
    expect(flow.byId.get("rA")?.laneId).toBe("b1:s1");
    expect(flow.orphans).toEqual([]);
  });

  it("leaves a slot's steps empty when it has no outbound edge", () => {
    const flow = orderFlow(
      makeQuiz(
        [
          intro("intro"),
          branch("b1", [
            { id: "s1", label: "Wired" },
            { id: "s2", label: "Dangling" },
          ]),
          result("rA"),
        ],
        [
          edge("e1", "intro", "b1"),
          edge("e2", "b1", "rA", "s1"),
          // s2 has no outbound edge.
        ],
      ),
    );

    const wired = flow.branches.find((l) => l.laneId === "b1:s1");
    const dangling = flow.branches.find((l) => l.laneId === "b1:s2");
    expect(wired?.steps.map((s) => s.nodeId)).toEqual(["rA"]);
    expect(dangling?.steps).toEqual([]);
  });

  it("handles a diamond: both slots merge into the same result", () => {
    const flow = orderFlow(
      makeQuiz(
        [
          intro("intro"),
          branch("b1", [
            { id: "s1", label: "Left" },
            { id: "s2", label: "Right" },
          ]),
          question("mid1"),
          question("mid2"),
          result("rJoin"),
        ],
        [
          edge("e1", "intro", "b1"),
          edge("e2", "b1", "mid1", "s1"),
          edge("e3", "b1", "mid2", "s2"),
          edge("e4", "mid1", "rJoin"),
          edge("e5", "mid2", "rJoin"),
        ],
      ),
    );

    // The shared result appears exactly once across the whole structure.
    const allStepIds = [
      ...flow.steps.map((s) => s.nodeId),
      ...flow.branches.flatMap((l) => l.steps.map((s) => s.nodeId)),
    ];
    expect(allStepIds.filter((id) => id === "rJoin")).toHaveLength(1);

    const join = flow.byId.get("rJoin");
    expect(join).toBeDefined();
    // incomingFrom lists both lane tails.
    expect(join?.incomingFrom).toEqual(
      expect.arrayContaining(["mid1", "mid2"]),
    );
    expect(join?.incomingFrom).toHaveLength(2);
  });

  it("collects unreachable nodes as orphans", () => {
    const flow = orderFlow(
      makeQuiz(
        [intro("intro"), question("q1"), result("r1"), question("lonely")],
        [edge("e1", "intro", "q1"), edge("e2", "q1", "r1")],
      ),
    );

    expect(flow.orphans).toEqual(["lonely"]);
    expect(flow.steps.some((s) => s.nodeId === "lonely")).toBe(false);
    expect(flow.byId.has("lonely")).toBe(false);
  });

  it("is cycle-safe: prunes back-edges and still returns", () => {
    const flow = orderFlow(
      makeQuiz(
        [intro("intro"), question("q1"), question("q2"), result("r1")],
        [
          edge("e1", "intro", "q1"),
          edge("e2", "q1", "q2"),
          edge("e3", "q2", "q1"), // back-edge → cycle
          edge("e4", "q2", "r1"),
        ],
      ),
    );

    expect(flow.cycles.length).toBeGreaterThan(0);
    // All real nodes still ordered, no infinite loop.
    expect(flow.steps.map((s) => s.nodeId)).toEqual([
      "intro",
      "q1",
      "q2",
      "r1",
    ]);
    expect(flow.orphans).toEqual([]);
  });

  it("treats every non-intro node as an orphan when intro is missing", () => {
    // Build a doc with no intro. Quiz requires ≥2 nodes; use two questions.
    const flow = orderFlow(
      makeQuiz(
        [question("q1"), result("r1")],
        [edge("e1", "q1", "r1")],
      ),
    );

    expect(flow.introId).toBeNull();
    expect(flow.steps).toEqual([]);
    expect(flow.branches).toEqual([]);
    expect(flow.orphans).toEqual(expect.arrayContaining(["q1", "r1"]));
    expect(flow.orphans).toHaveLength(2);
  });
});
