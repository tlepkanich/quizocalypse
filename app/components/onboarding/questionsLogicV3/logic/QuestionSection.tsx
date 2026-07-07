import type { CSSProperties } from "react";
import type { Quiz as QuizDoc } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import type { IndexedProduct } from "../../../../lib/recommendationEngine";
import { addAnswer, moveDecider, setQuestionRole } from "../../../../lib/quizMutations";
import { filterAnswerMatchCount } from "../../../../lib/filterMatching";
import { updateNodeData } from "../../../studio/studioDoc";
import type { OrderedQuestion, SkipOption } from "../../../../lib/questionOrder";
import type { RuleRef } from "../ruleHomes";
import { sectionColorVars, type SectionColorKey } from "../sectionPalette";
import { AnswerTableRow } from "./AnswerTableRow";
import { TypeChipSelector } from "../content/TypeChipSelector";

/* quiz-step3 v3 §5.2 → QZY-2 (quiz-logic dev-handoff v1.2 §3/§4 + owner
   supplement) — the MAP CARD. Collapsed is the default scannable state:
   number chip · INLINE-EDITABLE question title (no more "Edit content" —
   everything edits here and saves to the same doc as the Content view) ·
   type chip · in-N-rules badge · coverage badge · ROLE dropdown (Picks the
   result ◆ / Filters results / Info only — single-decider enforcement
   auto-reverts the prior decider, visibly, no dialog) · expand chevron.
   Expanded adds the answer drill-down (ANSWER · MAPS TO/MATCHES · THEN GO
   TO) and the + Add answer / λ Add rule footer (the rule draft lands in
   the right-column Rules widget). Rule bands moved to the widget. */

const TEXT_MAX = 150;

type Role = "decides" | "filter" | "qualifier";

