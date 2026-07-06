import type { DecisionRuleCondition } from "./quizSchema";
import type { BuilderCategory } from "../components/builder/stepProps";
import type { OrderedQuestion } from "./questionOrder";

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
