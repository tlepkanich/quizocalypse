import { describe, expect, it } from "vitest";
import { computeBenchmarks } from "./quizBenchmarks";

const row = (quizId: string, eventType: string, sessionId: string) => ({
  quizId,
  eventType,
  sessionId,
});

describe("computeBenchmarks", () => {
  it("computes per-quiz rates from distinct sessions and a pooled average", () => {
    const rows = [
      // qA: 4 starts, 2 completions → 50%
      ...["s1", "s2", "s3", "s4"].map((s) => row("qA", "quiz_engaged", s)),
      ...["s1", "s2"].map((s) => row("qA", "quiz_completed", s)),
      // qB: 6 starts, 6 completions → 100%
      ...["t1", "t2", "t3", "t4", "t5", "t6"].map((s) => row("qB", "quiz_engaged", s)),
      ...["t1", "t2", "t3", "t4", "t5", "t6"].map((s) => row("qB", "quiz_completed", s)),
      // irrelevant event types are ignored
      row("qA", "quiz_started", "s9"),
    ];
    const b = computeBenchmarks(rows);
    expect(b.byQuiz["qA"]).toEqual({ started: 4, completed: 2, rate: 50 });
    expect(b.byQuiz["qB"]).toEqual({ started: 6, completed: 6, rate: 100 });
    // Pooled: 8/10 = 80 — NOT the 75 a mean-of-rates would give.
    expect(b.averageRate).toBe(80);
  });

  it("caps completions at starts (resume edge) and handles empty input", () => {
    const rows = [
      row("qC", "quiz_completed", "x1"),
      row("qC", "quiz_completed", "x2"),
      row("qC", "quiz_engaged", "x1"),
    ];
    const b = computeBenchmarks(rows);
    expect(b.byQuiz["qC"]).toEqual({ started: 1, completed: 1, rate: 100 });
    expect(computeBenchmarks([]).averageRate).toBeNull();
  });
});
