import type { QuestionDropoff } from "./funnelAggregation";

// Turn the per-question drop-off table (already computed by perQuestionDropoff)
// into actionable "this question is bleeding shoppers" callouts for the analytics
// dashboards. Pure + deterministic: the dashboard loader passes the dropoff array
// + the start count, this flags the steep steps and attaches a concrete suggestion.
//
// We flag on the MARGINAL step-to-step drop in pctOfStarted, NOT the absolute value:
// under branch logic later questions are legitimately reached by fewer sessions, so
// a low pctOfStarted isn't necessarily abandonment. The marginal drop + a conservative
// threshold + a min-volume guard keep this honest, and the copy stays non-accusatory
// ("leave or branch away") because a marginal drop can also be a branch split.

/** Skip detection entirely below this many starts — 1 of 2 quitting isn't a trend. */
export const HOTSPOT_MIN_STARTED = 20;
/** Flag a question that loses ≥ this fraction of the prior step's pool (warn tier). */
export const HOTSPOT_WARN_DROP = 0.25;
/** Escalate to crit at ≥ this marginal drop. */
export const HOTSPOT_CRIT_DROP = 0.4;
/** Show at most this many callouts (worst-first) to avoid alarm fatigue. */
export const HOTSPOT_MAX = 3;

export interface Hotspot {
  questionId: string;
  /** 1-based position in flow order. */
  index: number;
  text: string;
  /** Fraction of starters who reached (answered) this question, 0–1. */
  pctReached: number;
  /** Marginal fraction of the prior step's pool lost AT this step, 0–1. */
  pctLostHere: number;
  severity: "warn" | "crit";
  suggestion: string;
}

function suggestionFor(index: number): string {
  return index === 1
    ? "Most shoppers leave right after starting. Try making the first question lighter and quicker to answer, or moving a harder question later in the flow."
    : "Shoppers tend to leave or branch away at this step. Try shortening the question, making it optional so they can skip it, or adding an education card before it.";
}

/**
 * Flag the question(s) where shoppers disproportionately drop off. Pure: same
 * inputs → same output, no I/O, no Date. Returns [] for healthy or low-traffic
 * quizzes (so the dashboard shows nothing rather than a false alarm).
 */
export function detectHotspots(
  dropoff: QuestionDropoff[],
  started: number,
  opts?: { minStarted?: number; warnDrop?: number; critDrop?: number; max?: number },
): Hotspot[] {
  const minStarted = opts?.minStarted ?? HOTSPOT_MIN_STARTED;
  if (started < minStarted || dropoff.length === 0) return [];
  const warnDrop = opts?.warnDrop ?? HOTSPOT_WARN_DROP;
  const critDrop = opts?.critDrop ?? HOTSPOT_CRIT_DROP;
  const max = opts?.max ?? HOTSPOT_MAX;

  const hotspots: Hotspot[] = [];
  let prevReached = 1; // everyone who started "reached" the point before Q1
  dropoff.forEach((q, i) => {
    const reached = q.pctOfStarted;
    const lost = Math.max(0, prevReached - reached);
    if (lost >= warnDrop) {
      hotspots.push({
        questionId: q.questionId,
        index: i + 1,
        text: q.text,
        pctReached: reached,
        pctLostHere: lost,
        severity: lost >= critDrop ? "crit" : "warn",
        suggestion: suggestionFor(i + 1),
      });
    }
    prevReached = reached;
  });

  // Worst-first, then by flow order for stable ties; cap to avoid noise.
  hotspots.sort((a, b) => b.pctLostHere - a.pctLostHere || a.index - b.index);
  return hotspots.slice(0, max);
}
