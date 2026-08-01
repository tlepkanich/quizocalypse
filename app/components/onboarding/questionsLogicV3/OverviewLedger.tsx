import { useState } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { addAnswer, insertQuestionRelative, removeAnswer } from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { EditableText } from "./content/EditableText";
import { TypeChipSelector } from "./content/TypeChipSelector";
import { AddQuestionDivider } from "./logic/AddQuestionDivider";
import { IconUp, IconDown, IconTrash } from "./icons";

/* questions-full-page.html §1 — the Questions step's ▦ Overview tab: the
   merchant's bulk-editing LEDGER. One bordered rounded container; each
   question is a row separated by a hairline (no gaps, no per-row shadows);
   the right column is defined once (--rcol) so the divider and everything
   after it sit on one vertical line. Row anatomy: ↑↓ movers · number chip
   (CLICK TO RENUMBER) · contenteditable question · type control + hover 🗑 |
   body: FLUSH numbered answers (hover ✕, min 2) + "+ Add answer" landing on
   the divider · settings column (multi Min/Max, scale Max — the numeric
   controls; scale end labels edit beside the number squares). CONTENT here
   is plain editing — the decider logic (Maps to / roles / rules) lives on
   the Logic STEP, not in this tab. */

const TEXT_MAX = 150;
const ANSWER_MAX = 60;

/** Mock stepper: − value + in one bordered pill. */
function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <span className="qz-s3-stepper">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="qz-s3-stepper-val">{value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}

