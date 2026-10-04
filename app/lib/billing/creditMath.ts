import {
  AI_FEATURES,
  CYCLE_DAYS,
  NEAR_OUT_SHARE,
  type AddRange,
  type AiFeature,
  type AiFeatureKey,
  type Plan,
  type SelfServePlan,
} from "./catalog";

// Account & Billing — how the figures relate (BILLING-HANDOFF.md, "How the
// figures relate"). Pure functions, no I/O: the server module feeds them the
// stored counts, the two pages render what they return.
//
// Units: credits shown on screen are WHOLE numbers. Money is integer CENTS.
// AI usage is stored in MILLI-credits (a use is 0.1 or 0.2 credit) and
// becomes whole credits once per feature per cycle, so every row and column
// on the page adds up to the total beside it.

const DAY_MS = 24 * 60 * 60 * 1000;

/* ── Formatting (explicit en-US: the server and the browser print the same) ── */

export function fmtNum(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** "$1,310.00" */
export function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$200" for whole dollars, "$237.50" otherwise — the plan-line form. */
export function fmtUsdShort(cents: number): string {
  return fmtUsd(cents).replace(/\.00$/, "");
}

/** USD cents for a number of credits at a plan's price per credit. */
export function creditsCents(credits: number, rate: number): number {
  return Math.round(credits * rate * 100);
}

/* ── The cycle's figures ─────────────────────────────────────────────────── */

/** One AI feature's stored usage in a cycle. */
export interface AiUse {
  key: AiFeatureKey;
  uses: number;
  milliCredits: number;
}

export interface CycleUsage {
  /** Shoppers who started a quiz — 1 credit each. */
  engagements: number;
  ai: AiUse[];
}

/** Credits available in the cycle beyond the plan's own. */
export interface CycleCredits {
  /** Added on every bill until removed. */
  everyCycle: number;
  /** Bought once, in this cycle. */
  oneTime: number;
  /** Carried in from the last cycle; they expire when this one ends. */
  rolledOver: number;
}

export interface FeatureFigure {
  feature: AiFeature;
  uses: number;
  credits: number;
}

export interface CreditFigures {
  engagements: number;
  /** Every feature in the list, at 0 when unused. */
  features: FeatureFigure[];
  aiUses: number;
  aiCredits: number;
  used: number;
  available: number;
  /** Never below 0. */
  left: number;
  /** Credits used past what was available; 0 when not over. */
  over: number;
  /** used ÷ available. */
  share: number;
  /** Plan price + every-cycle credits. */
  monthlyCents: number;
  everyCycleCents: number;
  overCents: number;
  /** monthly + overage — "so far" while over. */
  nextBillCents: number;
}

export function creditFigures(plan: SelfServePlan, credits: CycleCredits, usage: CycleUsage): CreditFigures {
  const features = AI_FEATURES.map((feature) => {
    const stored = usage.ai.find((use) => use.key === feature.key);
    return {
      feature,
      uses: stored?.uses ?? 0,
      credits: Math.round((stored?.milliCredits ?? 0) / 1000),
    };
  });
  const aiCredits = features.reduce((sum, f) => sum + f.credits, 0);
  const used = usage.engagements + aiCredits;
  const available = plan.credits + credits.everyCycle + credits.oneTime + credits.rolledOver;
  const over = Math.max(0, used - available);
  const everyCycleCents = creditsCents(credits.everyCycle, plan.rate);
  const monthlyCents = plan.price * 100 + everyCycleCents;
  const overCents = creditsCents(over, plan.rate);
  return {
    engagements: usage.engagements,
    features,
    aiUses: features.reduce((sum, f) => sum + f.uses, 0),
    aiCredits,
    used,
    available,
    left: Math.max(0, available - used),
    over,
    share: available > 0 ? used / available : 0,
    monthlyCents,
    everyCycleCents,
    overCents,
    nextBillCents: monthlyCents + overCents,
  };
}

/** The teal signal's two cases. A trial never shows "nearly out". */
export function creditSignal(figures: CreditFigures, inTrial: boolean): "over" | "near" | null {
  if (figures.over > 0) return "over";
  return !inTrial && figures.share >= NEAR_OUT_SHARE ? "near" : null;
}

export type CreditAlert = "near" | "out";

/** What the alert emails need to know about a shop's switches and what has
    already gone out in this cycle. */
export interface CreditAlertState {
  nearOn: boolean;
  outOn: boolean;
  nearSent: boolean;
  outSent: boolean;
}

/** The alert email to send now, or null (BILLING-HANDOFF.md, "Emails").
    - "out": the moment credits reach 0 — one credit before the page's "over".
    - "near": usage reaches 80%. Like the page's signal, never in a trial.
    Each goes out once per cycle. After a run-out alert the 80% alert has
    nothing new to say, so it is not sent. */
export function creditAlertToSend(
  figures: CreditFigures,
  inTrial: boolean,
  state: CreditAlertState,
): CreditAlert | null {
  const out = figures.available > 0 && figures.left === 0;
  if (out && state.outOn && !state.outSent) return "out";
  const near = !inTrial && figures.share >= NEAR_OUT_SHARE;
  return near && state.nearOn && !state.nearSent && !state.outSent ? "near" : null;
}

/** True when the plan, added credits and overage together already cost more
    than the next self-serve plan: "Growth would have cost $200.00 this cycle." */
export function nextPlanWasCheaper(figures: CreditFigures, next: Plan | null): boolean {
  return Boolean(next?.selfServe) && figures.nextBillCents > (next?.price ?? 0) * 100;
}

/* ── By quiz ─────────────────────────────────────────────────────────────── */

/** Share a whole number out by weight so the parts are whole and add up to
    the total (largest remainder). A zero weight always gets zero. */
export function apportion(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / weightSum);
  const parts = exact.map(Math.floor);
  let rest = total - parts.reduce((sum, v) => sum + v, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index, remainder } of byRemainder) {
    if (rest <= 0 || remainder === 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    rest -= 1;
  }
  return parts;
}

