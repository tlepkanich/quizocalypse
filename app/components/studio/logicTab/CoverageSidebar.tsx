import { useMemo } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { buildRuleCoverage } from "../../../lib/ruleCoverage";

// ════════════════════════════════════════════════════════════════════════════
// Logic-step module 14 — the Coverage sidebar ("Rules only · right of the
// ledger"). Mock .qref through the token map: one row per question with the
// λN indexes of the rules that read it (or the warn "not used by any rule"),
// and the covered-answers bar in the foot. Pure derivation from
// doc.decision_rules (app/lib/ruleCoverage.ts) — no storage. Attributes
// style renders nothing of this.
// ════════════════════════════════════════════════════════════════════════════

export function CoverageSidebar({
  questions,
  rules,
}: {
  questions: OrderedQuestion[];
  rules: NonNullable<Quiz["decision_rules"]>;
}) {
  const coverage = useMemo(
    () =>
      buildRuleCoverage(
        questions.map((q) => ({
          id: q.node.id,
          answerIds: q.node.data.answers.map((a) => a.id),
        })),
        rules,
      ),
    [questions, rules],
  );
  const byQuestion = useMemo(
    () => new Map(coverage.questions.map((c) => [c.questionId, c.ruleIndexes])),
    [coverage],
  );
  const pct =
    coverage.totalAnswers > 0
      ? Math.round((coverage.coveredAnswers / coverage.totalAnswers) * 100)
      : 0;
  return (
    <aside className="qz-lcov" data-testid="logic-coverage-sidebar">
      <div className="qz-lcov-h">Questions rules can read</div>
      <div className="qz-lcov-l">
        {questions.map((q) => {
          const indexes = byQuestion.get(q.node.id) ?? [];
          return (
            <div
              key={q.node.id}
              className={`qz-lcov-r${indexes.length === 0 ? " is-unused" : ""}`}
            >
              <div className="qz-lcov-t">
                {q.qIndex}. {q.node.data.text}
              </div>
              <div className="qz-lcov-u">
                {indexes.length > 0 ? (
                  <>read by {indexes.map((i) => `λ${i}`).join(", ")}</>
                ) : (
                  <b>not used by any rule</b>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="qz-lcov-cov">
        <span className="qz-lcov-bar" aria-hidden>
          <span className="qz-lcov-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="qz-lcov-n">
          {coverage.coveredAnswers} of {coverage.totalAnswers} answers
        </span>
      </div>
    </aside>
  );
}
