import type { Quiz as QuizDoc, DecisionRule } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import { ruleSummary } from "../../../../lib/ruleSummary";
import type { OrderedQuestion } from "../../questionsLogic/questionOrder";
import type { RuleRef } from "../ruleHomes";
import { RuleRow } from "./RuleRow";

/* quiz-step3 v3 §5.5 — the sticky rules strip at the top of the Logic
   scroll: "λ N RULES" + one ruleSummary one-liner per rule (click →
   scrollToRule: the home section scrolls in, the rule expands + flashes),
   the homeless-rules bucket ("Unfinished rules" — zero conditions or only
   broken refs, so no home section exists; V9/V6 territory), and the empty
   state. Homeless rules render their FULL RuleRow here so they stay
   editable — fixing them (adding a live condition) re-homes them into a
   section on the next render. */

export function RulesStrip({
  doc,
  rules,
  homeless,
  questions,
  conditionQuestions,
  categories,
  expandedRuleId,
  flashRuleId,
  onRuleClick,
  onToggleRule,
  onCommit,
  registerRuleEl,
}: {
  doc: QuizDoc;
  rules: readonly DecisionRule[];
  homeless: RuleRef[];
  questions: OrderedQuestion[];
  conditionQuestions: OrderedQuestion[];
  categories: BuilderCategory[];
  expandedRuleId: string | null;
  flashRuleId: string | null;
  onRuleClick: (ruleId: string) => void;
  onToggleRule: (ruleId: string) => void;
  onCommit: (doc: QuizDoc) => void;
  registerRuleEl: (ruleId: string, el: HTMLDivElement | null) => void;
}) {
  const byId = new Map(rules.map((r) => [r.id, r] as const));

  return (
    <div className="qz-s3-rulesstrip">
      <div className="qz-s3-rulesstrip-head">
        <span className="qz-s3-rulesstrip-count">
          λ {rules.length} RULE{rules.length === 1 ? "" : "S"}
        </span>
        <span
          className="qz-s3-rulesstrip-note"
          title="Rules are checked top to bottom — the first full match wins and beats the deciding answer"
        >
          checked top to bottom · first match wins
        </span>
      </div>

      {rules.length === 0 ? (
        <p className="qz-s3-rulesstrip-empty">
          No rules yet — the deciding question&rsquo;s answers map straight to results. Add an
          exception with <strong>λ Add rule</strong> on any question below.
        </p>
      ) : (
        <div className="qz-s3-rulesstrip-list">
          {rules.map((rule, idx) => (
            <button
              key={rule.id}
              type="button"
              className="qz-s3-ruleline"
              title="Jump to this rule"
              onClick={() => onRuleClick(rule.id)}
            >
              <span className="qz-s3-rr-no">R{idx + 1}</span>
              <span className="qz-s3-ruleline-text">
                {ruleSummary(rule.conditions, rule.target_id, questions, categories)}
              </span>
            </button>
          ))}
        </div>
      )}

      {homeless.length > 0 ? (
        <div className="qz-s3-unfinished">
          <div className="qz-s3-unfinished-head">
            <span className="qz-s3-unfinished-title">Unfinished rules</span>
            <span className="qz-s3-unfinished-note">
              no live conditions yet — these never fire until you add one
            </span>
          </div>
          {homeless.map((ref) => {
            const rule = byId.get(ref.ruleId);
            if (!rule) return null;
            return (
              <RuleRow
                key={rule.id}
                doc={doc}
                rule={rule}
                no={ref.no}
                total={rules.length}
                questions={questions}
                conditionQuestions={conditionQuestions}
                categories={categories}
                expanded={expandedRuleId === rule.id}
                flash={flashRuleId === rule.id}
                onToggle={() => onToggleRule(rule.id)}
                onCommit={onCommit}
                registerEl={registerRuleEl}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
