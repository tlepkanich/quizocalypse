import { describe, expect, it } from "vitest";
import { detectHotspots, HOTSPOT_MIN_STARTED } from "./abandonmentHotspots";
import type { QuestionDropoff } from "./funnelAggregation";

// Build a QuestionDropoff row with a given reached-fraction (pctOfStarted).
const q = (id: string, pct: number, text?: string): QuestionDropoff => ({
  questionId: id,
  text: text ?? id,
  answered: Math.round(pct * 100),
  pctOfStarted: pct,
});

describe("detectHotspots", () => {
  it("returns [] for an empty dropoff", () => {
    expect(detectHotspots([], 100)).toEqual([]);
  });

  it("returns [] below the min-volume guard, even with an obvious cliff", () => {
    const cliff = [q("q1", 0.95), q("q2", 0.2)];
    expect(detectHotspots(cliff, HOTSPOT_MIN_STARTED - 1)).toEqual([]);
    // …and flags once volume clears the guard.
    expect(detectHotspots(cliff, HOTSPOT_MIN_STARTED).length).toBe(1);
  });

  it("flags a single clear cliff as crit, leaving gentle steps alone", () => {
    const rows = [q("q1", 0.95), q("q2", 0.45), q("q3", 0.4)];
    const hot = detectHotspots(rows, 100);
    expect(hot).toHaveLength(1);
    expect(hot[0]).toMatchObject({ questionId: "q2", index: 2, severity: "crit" });
    expect(hot[0]!.pctLostHere).toBeCloseTo(0.5, 5);
  });

  it("flags nothing on a gentle even decline", () => {
    const rows = [q("q1", 0.9), q("q2", 0.82), q("q3", 0.75), q("q4", 0.68)];
    expect(detectHotspots(rows, 100)).toEqual([]);
  });

  it("distinguishes warn (≥25pp) from crit (≥40pp)", () => {
    expect(detectHotspots([q("q1", 0.7)], 100)[0]).toMatchObject({ severity: "warn" });
    expect(detectHotspots([q("q1", 0.55)], 100)[0]).toMatchObject({ severity: "crit" });
  });

  it("uses a starting-specific suggestion for the first question", () => {
    const hot = detectHotspots([q("q1", 0.55)], 100);
    expect(hot[0]!.index).toBe(1);
    expect(hot[0]!.suggestion).toMatch(/after starting/i);
  });

  it("uses a mid-quiz suggestion for a later question", () => {
    const hot = detectHotspots([q("q1", 0.95), q("q2", 0.5)], 100);
    expect(hot[0]!.questionId).toBe("q2");
    expect(hot[0]!.suggestion).toMatch(/branch away|optional|education card/i);
  });

  it("caps the list worst-first (max 3) and is deterministic", () => {
    // Four equal 25pp marginal drops (1→.75→.50→.25→0) → all flag, capped to 3.
    const rows = [q("q1", 0.75), q("q2", 0.5), q("q3", 0.25), q("q4", 0.0)];
    const hot = detectHotspots(rows, 1000);
    expect(hot).toHaveLength(3);
    // equal losses → stable by flow order, so the 4th is dropped.
    expect(hot.map((h) => h.questionId)).toEqual(["q1", "q2", "q3"]);
    // determinism: same input → same output.
    expect(detectHotspots(rows, 1000)).toEqual(hot);
  });

  it("orders by loss magnitude, worst first", () => {
    const rows = [q("q1", 0.7), q("q2", 0.2)]; // q1 loses .3, q2 loses .5
    const hot = detectHotspots(rows, 100);
    expect(hot.map((h) => h.questionId)).toEqual(["q2", "q1"]);
  });
});
