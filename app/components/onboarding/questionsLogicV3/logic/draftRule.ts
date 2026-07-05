import type { Quiz as QuizDoc, DecisionRuleCondition } from "../../../../lib/quizSchema";
import { addDecisionRule, updateDecisionRule } from "../../../../lib/quizMutations";

/* quiz-step3 v3 §5.6 — materialize the pre-scoped rule draft as ONE result
   doc: append the rule (bottom priority, the addDecisionRule contract) and
   patch its first condition in the same returned value, so the caller
   commits exactly one doc write. Pure. On a legacy doc / empty target the
   underlying mutations no-op and ruleId comes back null — the caller
   commits nothing. */
export function createRuleWithCondition(
  doc: QuizDoc,
  cond: DecisionRuleCondition,
  targetId: string,
): { doc: QuizDoc; ruleId: string | null } {
  const before = new Set((doc.decision_rules ?? []).map((r) => r.id));
  const withRule = addDecisionRule(doc, targetId);
  const newRule = (withRule.decision_rules ?? []).find((r) => !before.has(r.id));
  if (!newRule) return { doc, ruleId: null };
  return {
    doc: updateDecisionRule(withRule, newRule.id, { conditions: [cond] }),
    ruleId: newRule.id,
  };
}
