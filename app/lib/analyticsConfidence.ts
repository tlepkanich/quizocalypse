// ANALYTICS P0 — confidence math + the hard n-threshold gates (research doc
// §7.2 / §7.3). A rate that is not trustworthy at the merchant's volume is not
// shown; it states its threshold and progress instead (owner decision
// 2026-08-11, "don't relitigate"). Pure + deterministic — no DB, no Date.now().

export interface WilsonInterval {
  /** Point estimate x/n (0 when n === 0). */
  p: number;
  /** 95% lower bound, clamped to [0,1]. */
  lo: number;
  /** 95% upper bound, clamped to [0,1]. */
  hi: number;
}

/**
 * Wilson score interval. Wilson, not Wald: it inverts the score test, stays
 * inside [0,1] at every n, and keeps nonzero width at x=0 / x=n — exactly the
 * small-n regime this surface lives in (§7.2).
 */
export function wilson(x: number, n: number, z = 1.96): WilsonInterval {
  if (n === 0) return { p: 0, lo: 0, hi: 1 };
  const p = x / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** One-sided 95% upper bound on a rate observed at zero (the rule of three). */
export function ruleOfThree(n: number): number {
  return n > 0 ? 3 / n : 1;
}

/** Two rates differ only when their intervals are disjoint (§7.2). */
export function separated(a: WilsonInterval, b: WilsonInterval): boolean {
  return a.hi < b.lo || b.hi < a.lo;
}

export type ConfidenceState = "confident" | "provisional" | "suppressed";

export interface GatedRate {
  state: ConfidenceState;
  /** x/n, present in every state (callers must not render it when suppressed). */
  rate: number;
  interval: WilsonInterval;
  /** The n the gate was applied to. */
  n: number;
  /** The threshold `n` must reach for the CONFIDENT state. */
  confidentAt: number;
  /** The threshold `n` must reach to leave the suppressed state. */
  showsAt: number;
}

/** §7.3 hard-coded n-threshold table. Keys are the metrics this build ships. */
export const GATES = {
  /** n = engaged sessions. */
  completion_rate: { confident: 200, provisional: 50 },
  /** n = finishers. */
  capture_rate: { confident: 150, provisional: 50 },
  /** n = finishers ("quiz-taker CVR"). */
  conversion_rate: { confident: 400, provisional: 150 },
  /** n = sessions that reached the PRIOR step — exact percentages. */
  dropoff_exact: { confident: 250, provisional: 100 },
  /** n = sessions that reached the prior step — rank-only claims. */
  dropoff_rank: { confident: 100, provisional: 30 },
  /** n = product impressions (distinct sessions). */
  product_ctr: { confident: 100, provisional: 30 },
} as const;

export type GateKey = keyof typeof GATES;

/**
 * Apply a §7.3 gate to x successes over n trials. Suppressed below the
 * provisional floor; provisional shows the Wilson RANGE only; confident shows
 * the point rate.
 */
export function gateRate(key: GateKey, x: number, n: number): GatedRate {
  const g = GATES[key];
  const interval = wilson(x, n);
  const state: ConfidenceState =
    n >= g.confident ? "confident" : n >= g.provisional ? "provisional" : "suppressed";
  return {
    state,
    rate: n > 0 ? x / n : 0,
    interval,
    n,
    confidentAt: g.confident,
    showsAt: g.provisional,
  };
}

/** "68.4%" with one decimal; whole percents drop the ".0" below 10 shoppers of width. */
export function formatPct(rate: number, digits = 1): string {
  return `${(rate * 100).toFixed(digits)}%`;
}

/** "58–74%" — the provisional rendering: a range, never a false point. */
export function formatPctRange(interval: WilsonInterval): string {
  return `${Math.round(interval.lo * 100)}–${Math.round(interval.hi * 100)}%`;
}
