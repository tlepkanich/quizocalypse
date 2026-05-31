import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { progressPct, reachableQuestionCount } from "./progress";

describe("progressPct", () => {
  it("computes the percentage and clamps to [0,100]", () => {
    expect(progressPct(4, 0)).toBe(0);
    expect(progressPct(4, 2)).toBe(50);
    expect(progressPct(4, 4)).toBe(100);
    expect(progressPct(4, 9)).toBe(100); // clamp over
    expect(progressPct(3, 1)).toBe(33);
  });
  it("is 0 when there are no questions", () => {
    expect(progressPct(0, 0)).toBe(0);
  });
});

describe("reachableQuestionCount", () => {
  it("counts the question steps on the spine", () => {
    const doc = Quiz.parse({
      quiz_id: "q1",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "A?",
            question_type: "single_select",
            answers: [
              { id: "a1", text: "A", edge_handle_id: "h1" },
              { id: "a2", text: "B", edge_handle_id: "h2" },
            ],
          },
        },
        {
          id: "q2",
          type: "question",
          position: { x: 2, y: 0 },
          data: {
            text: "B?",
            question_type: "single_select",
            answers: [
              { id: "b1", text: "A", edge_handle_id: "h3" },
              { id: "b2", text: "B", edge_handle_id: "h4" },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 3, y: 0 },
          data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    expect(reachableQuestionCount(doc)).toBe(2);
  });
});
