import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { reachedBy, tracePath, answerRoutes } from "./routeTrace";

// Branched fixture: intro → q1; q1.a1 → q2 → r1; q1.a2 → r2 (direct).
const RAW = {
  quiz_id: "qz_trace",
  scope: { collection_ids: [] },
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Welcome" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "What matters most?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "Comfort", tags: ["comfort"], edge_handle_id: "h1" },
          { id: "a2", text: "Speed", tags: ["speed"], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "How experienced are you?",
        question_type: "single_select",
        answers: [
          { id: "a3", text: "New", tags: [], edge_handle_id: "h3" },
          { id: "a4", text: "Pro", tags: [], edge_handle_id: "h4" },
        ],
      },
    },
    {
      id: "r1",
      type: "result",
      position: { x: 3, y: 0 },
      data: { headline: "Comfort picks", fallback_collection_id: "gid://c/1" },
    },
    {
      id: "r2",
      type: "result",
      position: { x: 3, y: 1 },
      data: { headline: "Speed picks", fallback_collection_id: "gid://c/2" },
    },
  ],
  edges: [
    { id: "e0", source: "intro", target: "q1" },
    { id: "e1", source: "q1", target: "q2", source_handle: "h1" },
    { id: "e2", source: "q1", target: "r2", source_handle: "h2" },
    { id: "e3", source: "q2", target: "r1" },
  ],
};
const doc = () => Quiz.parse(structuredClone(RAW));

describe("reachedBy", () => {
  it("labels the answer that routes directly to a result", () => {
    const entries = reachedBy(doc(), "r2");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.via).toBe("answer");
    expect(entries[0]!.label).toContain("Speed");
    expect(entries[0]!.sourceNodeId).toBe("q1");
  });

  it("labels a default (un-handled) edge by its source node", () => {
    const entries = reachedBy(doc(), "r1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.via).toBe("default");
    expect(entries[0]!.label).toContain("How experienced");
  });
});

describe("tracePath", () => {
  it("follows the chosen answer's branch to its result", () => {
    const t = tracePath(doc(), { q1: "a2" });
    expect(t.resultNodeId).toBe("r2");
    expect(t.steps.map((s) => s.nodeId)).toEqual(["intro", "q1", "r2"]);
    expect(t.steps[1]!.pickedAnswerText).toBe("Speed");
  });

  it("defaults unanswered questions to their first answer", () => {
    const t = tracePath(doc(), {});
    expect(t.resultNodeId).toBe("r1");
    expect(t.steps.map((s) => s.nodeId)).toEqual(["intro", "q1", "q2", "r1"]);
  });
});

describe("answerRoutes", () => {
  it("returns per-answer targets when answers diverge", () => {
    const routes = answerRoutes(doc(), "q1");
    expect(routes).toHaveLength(2);
    expect(routes.find((r) => r.answerId === "a1")!.targetLabel).toContain("How experienced");
    expect(routes.find((r) => r.answerId === "a2")!.targetLabel).toContain("Speed picks");
  });

  it("returns [] when every answer goes to the same place (no badge noise)", () => {
    expect(answerRoutes(doc(), "q2")).toEqual([]);
  });
});
