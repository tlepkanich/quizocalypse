/* quiz-step3 v3 §4.2 + design-system-V2 §2.2 — the phone-fit contract:
   "nothing scrolls inside the screen; content adapts to the frame."
   Deterministic count-based steps (unit-testable, designer-legible) rather
   than transform auto-scaling (which breaks contenteditable caret geometry).
   Emitted as data-fit / data-title-long attributes; ALL sizing lives in CSS.
   A cheap ResizeObserver guardrail in the canvas asserts scrollHeight <=
   clientHeight and surfaces the builder warning on a miss — it never changes
   layout. */

export type FitStep = "normal" | "compact" | "tight";

/** 1–4 answers render full-size; 5–6 step the type/padding down one notch;
    7+ go tight. (The spec's budget: 6 answers comfortably without scroll.) */
export function computeFitStep(answerCount: number): FitStep {
  if (answerCount <= 4) return "normal";
  if (answerCount <= 6) return "compact";
  return "tight";
}

/** Long titles step down independently of the answer count. */
export const TITLE_LONG_CHARS = 90;
export function isTitleLong(title: string): boolean {
  return title.trim().length > TITLE_LONG_CHARS;
}

/** Beyond 8 answers the builder shows a warning under the phone (advisory —
    never blocks, aligning with V10's philosophy). */
export const ANSWER_WARN_THRESHOLD = 8;
export function answersExceedBudget(answerCount: number): boolean {
  return answerCount > ANSWER_WARN_THRESHOLD;
}
