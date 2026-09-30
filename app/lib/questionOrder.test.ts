import { describe, expect, it } from "vitest";
import { orderedFlowSteps, orderedQuestions } from "./questionOrder";
import { Quiz } from "./quizSchema";

// Logic step P1-1: a per-answer route never renumbers the questions.

function q(id: string, n: number) {
  return {
    id,
    type: "question",
    position: { x: n, y: 0 },
    data: {
      text: `Question ${id}`,
      question_type: "single_select",
      role: "qualifier",
      answers: [
        { id: `${id}_a`, text: "A", tags: [], edge_handle_id: `${id}_ha` },
        { id: `${id}_b`, text: "B", tags: [], edge_handle_id: `${id}_hb` },
      ],
    },
  };
}

// intro → q1 → q2 → q3 → q4 → r1, plus optional extra edges.
function linearDoc(extraEdges: Array<Record<string, unknown>>, logicModel?: "decider") {
  return Quiz.parse({
    quiz_id: "qo",
    scope: { collection_ids: [] },
    ...(logicModel ? { logic_model: logicModel } : {}),
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      q("q1", 1),
      q("q2", 2),
      q("q3", 3),
      q("q4", 4),
      { id: "r1", type: "result", position: { x: 5, y: 0 }, data: { headline: "Match", fallback_collection_id: "c" } },
    ],
    edges: [
      { id: "e0", source: "intro", target: "q1" },
      { id: "e1", source: "q1", target: "q2" },
      { id: "e2", source: "q2", target: "q3" },
      { id: "e3", source: "q3", target: "q4" },
      { id: "e4", source: "q4", target: "r1" },
      ...extraEdges,
    ],
  });
}

const numbers = (doc: ReturnType<typeof linearDoc>) =>
  orderedQuestions(doc).map((x) => `${x.qIndex}:${x.node.id}`);

describe("orderedQuestions numbering (P1-1)", () => {
  it("a skip route (Q1 answer A → Q4) does not renumber a decider doc", () => {
    const before = numbers(linearDoc([], "decider"));
    const after = numbers(
      linearDoc([{ id: "r", source: "q1", target: "q4", source_handle: "q1_ha" }], "decider"),
    );
    expect(before).toEqual(["1:q1", "2:q2", "3:q3", "4:q4"]);
    expect(after).toEqual(before);
  });

  it("a route to the results does not renumber either", () => {
    const doc = linearDoc([{ id: "r", source: "q2", target: "r1", source_handle: "q2_hb" }], "decider");
    expect(numbers(doc)).toEqual(["1:q1", "2:q2", "3:q3", "4:q4"]);
  });

  it("the builder's flow steps number questions the same way", () => {
    const doc = linearDoc([{ id: "r", source: "q1", target: "q4", source_handle: "q1_ha" }], "decider");
    expect(orderedFlowSteps(doc).map((s) => `${s.qIndex}:${s.node.id}`)).toEqual([
      "1:q1",
      "2:q2",
      "3:q3",
      "4:q4",
    ]);
  });

  it("a question that routes every answer still orders its targets", () => {
    // q1 has no default edge: both answers route (A → q2, B → q3).
    const base = linearDoc([], "decider");
    const doc = Quiz.parse({
      ...base,
      edges: [
        ...base.edges.filter((e) => e.id !== "e1"),
        { id: "ra", source: "q1", target: "q2", source_handle: "q1_ha" },
        { id: "rb", source: "q1", target: "q3", source_handle: "q1_hb" },
      ],
    });
    expect(numbers(doc)).toEqual(["1:q1", "2:q2", "3:q3", "4:q4"]);
  });

  it("legacy docs keep the shortest-hop order (unchanged)", () => {
    const doc = linearDoc([{ id: "r", source: "q1", target: "q4", source_handle: "q1_ha" }]);
    expect(numbers(doc)).toEqual(["1:q1", "2:q2", "3:q4", "4:q3"]);
  });
});
