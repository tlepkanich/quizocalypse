import type { Quiz } from "../../lib/quizSchema";
import type { OrderedQuestion } from "../../lib/questionOrder";
import type { BuilderCategory } from "../builder/stepProps";
import { ruleSummary } from "../../lib/ruleSummary";

// ════════════════════════════════════════════════════════════════════════════
// QZY-R8-2 (LV1) — the shared global rules stack, pinned at the TOP of all
// three Logic tabs (Map · Paths · Table). Rules are GLOBAL (priority = order,
// first match wins), so they belong above the per-tab body, not buried in the
// Map's column. Read-only summary here (plain-language `ruleSummary`); the full
// inline editor stays the Map's RulesWidget — clicking a rule jumps there.
// Hidden entirely when there are no rules (the map handles everything).
// ════════════════════════════════════════════════════════════════════════════

export function LogicRulesBar({
  doc,
  questions,
  categories,
  onManage,
}: {
  doc: Quiz;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  onManage: () => void;
}) {
  const rules = doc.decision_rules ?? [];
  if (rules.length === 0) return null;

  return (
    <div className="qz-logic-rules" aria-label="Global rules">
      <div className="qz-logic-rules-head">
        <span className="qz-logic-rules-title">
          <span aria-hidden>λ</span> {rules.length} rule{rules.length === 1 ? "" : "s"}
          <span className="qz-dim"> · checked before mappings, first match wins</span>
        </span>
        <button type="button" className="qz-logic-rules-manage" onClick={onManage}>
          Manage in Map →
        </button>
      </div>
      <ol className="qz-logic-rules-list">
        {rules.map((r, i) => (
          <li key={r.id}>
            <button
              type="button"
              className="qz-logic-rule"
              onClick={onManage}
              title="Edit this rule in the Map"
            >
              <b className="qz-logic-rule-pri">R{i + 1}</b>
              <span className="qz-logic-rule-text">
                {ruleSummary(r.conditions, r.target_id, questions, categories)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
