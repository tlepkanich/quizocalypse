import { describe, expect, it } from "vitest";
import { perQuestionDropoff, conversionSummary, totalRevenue, formatRevenue } from "./funnelAggregation";

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

describe("totalRevenue (BIC P2)", () => {
  const rev = (order_id: string, total_price: string, currency = "USD", sessionId = "s") => ({
    sessionId,
    eventType: "order_attributed",
    payload: { order_id, total_price, currency },
  });

  it("dedupes multi-winner orders and groups by currency", () => {
    const out = totalRevenue([
      rev("o1", "50.00", "USD", "s1"),
      rev("o1", "50.00", "USD", "s2"), // same order, second winning session
      rev("o2", "25.50", "USD"),
      rev("o3", "10.00", "EUR"),
      { sessionId: "x", eventType: "quiz_started", payload: {} }, // ignored
    ]);
    expect(out.orders).toBe(3);
    expect(out.totalsByCurrency).toEqual({ USD: 75.5, EUR: 10 });
  });

  it("skips malformed payloads", () => {
    const out = totalRevenue([
      { sessionId: "a", eventType: "order_attributed", payload: { order_id: "", total_price: "x" } },
      { sessionId: "b", eventType: "order_attributed", payload: null },
      rev("ok", "5.00"),
    ]);
    expect(out.orders).toBe(1);
    expect(out.totalsByCurrency).toEqual({ USD: 5 });
  });

  it("formats for the stat card", () => {
    expect(formatRevenue({ orders: 0, totalsByCurrency: {} })).toBe("—");
    expect(formatRevenue({ orders: 2, totalsByCurrency: { USD: 75.5, EUR: 10 } })).toBe(
      "75.50 USD · 10.00 EUR",
    );
  });
});
