// Logic-step module 14 — the Coverage sidebar's derivation (rules-only
// style): which rules READ each question, and how many answers at least one
// rule names. "This replaces 'is every answer mapped?' in a rules-only
// build" — same failure mode (an answer that cannot change the outcome),
// surfaced the way that style makes it happen.
//
// Pure — derived from doc.decision_rules on every render; no storage.

export type CoverageQuestion = {
  id: string;
  answerIds: readonly string[];
};

export type CoverageRule = {
  conditions: ReadonlyArray<{ answer_id: string }>;
};

export type QuestionCoverage = {
  questionId: string;
  /** 1-based ledger indexes (the λN numbers) of the rules whose conditions
   *  reference any of this question's answers — ledger order, deduped per
   *  rule (a rule naming two answers of one question reads it once). */
  ruleIndexes: number[];
};

export type RuleCoverage = {
  /** One row per input question, input order preserved. */
  questions: QuestionCoverage[];
  /** Distinct EXISTING answers named by at least one rule condition. A
   *  condition on a deleted answer never counts (keeps n ≤ m — the dangling
   *  reference is flagged on the rule's own ledger row instead). */
  coveredAnswers: number;
  /** Total answers across all questions. */
  totalAnswers: number;
};

export function buildRuleCoverage(
  questions: readonly CoverageQuestion[],
  rules: readonly CoverageRule[],
): RuleCoverage {
  const questionByAnswer = new Map<string, string>();
  let totalAnswers = 0;
  for (const q of questions) {
    totalAnswers += q.answerIds.length;
    for (const answerId of q.answerIds) questionByAnswer.set(answerId, q.id);
  }
  const indexesByQuestion = new Map<string, number[]>();
  const covered = new Set<string>();
  rules.forEach((rule, i) => {
    const seenQuestions = new Set<string>();
    for (const condition of rule.conditions) {
      const questionId = questionByAnswer.get(condition.answer_id);
      if (!questionId) continue; // dangling reference — flagged elsewhere
      covered.add(condition.answer_id);
      if (seenQuestions.has(questionId)) continue;
      seenQuestions.add(questionId);
      const indexes = indexesByQuestion.get(questionId) ?? [];
      indexes.push(i + 1);
      indexesByQuestion.set(questionId, indexes);
    }
  });
  return {
    questions: questions.map((q) => ({
      questionId: q.id,
      ruleIndexes: indexesByQuestion.get(q.id) ?? [],
    })),
    coveredAnswers: covered.size,
    totalAnswers,
  };
}
