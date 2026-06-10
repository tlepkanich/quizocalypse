import { describe, expect, it } from "vitest";
import { computeAnswerWeights, MIN_COMPLETED_SESSIONS } from "./answerPerformance";

const session = (answerIds: string[], converted: boolean, completed = true) => ({
  answerIds,
  converted,
  completedAt: completed ? "2026-06-01T00:00:00Z" : null,
});

describe("computeAnswerWeights (Phase J)", () => {
  it("gates below the data minimums (and on zero conversions)", () => {
    const few = Array.from({ length: 10 }, () => session(["a1"], true));
    expect(computeAnswerWeights(few).eligible).toBe(false);

    const manyNoConv = Array.from({ length: 50 }, () => session(["a1"], false));
    const r = computeAnswerWeights(manyNoConv);
    expect(r.eligible).toBe(false);
    expect(r.completed).toBe(50);
    expect(r.conversions).toBe(0);
  });

  it("ignores incomplete sessions entirely", () => {
    const sessions = [
      ...Array.from({ length: MIN_COMPLETED_SESSIONS - 1 }, () => session(["a1"], true)),
      session(["a1"], true, false), // incomplete — must not count
    ];
    expect(computeAnswerWeights(sessions).eligible).toBe(false);
  });

  it("boosts answers that convert above baseline and dampens ones below", () => {
    // 40 sessions, 10 conversions (baseline 25%). "winner" appears in all 10
    // conversions and 5 non-conversions (67% raw); "loser" only in
    // non-conversions (0% raw).
    const sessions = [
      ...Array.from({ length: 10 }, () => session(["winner", "shared"], true)),
      ...Array.from({ length: 5 }, () => session(["winner", "shared"], false)),
      ...Array.from({ length: 15 }, () => session(["loser", "shared"], false)),
      ...Array.from({ length: 10 }, () => session(["shared"], false)),
    ];
    const r = computeAnswerWeights(sessions);
    expect(r.eligible).toBe(true);
    expect(r.completed).toBe(40);
    expect(r.conversions).toBe(10);
    expect(r.weights["winner"]).toBeGreaterThan(1);
    expect(r.weights["loser"]).toBeLessThan(1);
    expect(r.weights["loser"]).toBeGreaterThanOrEqual(0.5); // clamp floor
    // "shared" appears everywhere → near-neutral → pruned from the map.
    expect(r.weights["shared"]).toBeUndefined();
  });

  it("clamps extreme lift to 2x", () => {
    // Tiny baseline, one answer in every conversion → raw lift would be huge.
    const sessions = [
      ...Array.from({ length: 5 }, () => session(["hot"], true)),
      ...Array.from({ length: 95 }, () => session(["cold"], false)),
    ];
    const r = computeAnswerWeights(sessions);
    expect(r.eligible).toBe(true);
    expect(r.weights["hot"]).toBeLessThanOrEqual(2);
  });

  it("dedupes repeated answer ids within one session", () => {
    const sessions = [
      ...Array.from({ length: 30 }, () => session(["a1", "a1"], true)),
      ...Array.from({ length: 10 }, () => session(["a2"], false)),
    ];
    const r = computeAnswerWeights(sessions);
    // a1 seen in 30 sessions (not 60) — smoothing math stays per-session.
    expect(r.eligible).toBe(true);
    expect(r.weights["a1"]).toBeGreaterThan(1);
  });
});
