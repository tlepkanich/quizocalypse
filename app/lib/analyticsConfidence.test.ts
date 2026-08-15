import { describe, expect, it } from "vitest";
import { wilson, ruleOfThree, separated, gateRate, formatPct, formatPctRange } from "./analyticsConfidence";

// ANALYTICS P0 — §7.2 confidence primitives + the §7.3 hard gates.

describe("wilson", () => {
  it("stays inside [0,1] and keeps width at the extremes (x=0 and x=n)", () => {
    const zero = wilson(0, 20);
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBeGreaterThan(0); // never a confident 0%
    const full = wilson(20, 20);
    expect(full.hi).toBe(1);
    expect(full.lo).toBeLessThan(1); // never a confident 100%
  });

  it("n=0 → the fully ignorant interval [0,1]", () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it("narrows as n grows at a fixed rate", () => {
    const small = wilson(10, 20);
    const big = wilson(500, 1000);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });
});

describe("ruleOfThree + separated", () => {
  it("3/n upper bound on an observed zero", () => {
    expect(ruleOfThree(100)).toBeCloseTo(0.03);
    expect(ruleOfThree(0)).toBe(1);
  });

  it("two rates differ only when their intervals are disjoint", () => {
    expect(separated(wilson(10, 100), wilson(60, 100))).toBe(true);
    expect(separated(wilson(48, 100), wilson(52, 100))).toBe(false);
  });
});

describe("gateRate — the three-state renderer contract", () => {
  it("completion: <50 suppressed · 50–200 provisional · ≥200 confident", () => {
    expect(gateRate("completion_rate", 20, 40).state).toBe("suppressed");
    expect(gateRate("completion_rate", 60, 100).state).toBe("provisional");
    expect(gateRate("completion_rate", 150, 250).state).toBe("confident");
  });

  it("carries the thresholds so a suppressed tile can state its gate and progress", () => {
    const g = gateRate("conversion_rate", 3, 40);
    expect(g.state).toBe("suppressed");
    expect(g.showsAt).toBe(150);
    expect(g.confidentAt).toBe(400);
    expect(g.n).toBe(40);
  });

  it("rate is x/n and never NaN at n=0", () => {
    expect(gateRate("capture_rate", 0, 0).rate).toBe(0);
  });
});

describe("formatters", () => {
  it("formatPct one decimal; formatPctRange renders the provisional band", () => {
    expect(formatPct(0.684)).toBe("68.4%");
    const r = formatPctRange(wilson(60, 100));
    expect(r).toMatch(/^\d+–\d+%$/);
  });
});
