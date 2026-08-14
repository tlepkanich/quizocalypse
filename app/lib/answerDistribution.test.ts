import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { answerDistributions } from "./answerDistribution";

// ANALYTICS P0 — answer distributions: skip bucket, last-write-wins dedupe,
// removed-option survival, multi-select share semantics, freeform counts.

const DOC = Quiz.parse({
  quiz_id: "qz",
  status: "published",
  scope: { collection_ids: [] },
  nodes: [
    { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Concerns?",
        question_type: "multi_select",
        answers: [
          { id: "a1", text: "Dryness", tags: [], edge_handle_id: "h1" },
          { id: "a2", text: "Redness", tags: [], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "Your name?",
        question_type: "text",
        answers: [{ id: "t1", text: "default", tags: [], edge_handle_id: "h3" }],
      },
    },
    { id: "r1", type: "result", position: { x: 3, y: 0 }, data: { headline: "Done", fallback_collection_id: "c" } },
  ],
  edges: [
    { id: "e1", source: "i1", target: "q1" },
    { id: "e2", source: "q1", target: "q2" },
    { id: "e3", source: "q2", target: "r1" },
  ],
});

const ans = (sessionId: string, qid: string, ids: string[], ts = 0) => ({
  sessionId,
  eventType: "question_answered",
  payload: { question_id: qid, answer_ids: ids },
  ts,
});

describe("answerDistributions", () => {
  it("skip ([]) is its own bucket; multi-select counts distinct sessions per option", () => {
    const dists = answerDistributions(DOC, [
      ans("s1", "q1", ["a1", "a2"]),
      ans("s2", "q1", ["a1"]),
      ans("s3", "q1", []),
    ]);
    const q1 = dists.find((d) => d.questionId === "q1")!;
    expect(q1).toMatchObject({ reached: 3, answered: 2, skipped: 1, multi: true });
    expect(q1.avgPicks).toBeCloseTo(1.5);
    const dry = q1.options.find((o) => o.answerId === "a1")!;
    expect(dry.sessions).toBe(2);
    expect(dry.share).toBe(1); // 2 of 2 answering sessions picked it
  });

  it("last write wins per (session, question)", () => {
    const dists = answerDistributions(DOC, [
      ans("s1", "q1", ["a1"], 1),
      ans("s1", "q1", ["a2"], 2), // re-answer replaces
    ]);
    const q1 = dists.find((d) => d.questionId === "q1")!;
    expect(q1.answered).toBe(1);
    expect(q1.options.find((o) => o.answerId === "a1")!.sessions).toBe(0);
    expect(q1.options.find((o) => o.answerId === "a2")!.sessions).toBe(1);
  });

  it("an answer id the doc no longer knows surfaces as '(removed option)' instead of vanishing", () => {
    const dists = answerDistributions(DOC, [ans("s1", "q1", ["ghost"])]);
    const q1 = dists.find((d) => d.questionId === "q1")!;
    const ghost = q1.options.find((o) => o.answerId === "ghost")!;
    expect(ghost.label).toBe("(removed option)");
    expect(ghost.sessions).toBe(1);
  });

  it("freeform questions report counts, not bars", () => {
    const dists = answerDistributions(DOC, [ans("s1", "q2", ["typed"])]);
    const q2 = dists.find((d) => d.questionId === "q2")!;
    expect(q2.freeform).toBe(true);
    expect(q2.options).toEqual([]);
    expect(q2.answered).toBe(1);
  });
});
