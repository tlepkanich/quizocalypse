import { describe, expect, it } from "vitest";
import { validateQuiz } from "./quizValidation";
import { Quiz } from "./quizSchema";

function makeQuiz(extra: Partial<Parameters<typeof Quiz.parse>[0]> = {}) {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: ["c1"] },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Welcome" },
      },
      {
        id: "q1",
        type: "question",
        position: { x: 200, y: 0 },
        data: {
          text: "Q?",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 400, y: 0 },
        data: { headline: "R", fallback_collection_id: "c1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
    ...extra,
  });
}

describe("validateQuiz", () => {
  it("returns no issues for a well-formed linear quiz", () => {
    expect(validateQuiz(makeQuiz())).toEqual([]);
  });

  it("flags intro without outbound edges", () => {
    const issues = validateQuiz(makeQuiz({ edges: [] }));
    expect(
      issues.some(
        (i) => i.nodeId === "intro" && i.kind === "intro_missing_outbound",
      ),
    ).toBe(true);
  });

  it("flags orphan nodes unreachable from intro", () => {
    const quiz = makeQuiz({
      // Drop the intro→q1 edge — now q1 is unreachable.
      edges: [{ id: "e2", source: "q1", target: "r1" }],
    });
    const issues = validateQuiz(quiz);
    expect(issues.some((i) => i.nodeId === "q1" && i.kind === "orphan")).toBe(
      true,
    );
  });

  it("flags questions with no outbound edges as dead-ends", () => {
    const quiz = makeQuiz({
      edges: [{ id: "e1", source: "intro", target: "q1" }],
    });
    const issues = validateQuiz(quiz);
    expect(issues.some((i) => i.nodeId === "q1" && i.kind === "dead_end")).toBe(
      true,
    );
  });

  it("flags result nodes missing a fallback_collection_id", () => {
    // Build manually to skip Zod's hard min(1) on fallback_collection_id.
    const issues = validateQuiz({
      ...makeQuiz(),
      nodes: makeQuiz().nodes.map((n) =>
        n.id === "r1" && n.type === "result"
          ? { ...n, data: { ...n.data, fallback_collection_id: "" } }
          : n,
      ),
    });
    expect(
      issues.some(
        (i) => i.nodeId === "r1" && i.kind === "missing_fallback",
      ),
    ).toBe(true);
  });

  it("does not flag a result node as dead-end (results are terminals)", () => {
    const issues = validateQuiz(makeQuiz());
    expect(
      issues.some((i) => i.nodeId === "r1" && i.kind === "dead_end"),
    ).toBe(false);
  });
});
