// First-run handoff §10.1 — an explicit question count is a promise, not a
// hint. The question build now asks for EXACTLY n (schema + prompt + a
// retry on a miss); this is the deterministic last resort when the final
// attempt still overshoots. Pure.
//
// Trims from the END, never removing a question the model marked "decides":
// a decider quiz routes on that question, so cutting it would break the
// results. Later narrowing / info questions go first. Too FEW questions are
// returned as-is — inventing one is worse than a short quiz.

export function clampQuestionsTo<T extends { role?: string }>(questions: readonly T[], n: number): T[] {
  if (n < 1 || questions.length <= n) return [...questions];
  const kept = [...questions];
  for (let i = kept.length - 1; i >= 0 && kept.length > n; i--) {
    if (kept[i]!.role !== "decides") kept.splice(i, 1);
  }
  return kept;
}
