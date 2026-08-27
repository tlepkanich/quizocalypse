import type { DecisionRule, DecisionRuleCondition } from "./quizSchema";
import type { BuilderCategory } from "../components/builder/stepProps";
import type { OrderedQuestion } from "./questionOrder";

/** Logic-step §3 — render a rule's conditions with the rule's OWN join
 *  words: `or` within an any_of column, `and` within an all-of column, and
 *  the rule's match join between questions. The one grouped describer every
 *  plain-language surface (AI copy prompts included) should use — a
 *  match:any rule must never read as a conjunction. `fmt` renders one
 *  condition ("Q is A" / "Q is not A"), so callers keep their own voice. */
export function describeRuleConditions(
  rule: Pick<DecisionRule, "conditions" | "match" | "any_of">,
  fmt: (c: DecisionRuleCondition) => string,
): string {
  const groups: { qid: string; conds: DecisionRuleCondition[] }[] = [];
  for (const c of rule.conditions) {
    const g = groups.find((x) => x.qid === c.question_id);
    if (g) g.conds.push(c);
    else groups.push({ qid: c.question_id, conds: [c] });
  }
  const anyOf = new Set(rule.any_of ?? []);
  const acrossWord = rule.match === "any" ? " or " : " and ";
  return groups
    .map((g) => {
      const withinWord = anyOf.has(g.qid) ? " or " : " and ";
      return g.conds.map(fmt).join(withinWord);
    })
    .join(acrossWord);
}

// Plain-language rule summary for confirm dialogs + the inline accordion:
// "If Q1 is Park AND Q2 is not Advanced → Pro Park Boards".
export function ruleSummary(
  conditions: DecisionRuleCondition[],
  targetId: string,
  questions: OrderedQuestion[],
  categories: BuilderCategory[],
): string {
  const parts = conditions.map((c) => {
    const q = questions.find((x) => x.node.id === c.question_id);
    const a = q?.node.data.answers.find((x) => x.id === c.answer_id);
    const qLabel = q ? `Q${q.qIndex}` : "(deleted question)";
    const aLabel = a?.text || "(deleted answer)";
    return `${qLabel} ${c.op === "is" ? "is" : "is not"} ${aLabel}`;
  });
  const target = categories.find((c) => c.id === targetId)?.name ?? "(deleted bucket)";
  return parts.length === 0
    ? `(no conditions yet) → ${target}`
    : `If ${parts.join(" AND ")} → ${target}`;
}