export function QuestionSection({
  doc,
  question,
  isDecider,
  hasCurrentDecider,
  colorKey,
  categories,
  productIndex,
  skipOptions,
  isRevisitTarget,
  chipsByAnswer,
  inRulesCount,
  flashWarn,
  active,
  expanded,
  onToggleExpanded,
  onCommit,
  onChipClick,
  onStartDraft,
  registerSection,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  isDecider: boolean;
  hasCurrentDecider: boolean;
  colorKey: SectionColorKey;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  skipOptions: SkipOption[];
  /** QZY-2 — THEN GO TO cycle guard: disables revisit-creating targets. */
  isRevisitTarget: (fromQuestionId: string, targetId: string) => boolean;
  chipsByAnswer: ReadonlyMap<string, RuleRef[]>;
  /** Spec §4 — global rules whose conditions reference this question. */
  inRulesCount: number;
  /** P4 — pulse the warn wash (a health jump-link landed on this section). */
  flashWarn: boolean;
  active: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCommit: (doc: QuizDoc) => void;
  onChipClick: (ruleId: string) => void;
  onStartDraft: (nodeId: string) => void;
  registerSection: (nodeId: string, el: HTMLElement | null) => void;
}) {
  const { node, qIndex } = question;
  const freeform = isFreeformType(node.data.question_type);
  const multi = node.data.question_type === "multi_select";
  const vars = sectionColorVars(colorKey);
  const minAnswers = freeform ? 1 : 2;
  const role: Role = isDecider ? "decides" : node.data.role === "filter" ? "filter" : "qualifier";

  const deciderBlocked = multi || freeform;

  // ── Spec §4 coverage badge ─────────────────────────────────────────────────
  // decider: mapped / N unmapped · filter: mapped / N dead end / no matches
  // configured yet · info: "not matched" (neutral).
  let coverage: { label: string; tone: "ok" | "warn" | "crit" | "dim" };
  if (freeform) {
    coverage = { label: "open text", tone: "dim" };
  } else if (role === "decides") {
    const unmapped = node.data.answers.filter((a) => !a.target_id).length;
    coverage =
      unmapped === 0
        ? { label: "mapped", tone: "ok" }
        : { label: `${unmapped} unmapped`, tone: "warn" };
  } else if (role === "filter") {
    const counts = node.data.answers.map((a) => filterAnswerMatchCount(a, productIndex));
    const dead = counts.filter((c) => c === 0).length;
    const configured = counts.some((c) => c !== null);
    coverage = dead > 0
      ? { label: `${dead} dead end`, tone: "crit" }
      : configured
        ? { label: "mapped", tone: "ok" }
        : { label: "nothing narrows yet", tone: "warn" };
  } else {
    coverage = { label: "not matched", tone: "dim" };
  }

  const setTitle = (text: string) => {
    const v = text.trim().slice(0, TEXT_MAX);
    if (v && v !== node.data.text) onCommit(updateNodeData(doc, node.id, { text: v }));
  };

  // Spec §3/§11 — role changes are direct + visible, no dialog. Picking
  // "Picks the result ◆" MOVES the decider (the prior one auto-reverts and
  // its stale mappings clear — the safe, locked v3 semantics).
  const setRole = (next: Role) => {
    if (next === role) return;
    if (next === "decides") {
      onCommit(moveDecider(doc, node.id));
      return;
    }
    onCommit(setQuestionRole(doc, node.id, next));
  };

  return (
    <section
      className={`qz-s3-sec${isDecider ? " is-decider" : ""}${active ? " is-active" : ""}${flashWarn ? " is-flashwarn" : ""}${expanded ? "" : " is-collapsed"}`}
      style={{ "--sec-color": vars.color, "--sec-wash": vars.wash } as CSSProperties}
      ref={(el) => registerSection(node.id, el)}
      data-node-id={node.id}
      aria-label={`Question ${qIndex} logic`}
    >
      <div className="qz-s3-sec-head">
        <span className={`qz-s3-numchip${isDecider ? " is-decider" : ""}`}>{qIndex}</span>
        {/* QZY-2 (owner supplement) — the title edits HERE, same doc field
            the Content view edits; no more "Edit content" round-trip. */}
        <input
          className="qz-s3-sec-titleinput"
          defaultValue={node.data.text}
          key={node.data.text /* re-sync external edits without controlling keystrokes */}
          maxLength={TEXT_MAX}
          aria-label={`Question ${qIndex} text`}
          onBlur={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).value = node.data.text;
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <TypeChipSelector doc={doc} node={node} onCommit={onCommit} />
        {inRulesCount > 0 ? (
          <span className="qz-s3-sec-rulesbadge" title="Global rules referencing this question">
            in {inRulesCount} rule{inRulesCount === 1 ? "" : "s"}
          </span>
        ) : null}
        <span className={`qz-s3-sec-coverage is-${coverage.tone}`}>{coverage.label}</span>
        <select
          className={`qz-s3-rolesel${isDecider ? " is-decider" : ""}`}
          value={role}
          aria-label={`Question ${qIndex} role`}
          title="What this question does to the result"
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="decides" disabled={deciderBlocked}>
            {deciderBlocked ? "Picks the result (needs single-pick)" : "Picks the result ◆"}
          </option>
          <option value="filter">Filters results</option>
          <option value="qualifier">Info only</option>
        </select>
        <button
          type="button"
          className="qz-s3-sec-caret"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse question" : "Expand question"}
          onClick={onToggleExpanded}
        >
          {expanded ? "▾" : "▸"}
        </button>
      </div>

      {!expanded ? null : freeform ? (
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
            <span>{role === "decides" ? "Maps to" : role === "filter" ? "Matches" : ""}</span>
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
              isDeciderRow={role === "decides"}
              isFilterRow={role === "filter"}
              productIndex={productIndex}
              categories={categories}
              skipOptions={skipOptions}
              isRevisitTarget={isRevisitTarget}
              chips={chipsByAnswer.get(a.id) ?? []}
              homeRuleIds={new Set<string>()}
              canDelete={node.data.answers.length > minAnswers}
              onCommit={onCommit}
              onChipClick={onChipClick}
            />
          ))}
        </div>
      )}

      {!expanded ? null : (
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
              disabled={categories.length === 0}
              title={
                categories.length === 0
                  ? "Add a recommendation in Step 1 first — rules need a target"
                  : "Add a rule pre-filled with this question (it lands in the Rules panel)"
              }
              onClick={() => onStartDraft(node.id)}
            >
              λ Add rule
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