function LedgerRow({
  doc,
  question,
  index,
  total,
  isDecider,
  onCommit,
  onReorder,
  onDelete,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  index: number;
  total: number;
  isDecider: boolean;
  onCommit: (doc: QuizDoc) => void;
  onReorder: (id: string, toIndex: number) => void;
  onDelete: (id: string) => void;
}) {
  const { node } = question;
  const freeform = isFreeformType(node.data.question_type);
  const multi = node.data.question_type === "multi_select";
  const rating = node.data.question_type === "rating";
  const answers = node.data.answers;
  const canDeleteAnswer = answers.length > 2;
  const hasSettings = multi || rating;

  const [renumbering, setRenumbering] = useState(false);
  const commitRenumber = (raw: string, ok: boolean) => {
    setRenumbering(false);
    if (!ok) return;
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) onReorder(node.id, v - 1);
  };

  const setAnswerText = (answerId: string, text: string) => {
    const next = answers.map((a) => (a.id === answerId ? { ...a, text } : a));
    onCommit(updateNodeData(doc, node.id, { answers: next }));
  };

  const scaleMin = node.data.scale_config?.min ?? 1;
  const scaleMax = node.data.scale_config?.max ?? 5;
  const patchScale = (patch: Record<string, unknown>) =>
    onCommit(
      updateNodeData(doc, node.id, {
        scale_config: { ...(node.data.scale_config ?? {}), ...patch },
      }),
    );

  return (
    <section className="qz-s3-card" aria-label={`Question ${index + 1}`}>
      <div className="qz-s3-card-head">
        <div className="qz-s3-card-headl">
          <span className="qz-s3-mv">
            <button
              type="button"
              className="qz-s3-mvb"
              disabled={index === 0}
              aria-label="Move question up"
              onClick={() => onReorder(node.id, index - 1)}
            >
              <IconUp />
            </button>
            <button
              type="button"
              className="qz-s3-mvb"
              disabled={index === total - 1}
              aria-label="Move question down"
              onClick={() => onReorder(node.id, index + 1)}
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
                defaultValue={index + 1}
                autoFocus
                aria-label={`Move question ${index + 1} to position`}
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
              {index + 1}
            </button>
          )}
          <EditableText
            value={node.data.text}
            onCommit={(text) => {
              const v = text.trim().slice(0, TEXT_MAX);
              if (v && v !== node.data.text) onCommit(updateNodeData(doc, node.id, { text: v }));
            }}
            maxLength={TEXT_MAX}
            ariaLabel={`Question ${index + 1} text`}
            className="qz-qf-v2q"
          />
        </div>
        <div className={`qz-s3-card-type${hasSettings ? "" : " is-noline"}`}>
          <TypeChipSelector doc={doc} node={node} onCommit={onCommit} />
          <button
            type="button"
            className="qz-s3-cdel"
            disabled={isDecider || total <= 1}
            title={
              isDecider
                ? "This question decides the result — move the role first (Logic step), then delete"
                : total <= 1
                  ? "A quiz needs at least one question"
                  : "Delete question"
            }
            aria-label={`Delete question ${index + 1}`}
            onClick={() => onDelete(node.id)}
          >
            <IconTrash />
          </button>
        </div>
      </div>

      <div className={`qz-s3-card-body${hasSettings ? "" : " is-noset"}`}>
        <div className="qz-s3-card-ans">
          {freeform ? (
            <p className="qz-qf-ovmeta" role="note">
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
                    aria-label="Scale start label"
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
                    aria-label="Scale end label"
                    onBlur={(e) => patchScale({ endpoint_label_max: e.target.value.trim() || undefined })}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              {/* §4 — FLUSH numbered answers; ✕ follows the text, hover-reveal. */}
              <ul className="qz-qf-alist">
                {answers.map((a, i) => (
                  <li key={a.id}>
                    <span className="qz-qf-anum" aria-hidden>{i + 1}</span>
                    <EditableText
                      value={a.text}
                      onCommit={(text) => setAnswerText(a.id, text)}
                      maxLength={ANSWER_MAX}
                      ariaLabel={`Answer ${i + 1} text`}
                      className="qz-qf-atx"
                    />
                    <button
                      type="button"
                      className="qz-qf-adel"
                      disabled={!canDeleteAnswer}
                      aria-label={`Delete answer ${i + 1}`}
                      title={
                        canDeleteAnswer
                          ? "Delete this answer"
                          : "Questions need at least 2 answers"
                      }
                      onClick={() => {
                        if (canDeleteAnswer) onCommit(removeAnswer(doc, node.id, a.id));
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {/* §4 — Add-answer sits at the END of the answers column so its
                  right edge lands on the settings divider. */}
              <div className="qz-s3-sec-foot">
                <span />
                <button
                  type="button"
                  className="qz-s3-sec-footbtn is-add"
                  onClick={() => onCommit(addAnswer(doc, node.id))}
                >
                  ＋ Add answer
                </button>
              </div>
            </>
          )}
        </div>

        {hasSettings ? (
          <div className="qz-s3-card-set">
            <span className="qz-s3-set-kicker">Settings</span>
            {multi ? (
              <>
                <div className="qz-s3-set-r">
                  <span className="qz-s3-set-lbl">Min</span>
                  <Stepper
                    value={node.data.min_selections ?? 1}
                    min={1}
                    max={node.data.max_selections ?? answers.length}
                    onChange={(v) => onCommit(updateNodeData(doc, node.id, { min_selections: v }))}
                    label="minimum selections"
                  />
                </div>
                <div className="qz-s3-set-r">
                  <span className="qz-s3-set-lbl">Max</span>
                  <Stepper
                    value={node.data.max_selections ?? answers.length}
                    min={node.data.min_selections ?? 1}
                    max={Math.max(answers.length, 1)}
                    onChange={(v) => onCommit(updateNodeData(doc, node.id, { max_selections: v }))}
                    label="maximum selections"
                  />
                </div>
              </>
            ) : null}
            {rating ? (
              <div className="qz-s3-set-r">
                <span className="qz-s3-set-lbl">Max</span>
                <Stepper
                  value={scaleMax}
                  min={scaleMin + 1}
                  max={10}
                  onChange={(v) => patchScale({ max: v })}
                  label="scale points"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function OverviewLedger({
  doc,
  questions,
  deciderId,
  onCommit,
  onReorder,
  onDelete,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  deciderId: string | null;
  onCommit: (doc: QuizDoc) => void;
  onReorder: (id: string, toIndex: number) => void;
  onDelete: (id: string) => void;
}) {
  // Divider inserts anchor on MOVABLE questions (the add-anchor lesson).
  const addBelow = (refId: string) => onCommit(insertQuestionRelative(doc, refId, "below"));
  const addAboveFirst = () => {
    const refId = questions[0]?.node.id;
    if (refId) onCommit(insertQuestionRelative(doc, refId, "above"));
  };

  return (
    <div className="qz-s3-ledger">
      {questions.length > 0 ? <AddQuestionDivider onAdd={addAboveFirst} /> : null}
      {questions.map((q, i) => (
        <div key={q.node.id} className="qz-s3-ledgerrow">
          <LedgerRow
            doc={doc}
            question={q}
            index={i}
            total={questions.length}
            isDecider={q.node.id === deciderId}
            onCommit={onCommit}
            onReorder={onReorder}
            onDelete={onDelete}
          />
          <AddQuestionDivider onAdd={() => addBelow(q.node.id)} />
        </div>
      ))}
    </div>
  );
}
