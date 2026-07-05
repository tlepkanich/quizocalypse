import type { DecisionRule } from "../../../lib/quizSchema";

/* quiz-step3 v3 §5.5 — the distributed-rules model. A rule LIVES under the
   first question it references, "first" interpreted in FLOW order (stable
   under out-of-order condition entry). Rules with zero conditions or only
   broken refs are HOMELESS — rendered in the "Unfinished rules" slot under
   the sticky strip (V9/V6 badge them). Every referenced answer carries a
   λ R# chip; R# = index+1 in doc.decision_rules (priority order — matches
   pathReport's numbering and never changes with homing). Pure + memoizable. */

export interface RuleRef {
  ruleId: string;
  /** 1-based priority-order number — the R# label. */
  no: number;
}

export interface RuleLayout {
  /** ruleId → home question node id (flow-earliest referenced), or null = homeless. */
  homes: Map<string, string | null>;
  /** Home node id → the rules homed there, in priority order. */
  byHome: Map<string, RuleRef[]>;
  /** Rules with no live home, in priority order (the "Unfinished rules" slot). */
  homeless: RuleRef[];
  /** answerId → every rule referencing it (for λ R# chips), priority order. */
  chipsByAnswer: Map<string, RuleRef[]>;
}

export function computeRuleLayout(
  rules: readonly DecisionRule[],
  orderedQuestionIds: readonly string[],
): RuleLayout {
  const orderIndex = new Map(orderedQuestionIds.map((id, i) => [id, i]));
  const homes = new Map<string, string | null>();
  const byHome = new Map<string, RuleRef[]>();
  const homeless: RuleRef[] = [];
  const chipsByAnswer = new Map<string, RuleRef[]>();

  rules.forEach((rule, idx) => {
    const ref: RuleRef = { ruleId: rule.id, no: idx + 1 };

    let home: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const cond of rule.conditions) {
      const pos = orderIndex.get(cond.question_id);
      if (pos !== undefined && pos < best) {
        best = pos;
        home = cond.question_id;
      }
      const chips = chipsByAnswer.get(cond.answer_id) ?? [];
      if (!chips.some((c) => c.ruleId === rule.id)) chips.push(ref);
      chipsByAnswer.set(cond.answer_id, chips);
    }

    homes.set(rule.id, home);
    if (home === null) {
      homeless.push(ref);
    } else {
      const list = byHome.get(home) ?? [];
      list.push(ref);
      byHome.set(home, list);
    }
  });

  return { homes, byHome, homeless, chipsByAnswer };
}