/** One quiz's stored usage in a cycle. */
export interface QuizUsage {
  quizId: string;
  name: string;
  engagements: number;
  /** Milli-credits per AI feature. */
  ai: Partial<Record<AiFeatureKey, number>>;
}

export interface QuizUsageRow {
  quizId: string;
  name: string;
  engagements: number;
  /** One cell per AI feature, in list order; null = the quiz had no use of it. */
  ai: (number | null)[];
  credits: number;
}

/** The By quiz table. Each feature's whole-credit total is shared out over
    the quizzes that used it, so every column adds up to the Used figure. */
export function quizUsageRows(quizzes: QuizUsage[], figures: CreditFigures): QuizUsageRow[] {
  const cells = figures.features.map((f) =>
    apportion(
      f.credits,
      quizzes.map((quiz) => quiz.ai[f.feature.key] ?? 0),
    ),
  );
  return quizzes.map((quiz, quizIndex) => {
    const ai = figures.features.map((f, featureIndex) =>
      (quiz.ai[f.feature.key] ?? 0) > 0 ? (cells[featureIndex]?.[quizIndex] ?? 0) : null,
    );
    return {
      quizId: quiz.quizId,
      name: quiz.name,
      engagements: quiz.engagements,
      ai,
      credits: quiz.engagements + ai.reduce<number>((sum, cell) => sum + (cell ?? 0), 0),
    };
  });
}

/* ── More credits: the amount control ────────────────────────────────────── */

/** A whole number inside the plan's range. */
export function clampAmount(range: AddRange, value: number): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** What the control opens on: enough to cover what the shop is over by
    (rounded up to the next slider step), else the plan's usual amount. */
export function defaultAmount(range: AddRange, over: number): number {
  return over > 0 ? clampAmount(range, Math.ceil(over / range.step) * range.step) : range.def;
}

export interface BreakEvenMark {
  /** Credits at which this plan plus the added credits costs the same as the next plan. */
  amount: number;
  /** Position on the slider track, 0–1. */
  at: number;
  /** Hidden in the first or last eighth of the track. */
  shown: boolean;
}

export function breakEvenMark(plan: SelfServePlan, monthlyCents: number, next: Plan | null): BreakEvenMark | null {
  if (!next) return null;
  const amount = (next.price * 100 - monthlyCents) / (plan.rate * 100);
  const at = (amount - plan.add.min) / (plan.add.max - plan.add.min);
  return { amount, at, shown: at > 1 / 8 && at < 7 / 8 };
}

/** "You pay today: about …" — the price for the days left in the cycle. */
export function proRataCents(cents: number, daysLeft: number): number {
  return Math.round((cents * daysLeft) / CYCLE_DAYS);
}

/* ── The cycle ───────────────────────────────────────────────────────────── */

/** `end` is exclusive: it is the next bill date, and the cycle's last day is
    the day before it. */
export interface CycleWindow {
  start: Date;
  end: Date;
}

export function cycleAfter(cycle: CycleWindow): CycleWindow {
  return { start: cycle.end, end: new Date(cycle.end.getTime() + CYCLE_DAYS * DAY_MS) };
}

/** Whole days until the next bill date, rounded up, never below 0. */
export function daysLeftIn(cycle: CycleWindow, now: Date): number {
  return Math.max(0, Math.ceil((cycle.end.getTime() - now.getTime()) / DAY_MS));
}

export function lastDayOf(cycle: CycleWindow): Date {
  return new Date(cycle.end.getTime() - DAY_MS);
}

/** What a closing cycle hands to the next one. */
export interface ClosingCycle {
  /** Credits that were new in this cycle: the plan's, every-cycle and one-time. */
  fresh: number;
  /** Credits carried in from the cycle before. They cannot roll over again. */
  rolledIn: number;
  /** Whole credits used in this cycle. */
  used: number;
}

/**
 * The credits that roll over into the next cycle when a cycle closes.
 *
 * The rules (BILLING-HANDOFF.md, "Billing rules"; spend order: owner, 2026-10-04):
 *  - Credits a shop doesn't use roll over ONCE and last one more cycle.
 *  - Rolled-in credits are spent first, because they expire first. What is
 *    left of them expires; they never roll over a second time.
 *  - One-time credits roll over like plan credits (decision 11).
 *  - A shop that is over has nothing left to roll over.
 */
export function rolloverAtCycleEnd(cycle: ClosingCycle): number {
  const usedFromFresh = Math.max(0, cycle.used - cycle.rolledIn);
  return Math.max(0, cycle.fresh - usedFromFresh);
}
