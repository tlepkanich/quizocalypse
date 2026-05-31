import { orderFlow } from "./flowOrder";
import type { Quiz as QuizDoc } from "./quizSchema";

// Runtime progress bar (Phase 5). The denominator is the number of question
// steps on the ordered flow spine; the numerator is how many the shopper has
// answered (plus the one they're on). Pure + testable.

export function reachableQuestionCount(doc: QuizDoc): number {
  return orderFlow(doc).steps.filter((s) => s.type === "question").length;
}

/** Percent complete (0–100). `answered` is clamped to `total`. */
export function progressPct(total: number, answered: number): number {
  if (total <= 0) return 0;
  const a = Math.max(0, Math.min(answered, total));
  return Math.max(0, Math.min(100, Math.round((a / total) * 100)));
}
