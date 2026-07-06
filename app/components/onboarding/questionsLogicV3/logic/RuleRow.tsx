import { useState } from "react";
import type {
  Quiz as QuizDoc,
  DecisionRule,
  DecisionRuleCondition,
} from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import {
  updateDecisionRule,
  removeDecisionRule,
  moveDecisionRule,
} from "../../../../lib/quizMutations";
import { ruleSummary } from "../../../../lib/ruleSummary";
import type { OrderedQuestion, QuestionNode } from "../../../../lib/questionOrder";

/* quiz-step3 v3 §5.5 — a distributed rule row, rendered inside its HOME
   question section (indigo band). Collapsed = R# chip + the ruleSummary
   one-liner + target; expanded = the tokenized AND editor ([Question]
   is / is_not [Answer] tokens + target select) writing updateDecisionRule,
   ↑/↓ priority via moveDecisionRule (R# = doc order — the number a reorder
   changes), and delete via removeDecisionRule behind a confirm.
   `flash` pulses the band after a chip/strip jump. */

export function RuleRow({
  doc,
  rule,
  no,
  total,
  questions,
  conditionQuestions,
  categories,
  expanded,
  flash,
  onToggle,
  onCommit,
  registerEl,
}: {
  doc: QuizDoc;
  rule: DecisionRule;
  /** 1-based priority number (index+1 in doc.decision_rules). */
  no: number;
  total: number;
  questions: OrderedQuestion[];
  /** Discrete-answer questions only (freeform excluded — no answers to match). */
  conditionQuestions: OrderedQuestion[];
  categories: BuilderCategory[];
  expanded: boolean;
  flash: boolean;
  onToggle: () => void;
  onCommit: (doc: QuizDoc) => void;
  registerEl: (ruleId: string, el: HTMLDivElement | null) => void;
}) {
  const summary = ruleSummary(rule.conditions, rule.target_id, questions, categories);
  const targetName =
    categories.find((c) => c.id === rule.target_id)?.name ?? "(deleted recommendation)";

  const setConditions = (conditions: DecisionRuleCondition[]) =>
    onCommit(updateDecisionRule(doc, rule.id, { conditions }));

  const deleteRule = () => {
    const tail =
      rule.conditions.length > 0
        ? "Shoppers it matched will fall through to lower rules or the deciding answer."
        : "It had no conditions, so it never affected anyone.";
    const ok =
      typeof window === "undefined" ||
      window.confirm(`Delete this rule?\n\n${summary}\n\n${tail}`);
    if (ok) onCommit(removeDecisionRule(doc, rule.id));
  };

  return (
    <div
      className={`qz-s3-rr${expanded ? " is-expanded" : ""}${flash ? " is-flash" : ""}`}
      ref={(el) => registerEl(rule.id, el)}
      data-rule-id={rule.id}
    >
      <button
        type="button"
        className="qz-s3-rr-head"
        aria-expanded={expanded}
        onClick={onToggle}
        title={expanded ? "Collapse this rule" : "Edit this rule"}
      >
        <span className="qz-s3-rr-no">R{no}</span>
        <span className="qz-s3-rr-summary">{summary}</span>
        <span className="qz-s3-rr-caret" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <div className="qz-s3-rr-editor">
          {rule.conditions.length === 0 ? (
            <p className="qz-s3-rr-halfnote" role="note">
              No conditions yet — this rule never fires until you add one.
            </p>
          ) : null}

          {rule.conditions.map((c, ci) => (
            <ConditionTokens
              key={ci}
              cond={c}
              first={ci === 0}
              questions={conditionQuestions}
              onChange={(next) =>
                setConditions(rule.conditions.map((x, i) => (i === ci ? next : x)))
              }
              onRemove={() => setConditions(rule.conditions.filter((_, i) => i !== ci))}
            />
          ))}

          <button
            type="button"
            className="qz-s3-rr-addcond"
            disabled={conditionQuestions.length === 0}
            onClick={() => {
              const q = conditionQuestions[0];
              const a = q?.node.data.answers[0];
              if (!q || !a) return;
              setConditions([
                ...rule.conditions,
                { question_id: q.node.id, answer_id: a.id, op: "is" },
              ]);
            }}
          >
            + AND condition
          </button>

          <div className="qz-s3-rr-target">
            <span aria-hidden>→</span>
            <span>recommend</span>
            <select
              value={categories.some((c) => c.id === rule.target_id) ? rule.target_id : ""}
              aria-label={`Rule ${no} result target`}
              onChange={(e) => {
                if (e.target.value)
                  onCommit(updateDecisionRule(doc, rule.id, { target_id: e.target.value }));
              }}
            >
              {categories.some((c) => c.id === rule.target_id) ? null : (
                <option value="" disabled>
                  (deleted recommendation — pick again)
                </option>
              )}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="qz-s3-rr-actions">
            <span className="qz-s3-rr-prionote" title="Rules check top to bottom — the first full match wins">
              Priority {no} of {total} · {targetName}
            </span>
            <button
              type="button"
              disabled={no <= 1}
              title="Raise priority"
              aria-label={`Raise rule ${no} priority`}
              onClick={() => onCommit(moveDecisionRule(doc, rule.id, no - 2))}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={no >= total}
              title="Lower priority"
              aria-label={`Lower rule ${no} priority`}
              onClick={() => onCommit(moveDecisionRule(doc, rule.id, no))}
            >
              ↓
            </button>
            <button
              type="button"
              className="qz-s3-rr-del"
              title="Delete this rule"
              aria-label={`Delete rule ${no}`}
              onClick={deleteRule}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* — the §5.6 pre-scoped add: an EPHEMERAL editor (no doc write until the
   first answer pick). The Question token is pre-locked to the section's
   question; op + target are local state; picking an answer hands the full
   condition + target up (LogicScroll commits addDecisionRule +
   updateDecisionRule as ONE doc write). Cancel discards — zero writes. — */

export function DraftRuleRow({
  homeQuestion,
  homeQIndex,
  categories,
  onCommitDraft,
  onCancel,
}: {
  homeQuestion: QuestionNode;
  homeQIndex: number;
  categories: BuilderCategory[];
  onCommitDraft: (cond: DecisionRuleCondition, targetId: string) => void;
  onCancel: () => void;
}) {
  const [op, setOp] = useState<"is" | "is_not">("is");
  const [targetId, setTargetId] = useState(categories[0]?.id ?? "");

  return (
    <div className="qz-s3-rr is-expanded is-draft" data-draft-rule>
      <div className="qz-s3-rr-head is-static">
        <span className="qz-s3-rr-no">λ New rule</span>
        <span className="qz-s3-rr-summary">
          Pick an answer to create it — nothing is saved until you do.
        </span>
      </div>
      <div className="qz-s3-rr-editor">
        <div className="qz-s3-cond">
          <span className="qz-s3-cond-join">If</span>
          <select value={homeQuestion.id} disabled aria-label="Condition question (locked to this question)">
            <option value={homeQuestion.id}>
              Q{homeQIndex} · {homeQuestion.data.text || "Untitled"}
            </option>
          </select>
          <select
            value={op}
            aria-label="Condition operator"
            onChange={(e) => setOp(e.target.value as "is" | "is_not")}
          >
            <option value="is">is</option>
            <option value="is_not">is not</option>
          </select>
          <select
            value=""
            aria-label="Condition answer"
            onChange={(e) => {
              if (!e.target.value || !targetId) return;
              onCommitDraft(
                { question_id: homeQuestion.id, answer_id: e.target.value, op },
                targetId,
              );
            }}
          >
            <option value="" disabled>
              Pick an answer…
            </option>
            {homeQuestion.data.answers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.text || "Untitled answer"}
              </option>
            ))}
          </select>
        </div>
        <div className="qz-s3-rr-target">
          <span aria-hidden>→</span>
          <span>recommend</span>
          <select
            value={targetId}
            aria-label="New rule result target"
            onChange={(e) => setTargetId(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="qz-s3-rr-actions">
          <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* One dropdown-built condition token row: [Question] [is / is not] [Answer].
   Deleted refs render a disabled "(deleted …)" option so a broken ref is
   VISIBLE, never silently re-bound (§9 — same contract as the v2 RulesTab). */
function ConditionTokens({
  cond,
  first,
  questions,
  onChange,
  onRemove,
}: {
  cond: DecisionRuleCondition;
  first: boolean;
  questions: OrderedQuestion[];
  onChange: (next: DecisionRuleCondition) => void;
  onRemove: () => void;
}) {
  const q = questions.find((x) => x.node.id === cond.question_id);
  const answers = q?.node.data.answers ?? [];
  const answerKnown = answers.some((a) => a.id === cond.answer_id);
  return (
    <div className="qz-s3-cond">
      <span className="qz-s3-cond-join">{first ? "If" : "AND"}</span>
      <select
        value={q ? cond.question_id : ""}
        aria-label="Condition question"
        onChange={(e) => {
          const nq = questions.find((x) => x.node.id === e.target.value);
          const na = nq?.node.data.answers[0];
          if (nq && na) onChange({ ...cond, question_id: nq.node.id, answer_id: na.id });
        }}
      >
        {q ? null : (
          <option value="" disabled>
            (deleted question)
          </option>
        )}
        {questions.map((x) => (
          <option key={x.node.id} value={x.node.id}>
            Q{x.qIndex} · {x.node.data.text || "Untitled"}
          </option>
        ))}
      </select>
      <select
        value={cond.op}
        aria-label="Condition operator"
        onChange={(e) => onChange({ ...cond, op: e.target.value as "is" | "is_not" })}
      >
        <option value="is">is</option>
        <option value="is_not">is not</option>
      </select>
      <select
        value={answerKnown ? cond.answer_id : ""}
        aria-label="Condition answer"
        onChange={(e) => {
          if (e.target.value) onChange({ ...cond, answer_id: e.target.value });
        }}
      >
        {answerKnown ? null : (
          <option value="" disabled>
            (deleted answer)
          </option>
        )}
        {answers.map((a) => (
          <option key={a.id} value={a.id}>
            {a.text || "Untitled answer"}
          </option>
        ))}
      </select>
      <button type="button" className="qz-s3-cond-del" aria-label="Remove condition" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}
