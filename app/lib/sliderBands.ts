import type { Quiz } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// QZY-12 (build-tab §6.3) — slider RANGE-BAND resolution. Bands are ordinary
// answers carrying `range: {min,max}` (inclusive), so all decider/filter/rule
// machinery applies unchanged; these helpers only decide WHICH band a value
// lands in and whether the bands cover the whole scale.
// ════════════════════════════════════════════════════════════════════════════

type QuestionNode = Extract<Quiz["nodes"][number], { type: "question" }>;
type Answer = QuestionNode["data"]["answers"][number];

/** The answers that are bands (carry a range). */
export function sliderBandAnswers(answers: readonly Answer[]): Answer[] {
  return answers.filter((a) => a.range !== undefined);
}

/** First band containing `value` (inclusive bounds; authoring order wins on
 *  overlap — the same first-match-wins posture as rules). */
export function bandFor(answers: readonly Answer[], value: number): Answer | null {
  for (const a of answers) {
    if (a.range && value >= a.range.min && value <= a.range.max) return a;
  }
  return null;
}

export interface BandCoverage {
  /** Uncovered [from, to] stretches — each one is a BLOCKING dead end (§6.3). */
  gaps: Array<[number, number]>;
  /** Overlapping [from, to] stretches — first band wins; flagged, non-blocking. */
  overlaps: Array<[number, number]>;
}

/** §6.3 — bands must cover the full scale with no gaps. `step` sets the
 *  adjacency unit (integer sliders: 0–33 then 34–66 is contiguous). */
export function bandCoverage(
  answers: readonly Answer[],
  min: number,
  max: number,
  step = 1,
): BandCoverage {
  const bands = sliderBandAnswers(answers)
    .map((a) => a.range!)
    .sort((x, y) => x.min - y.min || x.max - y.max);
  const gaps: Array<[number, number]> = [];
  const overlaps: Array<[number, number]> = [];
  if (bands.length === 0) return { gaps: [[min, max]], overlaps };
  let covered = min - step; // highest value covered so far
  for (const b of bands) {
    if (b.min > covered + step) gaps.push([covered + step, b.min - step]);
    else if (b.min <= covered && covered >= min) {
      // The band starts at or below the covered frontier — shared values.
      overlaps.push([b.min, Math.min(covered, b.max)]);
    }
    covered = Math.max(covered, b.max);
  }
  if (covered < max) gaps.push([covered + step, max]);
  return { gaps, overlaps };
}
