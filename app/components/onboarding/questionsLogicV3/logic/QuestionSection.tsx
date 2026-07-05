import type { CSSProperties } from "react";
import type { Quiz as QuizDoc, DecisionRule, DecisionRuleCondition } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import { addAnswer, moveDecider } from "../../../../lib/quizMutations";
import type { OrderedQuestion } from "../../questionsLogic/questionOrder";
import type { SkipOption } from "../../questionsLogic/AnswerRow";
import type { RuleLayout } from "../ruleHomes";
import { sectionColorVars, type SectionColorKey } from "../sectionPalette";
import { FlagTab } from "./FlagTab";
import { AnswerTableRow } from "./AnswerTableRow";
import { RuleRow, DraftRuleRow } from "./RuleRow";

/* quiz-step3 v3 §5.2 — one floating section card per question in flow
   order. The section color (decider = gold, qualifiers = the fixed palette)
   is inlined as --sec-color/--sec-wash (the PhoneScreen convention); the
   number chip, letter badges, hover left-bar and tinted shadow all read it.
   The FlagTab hangs off the top edge (−19px/20px); the title is READ-ONLY
   here (Content view owns text editing — the ✎ affordance jumps there);
   rules HOMED here render as indigo RuleRow bands; the footer carries
   + Add answer · λ Add rule (the pre-scoped ephemeral draft). */

export function QuestionSection({
  doc,
  question,
  isDecider,
  hasCurrentDecider,
  colorKey,
  categories,
  skipOptions,
  layout,
  rulesById,
  totalRules,
  questions,
  conditionQuestions,
  expandedRuleId,
  flashRuleId,
  flashWarn,
  draftActive,
  active,
  onCommit,
  onEditContent,
  onChipClick,
  onToggleRule,
  onStartDraft,
  onCommitDraft,
  onCancelDraft,
  registerSection,
  registerRuleEl,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  isDecider: boolean;
  hasCurrentDecider: boolean;
  colorKey: SectionColorKey;
  categories: BuilderCategory[];
  skipOptions: SkipOption[];
  layout: RuleLayout;
  rulesById: ReadonlyMap<string, DecisionRule>;
  totalRules: number;
  questions: OrderedQuestion[];
  conditionQuestions: OrderedQuestion[];
  expandedRuleId: string | null;
  flashRuleId: string | null;
  /** P4 — pulse the warn wash (a health jump-link landed on this section). */
  flashWarn: boolean;
  /** The pre-scoped draft editor is open on THIS section. */
  draftActive: boolean;
  active: boolean;
  onCommit: (doc: QuizDoc) => void;
  onEditContent: (nodeId: string) => void;
  onChipClick: (ruleId: string) => void;
  onToggleRule: (ruleId: string) => void;
  onStartDraft: (nodeId: string) => void;
  onCommitDraft: (cond: DecisionRuleCondition, targetId: string) => void;
  onCancelDraft: () => void;
  registerSection: (nodeId: string, el: HTMLElement | null) => void;
  registerRuleEl: (ruleId: string, el: HTMLDivElement | null) => void;
}) {
  const { node, qIndex } = question;
  const freeform = isFreeformType(node.data.question_type);
  const multi = node.data.question_type === "multi_select";
  const vars = sectionColorVars(colorKey);
  const homedRules = layout.byHome.get(node.id) ?? [];
  const homeRuleIds = new Set(homedRules.map((r) => r.ruleId));
  const minAnswers = freeform ? 1 : 2;

  const blockedReason = multi
    ? "Multi-select can't decide the result — shoppers must pick exactly one answer. Change the type first."
    : freeform
      ? "Open text can't decide the result — there are no fixed answers to map. Change the type first."
      : null;

  return (
    <section
      className={`qz-s3-sec${isDecider ? " is-decider" : ""}${active ? " is-active" : ""}${flashWarn ? " is-flashwarn" : ""}`}
      style={{ "--sec-color": vars.color, "--sec-wash": vars.wash } as CSSProperties}
      ref={(el) => registerSection(node.id, el)}
      data-node-id={node.id}
      aria-label={`Question ${qIndex} logic`}
    >
      <FlagTab
        isDecider={isDecider}
        qIndex={qIndex}
        blockedReason={blockedReason}
        hasCurrentDecider={hasCurrentDecider}
        onConfirm={() => onCommit(moveDecider(doc, node.id))}
      />

      <div className="qz-s3-sec-head">
        <span className={`qz-s3-numchip${isDecider ? " is-decider" : ""}`}>{qIndex}</span>
        <h3 className="qz-s3-sec-title">{node.data.text || "Untitled question"}</h3>
        <button
          type="button"
          className="qz-s3-sec-edit"
          title="Edit the wording in the Content view"
          onClick={() => onEditContent(node.id)}
        >
          ✎ Edit content
        </button>
      </div>

      {freeform ? (
        <p className="qz-s3-sec-freeform" role="note">
          Open text — shoppers type their answer. Nothing maps or routes here; responses are
          collected as context.
        </p>
      ) : (
        <div className="qz-s3-atable">
          <div className="qz-s3-atable-head" aria-hidden>
            <span />
            <span>Answer</span>
            <span />
            <span>{isDecider ? "Maps to" : ""}</span>
            <span>Then go to</span>
            <span />
          </div>
          {node.data.answers.map((a, i) => (
            <AnswerTableRow
              key={a.id}
              doc={doc}
              node={node}
              answer={a}
              index={i}
              isDeciderRow={isDecider}
              categories={categories}
              skipOptions={skipOptions}
              chips={layout.chipsByAnswer.get(a.id) ?? []}
              homeRuleIds={homeRuleIds}
              canDelete={node.data.answers.length > minAnswers}
              onCommit={onCommit}
              onChipClick={onChipClick}
            />
          ))}
        </div>
      )}

      {homedRules.length > 0 || draftActive ? (
        <div className="qz-s3-sec-rules">
          {homedRules.map((ref) => {
            const rule = rulesById.get(ref.ruleId);
            if (!rule) return null;
            return (
              <RuleRow
                key={rule.id}
                doc={doc}
                rule={rule}
                no={ref.no}
                total={totalRules}
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
          {draftActive ? (
            <DraftRuleRow
              homeQuestion={node}
              homeQIndex={qIndex}
              categories={categories}
              onCommitDraft={onCommitDraft}
              onCancel={onCancelDraft}
            />
          ) : null}
        </div>
      ) : null}

      <div className="qz-s3-sec-foot">
        {!freeform ? (
          <button
            type="button"
            className="qz-s3-sec-footbtn"
            onClick={() => onCommit(addAnswer(doc, node.id))}
          >
            + Add answer
          </button>
        ) : null}
        {!freeform ? (
          <button
            type="button"
            className="qz-s3-sec-footbtn"
            disabled={draftActive || categories.length === 0}
            title={
              categories.length === 0
                ? "Add a recommendation in Step 1 first — rules need a target"
                : "Add a rule scoped to this question"
            }
            onClick={() => onStartDraft(node.id)}
          >
            λ Add rule
          </button>
        ) : null}
      </div>
    </section>
  );
}
