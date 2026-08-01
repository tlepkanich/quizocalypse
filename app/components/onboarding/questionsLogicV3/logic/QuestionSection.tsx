import { useState } from "react";
import type { Quiz as QuizDoc } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import type { IndexedProduct } from "../../../../lib/recommendationEngine";
import { addAnswer, moveDecider, setQuestionRole } from "../../../../lib/quizMutations";
import { filterAnswerMatchCount } from "../../../../lib/filterMatching";
import { updateNodeData } from "../../../studio/studioDoc";
import type { OrderedQuestion, SkipOption } from "../../../../lib/questionOrder";
import type { RuleRef } from "../ruleHomes";
import type { SectionColorKey } from "../sectionPalette";
import { AnswerTableRow } from "./AnswerTableRow";
import { TypeChipSelector } from "../content/TypeChipSelector";
import { IconUp, IconDown, IconTrash } from "../icons";

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

/** Mock stepper: − value + in one bordered pill (the SETTINGS controls). */
function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <span className="qz-s3-stepper">
      <button
        type="button"
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="qz-s3-stepper-val">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}

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
  canUp,
  canDown,
  onMove,
  onReorder,
  onDelete,
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
  /** questions-full-page mock — the overview card's ↑/↓ movers. */
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  /** questions-full-page §2 — renumber: move this question to the 0-based
   *  flow position (the number chip's inline input commits here). */
  onReorder: (toIndex: number) => void;
  /** mock .cdel — delete this question (confirm lives in the shell). */
  onDelete: () => void;
  onToggleExpanded: () => void;
  onCommit: (doc: QuizDoc) => void;
  onChipClick: (ruleId: string) => void;
  onStartDraft: (nodeId: string) => void;
  registerSection: (nodeId: string, el: HTMLElement | null) => void;
}) {
  const { node, qIndex } = question;
  const freeform = isFreeformType(node.data.question_type);
  const multi = node.data.question_type === "multi_select";
  // AUDIT-23 (overview-cards mock) — the card is accent-family everywhere:
  // the per-section palette is NOT inlined any more (the .qz-s3-card CSS
  // supplies --sec-color/--sec-wash = accent); colorKey stays accepted so
  // LogicScroll's palette machinery keeps compiling.
  void colorKey;
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

  // overview-cards.html (Refined) — cards are ALWAYS expanded; the caret and
  // per-card collapse are gone. Props stay accepted so LogicScroll's state
  // machinery keeps compiling (it simply no-ops now).
  void expanded;
  void onToggleExpanded;

  // questions-full-page §2 — click the number chip → inline <input
  // type=number> → renumber (move to that overall position). Enter commits,
  // Escape cancels, blur commits.
  const [renumbering, setRenumbering] = useState(false);
  const commitRenumber = (raw: string, ok: boolean) => {
    setRenumbering(false);
    if (!ok) return;
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) onReorder(v - 1);
  };
  const rating = node.data.question_type === "rating";
  const scaleMin = node.data.scale_config?.min ?? 1;
  const scaleMax = node.data.scale_config?.max ?? 5;
  const patchScale = (patch: Record<string, unknown>) =>
    onCommit(
      updateNodeData(doc, node.id, {
        scale_config: { ...(node.data.scale_config ?? {}), ...patch },
      }),
    );

  return (
    <section
      className={`qz-s3-sec qz-s3-card${isDecider ? " is-decider" : ""}${active ? " is-active" : ""}${flashWarn ? " is-flashwarn" : ""}`}
      ref={(el) => registerSection(node.id, el)}
      data-node-id={node.id}
      aria-label={`Question ${qIndex} logic`}
    >
      {/* header — question on the left; the type control sits in the SAME
          right column as the settings so they align (mock .v2head). */}
      <div className="qz-s3-card-head">
        <div className="qz-s3-card-headl">
          <span className="qz-s3-mv">
            <button
              type="button"
              className="qz-s3-mvb"
              disabled={!canUp}
              aria-label="Move question up"
              onClick={() => onMove(-1)}
            >
              <IconUp />
            </button>
            <button
              type="button"
              className="qz-s3-mvb"
              disabled={!canDown}
              aria-label="Move question down"
              onClick={() => onMove(1)}
            >
              <IconDown />
            </button>
          </span>
          {renumbering ? (
            <span className={`qz-s3-numchip is-editing${isDecider ? " is-decider" : ""}`}>
              <input
                className="qz-s3-numinput"
                type="number"
                min={1}
                defaultValue={qIndex}
                autoFocus
                aria-label={`Move question ${qIndex} to position`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRenumber((e.target as HTMLInputElement).value, true);
                  } else if (e.key === "Escape") {
                    commitRenumber("", false);
                  }
                }}
                onBlur={(e) => commitRenumber(e.target.value, true)}
              />
            </span>
          ) : (
            <button
              type="button"
              className={`qz-s3-numchip is-edit${isDecider ? " is-decider" : ""}`}
              title="Click to renumber — moves this question to that position"
              onClick={() => setRenumbering(true)}
            >
              {qIndex}
            </button>
          )}
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
        </div>
        <div className="qz-s3-card-type">
          <TypeChipSelector doc={doc} node={node} onCommit={onCommit} />
          {/* mock .cdel — hover-reveal delete in the type column. The decider
              row's delete is disabled (deleting the deciding question would
              orphan every mapping — move the role first; AUDIT-22 deviation). */}
          <button
            type="button"
            className="qz-s3-cdel"
            disabled={isDecider}
            title={isDecider ? "Move the deciding role first, then delete" : "Delete question"}
            aria-label={`Delete question ${qIndex}`}
            onClick={onDelete}
          >
            <IconTrash />
          </button>
        </div>
      </div>

      {/* body — same right column as the header so the settings hairline runs
          straight up through the type control (mock .v2body.hasset). */}
      <div className="qz-s3-card-body">
        <div className="qz-s3-card-ans">
          {freeform ? (
            <p className="qz-s3-sec-freeform" role="note">
              Open text answer — respondents type their own reply.
            </p>
          ) : rating ? (
            <div className="qz-s3-scaleprev">
              <div className="qz-s3-scalenums" aria-hidden>
                {Array.from({ length: Math.max(0, scaleMax - scaleMin + 1) }, (_, i) => scaleMin + i).map(
                  (v) => (
                    <span
                      key={v}
                      className={`qz-s3-sn${v === scaleMin || v === scaleMax ? " is-end" : ""}`}
                    >
                      {v}
                    </span>
                  ),
                )}
              </div>
              <div className="qz-s3-scaleends">
                <label className="qz-s3-se">
                  <span className="qz-s3-sek" aria-hidden>{scaleMin}</span>
                  <input
                    className="qz-s3-slab"
                    defaultValue={node.data.scale_config?.endpoint_label_min ?? ""}
                    key={`min-${node.data.scale_config?.endpoint_label_min ?? ""}`}
                    maxLength={40}
                    placeholder={`Label for ${scaleMin} (optional)`}
                    aria-label="Scale start label (number or word)"
                    onBlur={(e) => patchScale({ endpoint_label_min: e.target.value.trim() || undefined })}
                  />
                </label>
                <label className="qz-s3-se">
                  <span className="qz-s3-sek" aria-hidden>{scaleMax}</span>
                  <input
                    className="qz-s3-slab"
                    defaultValue={node.data.scale_config?.endpoint_label_max ?? ""}
                    key={`max-${node.data.scale_config?.endpoint_label_max ?? ""}`}
                    maxLength={40}
                    placeholder={`Label for ${scaleMax} (optional)`}
                    aria-label="Scale end label (number or word)"
                    onBlur={(e) => patchScale({ endpoint_label_max: e.target.value.trim() || undefined })}
                  />
                </label>
              </div>
            </div>
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
          {freeform || rating ? null : (
            /* §4 — Add-answer sits at the END of the answers column so it
               lands on the settings divider line (mock .addans geometry). */
            <div className="qz-s3-sec-foot">
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
              <button
                type="button"
                className="qz-s3-sec-footbtn is-add"
                onClick={() => onCommit(addAnswer(doc, node.id))}
              >
                ＋ Add answer
              </button>
            </div>
          )}
        </div>

        {/* ONE consistent settings panel for every type (mock .v2set) — role,
            status, and the type-specific numeric controls live here now. */}
        <div className="qz-s3-card-set">
          <span className="qz-s3-set-kicker">Settings</span>
          <div className="qz-s3-set-r">
            <span className="qz-s3-set-lbl">Role</span>
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
          </div>
          <div className="qz-s3-set-r">
            <span className="qz-s3-set-lbl">Status</span>
            <span className={`qz-s3-sec-coverage is-${coverage.tone}`}>{coverage.label}</span>
          </div>
          {inRulesCount > 0 ? (
            <div className="qz-s3-set-r">
              <span className="qz-s3-set-lbl">Rules</span>
              <span className="qz-s3-sec-rulesbadge" title="Global rules referencing this question">
                in {inRulesCount} rule{inRulesCount === 1 ? "" : "s"}
              </span>
            </div>
          ) : null}
          {multi ? (
            <>
              <div className="qz-s3-set-r">
                <span className="qz-s3-set-lbl">Min</span>
                <Stepper
                  value={node.data.min_selections ?? 1}
                  min={1}
                  max={node.data.max_selections ?? node.data.answers.length}
                  onChange={(v) => onCommit(updateNodeData(doc, node.id, { min_selections: v }))}
                />
              </div>
              <div className="qz-s3-set-r">
                <span className="qz-s3-set-lbl">Max</span>
                <Stepper
                  value={node.data.max_selections ?? node.data.answers.length}
                  min={node.data.min_selections ?? 1}
                  max={Math.max(node.data.answers.length, 1)}
                  onChange={(v) => onCommit(updateNodeData(doc, node.id, { max_selections: v }))}
                />
              </div>
            </>
          ) : null}
          {rating ? (
            <>
              <div className="qz-s3-set-r">
                <span className="qz-s3-set-lbl">From</span>
                <Stepper
                  value={scaleMin}
                  min={0}
                  max={scaleMax - 1}
                  onChange={(v) => patchScale({ min: v })}
                />
              </div>
              <div className="qz-s3-set-r">
                <span className="qz-s3-set-lbl">To</span>
                <Stepper
                  value={scaleMax}
                  min={scaleMin + 1}
                  max={10}
                  onChange={(v) => patchScale({ max: v })}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
