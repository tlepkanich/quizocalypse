import { describe, expect, it } from "vitest";
import { perQuestionDropoff, conversionSummary } from "./funnelAggregation";

const ev = (sessionId: string, question_id: string) => ({
  sessionId,
  eventType: "question_answered",
  payload: { question_id },
});

describe("perQuestionDropoff", () => {
  it("counts distinct sessions per question and computes drop-off vs starts", () => {
    const events = [
      ev("a", "q1"),
      ev("b", "q1"),
      ev("c", "q1"),
      ev("a", "q1"), // duplicate session on q1 → still 1
      ev("a", "q2"),
      ev("b", "q2"),
      // c dropped before q2
    ];
    const out = perQuestionDropoff(events, [
      { id: "q1", text: "First" },
      { id: "q2", text: "Second" },
    ], 4);
    expect(out[0]).toMatchObject({ questionId: "q1", answered: 3, pctOfStarted: 0.75 });
    expect(out[1]).toMatchObject({ questionId: "q2", answered: 2, pctOfStarted: 0.5 });
  });

  it("ignores non-answer events and missing question_id; 0% when nothing started", () => {
    const events = [
      { sessionId: "a", eventType: "quiz_started", payload: {} },
      { sessionId: "a", eventType: "question_answered", payload: {} }, // no question_id
    ];
    const out = perQuestionDropoff(events, [{ id: "q1", text: "Q" }], 0);
    expect(out[0]).toMatchObject({ answered: 0, pctOfStarted: 0 });
  });
});

describe("conversionSummary", () => {
  it("computes completed, converted, and rate", () => {
    const s = conversionSummary([
      { completedAt: new Date(), converted: true },
      { completedAt: new Date(), converted: false },
      { completedAt: new Date(), converted: true },
      { completedAt: null, converted: false }, // not completed
    ]);
    expect(s).toEqual({ completed: 3, converted: 2, rate: 2 / 3 });
  });

  it("rate is 0 when nothing completed", () => {
    expect(conversionSummary([{ completedAt: null, converted: false }])).toEqual({
      completed: 0,
      converted: 0,
      rate: 0,
    });
  });
});
