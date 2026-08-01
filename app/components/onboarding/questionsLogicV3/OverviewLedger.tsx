import { useState } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { OrderedQuestion, OrderedFlowStep } from "../../../lib/questionOrder";
import {
  addAnswer,
  insertQuestionRelative,
  insertContentRelative,
  removeAnswer,
} from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { QzModal } from "../../qz-overlays";
import { EditableText } from "./content/EditableText";
import { TypeChipSelector } from "./content/TypeChipSelector";
import { CONTENT_META } from "./LeftRail";
import { IconUp, IconDown, IconTrash, IconPlus } from "./icons";

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

/* §3 — a CONTENT step is a SINGLE row, no body: [movers][muted n][◆ Content]
   [title][meta] | [Edit settings][🗑]. The Edit-settings button occupies the
   same right-hand slot the type dropdown occupies on a question row, so the
   two row types share geometry. */
function ContentRow({
  doc,
  step,
  index,
  total,
  onCommit,
  onReorder,
  onDelete,
}: {
  doc: QuizDoc;
  step: OrderedFlowStep;
  index: number;
  total: number;
  onCommit: (doc: QuizDoc) => void;
  onReorder: (id: string, toIndex: number) => void;
  onDelete: (id: string) => void;
}) {
  const { node } = step;
  const isMessage = node.type === "message";
  const text = isMessage ? ((node.data as { text?: string }).text ?? "") : "";
  const title = isMessage ? text || "Message" : (CONTENT_META[node.type] ?? node.type).replace("◆ ", "");
  const meta = CONTENT_META[node.type] ?? node.type;
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <section className="qz-s3-card is-content" aria-label={`Content step ${index + 1}`}>
      <div className="qz-s3-card-head">
        <div className="qz-s3-card-headl">
          <span className="qz-s3-mv">
            <button
              type="button"
              className="qz-s3-mvb"
              disabled={index === 0}
              aria-label="Move step up"
              onClick={() => onReorder(node.id, index - 1)}
            >
              <IconUp />
            </button>
            <button
              type="button"
              className="qz-s3-mvb"
              disabled={index === total - 1}
              aria-label="Move step down"
              onClick={() => onReorder(node.id, index + 1)}
            >
              <IconDown />
            </button>
          </span>
          <span className="qz-s3-numchip is-c" title={`Step ${index + 1}`}>
            {index + 1}
          </span>
          <span className="qz-qf-ovcontent">◆ Content</span>
          {isMessage ? (
            <EditableText
              value={title}
              onCommit={(t) => {
                const v = t.trim().slice(0, 300);
                if (v) onCommit(updateNodeData(doc, node.id, { text: v }));
              }}
              maxLength={300}
              ariaLabel={`Content step ${index + 1} title`}
              className="qz-qf-v2q is-content"
            />
          ) : (
            <span className="qz-qf-v2q is-content is-ro">{title}</span>
          )}
          <span className="qz-qf-cmeta">{meta.replace("◆ ", "")}</span>
        </div>
        <div className="qz-s3-card-type">
          <button
            type="button"
            className="qz-qf-setbtn"
            disabled={!isMessage}
            title={isMessage ? "Edit this content page" : "Configured in the main builder"}
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ Edit settings
          </button>
          <button
            type="button"
            className="qz-s3-cdel"
            title="Delete content page"
            aria-label={`Delete content step ${index + 1}`}
            onClick={() => onDelete(node.id)}
          >
            <IconTrash />
          </button>
        </div>
      </div>
      {settingsOpen && isMessage ? (
        <QzModal
          open
          onClose={() => setSettingsOpen(false)}
          size="sm"
          title="Content page"
          footer={
            <button type="button" className="qz-btn qz-btn-accent" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          }
        >
          <div className="qz-qf-omrow">
            <span className="qz-qf-oml">Message</span>
            <textarea
              className="qz-input"
              rows={3}
              defaultValue={text}
              aria-label="Content page message"
              onBlur={(e) => {
                const v = e.target.value.trim().slice(0, 300);
                if (v && v !== text) onCommit(updateNodeData(doc, node.id, { text: v }));
              }}
            />
          </div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Shown between two steps as its own page, with a Continue button.
          </p>
        </QzModal>
      ) : null}
    </section>
  );
}

function LedgerRow({
  doc,
  question,
  index,
  total,
  isDecider,
  onlyQuestion,
  onCommit,
  onReorder,
  onDelete,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  /** Position in the FULL flow (content included) — §2 numbering. */
  index: number;
  total: number;
  isDecider: boolean;
  /** The last remaining question can't be deleted (a quiz needs one). */
  onlyQuestion: boolean;
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
            disabled={isDecider || onlyQuestion}
            title={
              isDecider
                ? "This question decides the result — move the role first (Logic step), then delete"
                : onlyQuestion
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

/* Mock .ins — the inserter riding the divider, with the two-option menu:
   "Add a question here" / "Add a content block". */
function AddStepDivider({
  onAddQuestion,
  onAddContent,
}: {
  onAddQuestion: () => void;
  onAddContent: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`qz-s3-divider qz-qf-ins${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="qz-s3-divider-btn"
        aria-label="Add a step here"
        aria-expanded={open}
        title="Add a question or content block here"
        onClick={() => setOpen((v) => !v)}
      >
        <IconPlus />
      </button>
      {open ? (
        <div className="qz-qf-insmenu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddQuestion();
            }}
          >
            ＋ Add a question here
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddContent();
            }}
          >
            ◆ Add a content block
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function OverviewLedger({
  doc,
  steps,
  deciderId,
  onCommit,
  onReorder,
  onDelete,
}: {
  doc: QuizDoc;
  /** §2 — the FULL flow, content steps included, numbered 1..N. */
  steps: OrderedFlowStep[];
  deciderId: string | null;
  onCommit: (doc: QuizDoc) => void;
  onReorder: (id: string, toIndex: number) => void;
  onDelete: (id: string) => void;
}) {
  // Divider inserts anchor on MOVABLE steps (the add-anchor lesson).
  const addBelow = (refId: string) => onCommit(insertQuestionRelative(doc, refId, "below"));
  const addContentBelow = (refId: string) => onCommit(insertContentRelative(doc, refId, "below"));
  const first = steps[0]?.node.id;
  const nQuestions = steps.filter((s) => s.kind === "question").length;

  return (
    <div className="qz-s3-ledger">
      {first ? (
        <AddStepDivider
          onAddQuestion={() => onCommit(insertQuestionRelative(doc, first, "above"))}
          onAddContent={() => onCommit(insertContentRelative(doc, first, "above"))}
        />
      ) : null}
      {steps.map((s, i) => (
        <div key={s.node.id} className="qz-s3-ledgerrow">
          {s.kind === "content" ? (
            <ContentRow
              doc={doc}
              step={s}
              index={i}
              total={steps.length}
              onCommit={onCommit}
              onReorder={onReorder}
              onDelete={onDelete}
            />
          ) : (
            <LedgerRow
              doc={doc}
              question={{ node: s.node, qIndex: s.qIndex ?? 1 } as OrderedQuestion}
              index={i}
              total={steps.length}
              isDecider={s.node.id === deciderId}
              onlyQuestion={nQuestions <= 1}
              onCommit={onCommit}
              onReorder={onReorder}
              onDelete={onDelete}
            />
          )}
          <AddStepDivider
            onAddQuestion={() => addBelow(s.node.id)}
            onAddContent={() => addContentBelow(s.node.id)}
          />
        </div>
      ))}
    </div>
  );
}
