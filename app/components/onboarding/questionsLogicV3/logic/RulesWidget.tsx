import { useState } from "react";
import type { z } from "zod";
import type { Quiz } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import type { OrderedQuestion } from "../../../../lib/questionOrder";
import { RuleRow, DraftRuleRow } from "./RuleRow";

type QuizDoc = z.infer<typeof Quiz>;

/* QZY-2 (quiz-logic dev-handoff v1.2 §2/§6) — the RIGHT-column Rules widget:
   ONE global list (priority = order, first match wins), OPEN on load,
   collapsible, sticky. Every rule's full editable band lives HERE now (the
   per-section bands moved out of the map); the map keeps per-answer λ chips
   that expand + flash a rule in this list, and each map card's "λ Add rule"
   pre-fills its question into a draft that lands here — one rule system,
   two entry points. */

export function RulesWidget({
  doc,
  questions,
  categories,
  expandedRuleId,
  flashRuleId,
  draftHome,
  registerRuleEl,
  onToggleRule,
  onCommit,
  onCommitDraft,
  onCancelDraft,
  onStartDraft,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  expandedRuleId: string | null;
  flashRuleId: string | null;
  /** The question a pending draft is pre-scoped to (null = no draft). */
  draftHome: string | null;
  registerRuleEl: (ruleId: string, el: HTMLDivElement | null) => void;
  onToggleRule: (ruleId: string) => void;
  onCommit: (doc: QuizDoc) => void;
  onCommitDraft: (
    cond: { question_id: string; answer_id: string; op: "is" | "is_not" },
    targetId: string,
  ) => void;
  onCancelDraft: () => void;
  /** Start an unscoped draft (defaults to the first question; the editor's
   *  question select stays unlocked). */
  onStartDraft: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false); // §6 — OPEN on load
  const rules = doc.decision_rules ?? [];
  const conditionQuestions = questions.filter(
    (q) => !isFreeformType(q.node.data.question_type),
  );
  const draftQuestion = draftHome
    ? questions.find((q) => q.node.id === draftHome) ?? null
    : null;

  return (
    <aside className="qz-s3-ruleswidget" aria-label="Rules">
      <div className="qz-s3-rw-head">
        <span className="qz-s3-rw-title">
          <span className="qz-s3-rw-lambda" aria-hidden>
            λ
          </span>{" "}
          {rules.length} rule{rules.length === 1 ? "" : "s"}
        </span>
        <span className="qz-s3-rw-note">checked top to bottom · first match wins</span>
        <button
          type="button"
          className="qz-s3-rw-caret"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand rules" : "Collapse rules"}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </div>

      {collapsed ? null : (
        <>
          {rules.length === 0 && !draftQuestion ? (
            <p className="qz-s3-rw-empty">
              No rules yet — the map handles everything. Add a rule only for exceptions.
            </p>
          ) : (
            <div className="qz-s3-rw-list">
              {rules.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  doc={doc}
                  rule={rule}
                  no={i + 1}
                  total={rules.length}
                  questions={questions}
                  conditionQuestions={conditionQuestions}
                  categories={categories}
                  expanded={expandedRuleId === rule.id}
                  flash={flashRuleId === rule.id}
                  registerEl={registerRuleEl}
                  onToggle={() => onToggleRule(rule.id)}
                  onCommit={onCommit}
                />
              ))}
              {draftQuestion ? (
                <DraftRuleRow
                  homeQuestion={draftQuestion.node}
                  homeQIndex={draftQuestion.qIndex}
                  categories={categories}
                  onCommitDraft={onCommitDraft}
                  onCancel={onCancelDraft}
                />
              ) : null}
            </div>
          )}
          <button
            type="button"
            className="qz-s3-rw-add"
            disabled={draftHome !== null || categories.length === 0 || questions.length === 0}
            title={
              categories.length === 0
                ? "Create recommendations first (Step 1)"
                : "Add a global rule — when [question] is [answer], recommend…"
            }
            onClick={onStartDraft}
          >
            λ Add rule
          </button>
        </>
      )}
    </aside>
  );
}
