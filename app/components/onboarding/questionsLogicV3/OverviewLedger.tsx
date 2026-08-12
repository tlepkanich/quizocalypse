import { useState } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { OrderedQuestion, OrderedFlowStep } from "../../../lib/questionOrder";
import {
  addAnswer,
  insertQuestionRelative,
  insertContentRelative,
  moveDecider,
  removeAnswer,
  setQuestionRole,
} from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { QzModal, QzPopover } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import {
  derivedNarrowLabel,
  ROLE_FOOT,
  ROLE_JOBS,
} from "../../studio/logicTab/logicTabFields";
import { EditableText } from "./content/EditableText";
import { TypeChipSelector } from "./content/TypeChipSelector";
import { CONTENT_META } from "./LeftRail";
import { IconTrash, IconPlus } from "./icons";

/* QRTZ-S5 (mock s12 lower, _src/shared.mjs screenOverview) — the Questions
   step's ▦ Overview tab is a REAL GRID: a sticky column header (# · Question ·
   Answers · Type & role — QRTZ-OB1 restored the mock's role dimension, GAPS
   §A item 6 reversing owner call §8b; it folds into the Type column exactly
   as the mock folds them), one grid row per step on firm rules, row hover
   cream-2, the answers list filling its own column, and a "Show the other N
   questions" truncation after the first four rows. Everything that already worked is
   kept: click-to-renumber number chips (extended to content rows — they lost
   their ↑/↓ movers with the card layout, and renumber is the keyboard-friendly
   replacement), contenteditable question/answer text, add-answer in the
   answers column, the content-page settings modal, and the divider inserter
   between rows. The mock's stacked movers are gone with the cards; reorder =
   renumber here, drag/arrow-keys in the ✎ Questions rail. Multi/scale
   settings (Min/Max steppers, scale end labels) stay — stacked under the type
   control in the Type column. */

const TEXT_MAX = 150;
const ANSWER_MAX = 60;

/** Mock .ovw truncation — rows shown before "Show the other N questions". */
const OVW_LIMIT = 4;

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

/** The number cell: click-to-renumber chip → inline number input (Enter
    commits, Escape cancels, blur commits). Shared by question AND content
    rows — renumber is the Overview's one reorder affordance. */
function NumberCell({
  id,
  index,
  isDecider,
  isContent,
  noun,
  onReorder,
}: {
  id: string;
  index: number;
  isDecider: boolean;
  isContent: boolean;
  noun: string;
  onReorder: (id: string, toIndex: number) => void;
}) {
  const [renumbering, setRenumbering] = useState(false);
  const commit = (raw: string, ok: boolean) => {
    setRenumbering(false);
    if (!ok) return;
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) onReorder(id, v - 1);
  };
  if (renumbering) {
    return (
      <span
        className={`qz-s3-numchip is-editing${isDecider ? " is-decider" : ""}${isContent ? " is-c" : ""}`}
      >
        <input
          className="qz-s3-numinput"
          type="number"
          min={1}
          defaultValue={index + 1}
          autoFocus
          aria-label={`Move ${noun} ${index + 1} to position`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value, true);
            } else if (e.key === "Escape") {
              commit("", false);
            }
          }}
          onBlur={(e) => commit(e.target.value, true)}
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`qz-s3-numchip is-edit${isDecider ? " is-decider" : ""}${isContent ? " is-c" : ""}`}
      title={`Click to renumber — moves this ${noun} to that position`}
      onClick={() => setRenumbering(true)}
    >
      {index + 1}
    </button>
  );
}

const stripQ = (s: string) => s.replace(/\s*\?\s*$/, "");

/* QRTZ-OB1 (mock .ovw-type role-stack + role popover, shared.mjs 443–452;
   GAPS §A item 6) — the Overview's role control. The menu is the mock's role
   popover on the shared vocabulary (logicTabFields.ROLE_JOBS), and every
   write is the SAME barrel mutation the Logic window commits — moveDecider /
   setQuestionRole — so the target_ids mirror invariant has exactly one write
   path. The attribute under a Narrows role is the DERIVED readout (never
   stored), exactly like the Logic pill's attr line. */
function RoleControl({
  doc,
  node,
  qIndex,
  deciderQIndex,
  onCommit,
}: {
  doc: QuizDoc;
  node: OrderedQuestion["node"];
  qIndex: number;
  /** The current decider's question number (for "now on QN"), null if none. */
  deciderQIndex: number | null;
  onCommit: (doc: QuizDoc) => void;
}) {
  const toast = useQzToast();
  const [open, setOpen] = useState(false);
  const role = node.data.role;
  const isDecider = role === "decides";
  const isFilter = role === "filter";
  const cannotDecide =
    node.data.question_type === "multi_select" || isFreeformType(node.data.question_type);
  const label = isDecider ? "Picks the result" : isFilter ? "Narrows" : "Asked only";

  // Mirrors QuestionWindow's setJob byte-for-byte in semantics: promote via
  // moveDecider (one decider per quiz), demote via setQuestionRole.
  const setJob = (job: (typeof ROLE_JOBS)[number]["k"]) => {
    setOpen(false);
    if (job === "decides") {
      if (isDecider) return;
      const prev = doc.nodes.find(
        (n) => n.type === "question" && n.data.role === "decides",
      );
      onCommit(moveDecider(doc, node.id));
      if (prev && prev.id !== node.id && prev.type === "question")
        toast(
          `"${stripQ(node.data.text)}" now picks the result (was "${stripQ(prev.data.text)}")`,
        );
      return;
    }
    if (job === "filter" && isFilter) return;
    if (job === "info" && !isDecider && !isFilter) return;
    onCommit(setQuestionRole(doc, node.id, job === "filter" ? "filter" : "qualifier"));
  };

  return (
    <div className="qz-ovw-rolestack">
      <QzPopover
        open={open}
        onOpenChange={setOpen}
        maxWidth={300}
        trigger={
          <button
            type="button"
            className={`qz-ovw-role${isDecider ? " is-decider" : ""}`}
            aria-label={`Question ${qIndex} role: ${label}`}
          >
            {label} <span className="qz-ovw-role-caret" aria-hidden>▾</span>
          </button>
        }
        content={
          <div className="qz-ltab-menu">
            {/* Mock .pop-head ("Question 1 does", shared.mjs line 444). */}
            <div className="qz-ltab-menu-title">Question {qIndex} does</div>
            {ROLE_JOBS.map((j) => {
              const on =
                j.k === "decides" ? isDecider : j.k === "filter" ? isFilter : !isDecider && !isFilter;
              const sub =
                j.k === "decides" && cannotDecide
                  ? "needs single-answer choices"
                  : j.k === "decides" && deciderQIndex !== null && !isDecider
                    ? `now on Q${deciderQIndex}`
                    : j.hint;
              return (
                <button
                  key={j.k}
                  type="button"
                  className={`qz-ltab-menu-row${on ? " is-current" : ""}`}
                  disabled={j.k === "decides" && cannotDecide}
                  onClick={() => setJob(j.k)}
                >
                  <span className="qz-ltab-menu-row-main">{j.n}</span>
                  <span className="qz-ltab-menu-row-sub">{sub}</span>
                </button>
              );
            })}
            {/* Mock .pop-foot verbatim (shared.mjs line 451). */}
            <div className="qz-qwin-rolefoot">{ROLE_FOOT}</div>
          </div>
        }
      />
      {isFilter ? (
        <span
          className="qz-ltab-attr"
          title={`narrows on ${derivedNarrowLabel(node.data.answers)}`}
        >
          narrows on <b>{derivedNarrowLabel(node.data.answers)}</b>
        </span>
      ) : null}
    </div>
  );
}

/* A CONTENT step rides the same grid: muted number · ◆ Content + editable
   title in the Question column · its meta line in the Answers column · the
   Edit-settings button + delete in the Type column (same geometry as a
   question row's type control). */
function ContentRow({
  doc,
  step,
  index,
  onCommit,
  onReorder,
  onDelete,
}: {
  doc: QuizDoc;
  step: OrderedFlowStep;
  index: number;
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
    <section className="qz-ovw-row is-content" aria-label={`Content step ${index + 1}`}>
      <span className="qz-ovw-ncell">
        <NumberCell
          id={node.id}
          index={index}
          isDecider={false}
          isContent
          noun="step"
          onReorder={onReorder}
        />
      </span>
      <div className="qz-ovw-qcell">
        <span className="qz-qf-ovcontent">Content</span>
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
      </div>
      <div className="qz-ovw-anscell">
        <span className="qz-qf-cmeta">{meta.replace("◆ ", "")}</span>
      </div>
      <div className="qz-ovw-typecell">
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
  isDecider,
  deciderQIndex,
  onlyQuestion,
  onCommit,
  onReorder,
  onDelete,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  /** Position in the FULL flow (content included) — §2 numbering. */
  index: number;
  isDecider: boolean;
  /** QRTZ-OB1 — the current decider's question number (role menu hint). */
  deciderQIndex: number | null;
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
    <section
      className={`qz-ovw-row${isDecider ? " is-decider" : ""}`}
      aria-label={`Question ${index + 1}`}
    >
      <span className="qz-ovw-ncell">
        <NumberCell
          id={node.id}
          index={index}
          isDecider={isDecider}
          isContent={false}
          noun="question"
          onReorder={onReorder}
        />
      </span>
      <div className="qz-ovw-qcell">
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
      <div className="qz-ovw-anscell">
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
            {/* Mock .ovw-add — a dashed full-width button ending the answers
                column, so the list visibly "fills its column". */}
            <button
              type="button"
              className="qz-ovw-add"
              onClick={() => onCommit(addAnswer(doc, node.id))}
            >
              ＋ Add answer
            </button>
          </>
        )}
      </div>
      <div className="qz-ovw-typecell">
        <TypeChipSelector doc={doc} node={node} onCommit={onCommit} />
        {/* QRTZ-OB1 — the mock's role-stack rides under the type control
            ("Type & role" folds the two, mock .ovw-type). */}
        <RoleControl
          doc={doc}
          node={node}
          qIndex={question.qIndex}
          deciderQIndex={deciderQIndex}
          onCommit={onCommit}
        />
        {multi ? (
          <div className="qz-ovw-set">
            <span className="qz-s3-set-lbl">Min</span>
            <Stepper
              value={node.data.min_selections ?? 1}
              min={1}
              max={node.data.max_selections ?? answers.length}
              onChange={(v) => onCommit(updateNodeData(doc, node.id, { min_selections: v }))}
              label="minimum selections"
            />
            <span className="qz-s3-set-lbl">Max</span>
            <Stepper
              value={node.data.max_selections ?? answers.length}
              min={node.data.min_selections ?? 1}
              max={Math.max(answers.length, 1)}
              onChange={(v) => onCommit(updateNodeData(doc, node.id, { max_selections: v }))}
              label="maximum selections"
            />
          </div>
        ) : null}
        {rating ? (
          <div className="qz-ovw-set">
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
        <button
          type="button"
          className="qz-s3-cdel"
          disabled={isDecider || onlyQuestion}
          title={
            isDecider
              ? "This question picks the result — give the role to another question first, then delete"
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
            Add a content block
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
  // QRTZ-OB1 — the decider's question number for the role menu's "now on QN".
  const deciderQIndex = steps.find((s) => s.node.id === deciderId)?.qIndex ?? null;

  // Mock .ovw-more — the grid opens on the first four rows; the rest sit
  // behind one full-width reveal (renumber still addresses ANY position —
  // the mutation runs over the full flow, not the visible slice).
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? steps : steps.slice(0, OVW_LIMIT);
  const hidden = steps.slice(visible.length);
  const hiddenAllQuestions = hidden.every((s) => s.kind === "question");
  const moreNoun = hiddenAllQuestions ? "question" : "step";
  const moreLabel =
    hidden.length === 1
      ? `Show the other ${moreNoun}`
      : `Show the other ${hidden.length} ${moreNoun}s`;

  return (
    <div className="qz-s3-ledger qz-ovw">
      {/* QRTZ-S5 (mock .ovw-head) — the sticky column header. QRTZ-OB1:
          "Type & role" per the mock (shared.mjs line 858) — the role folds
          into the Type column, GAPS §A item 6. */}
      <div className="qz-ovw-head">
        <span>#</span>
        <span>Question</span>
        <span>Answers</span>
        <span>Type &amp; role</span>
      </div>
      {first ? (
        <AddStepDivider
          onAddQuestion={() => onCommit(insertQuestionRelative(doc, first, "above"))}
          onAddContent={() => onCommit(insertContentRelative(doc, first, "above"))}
        />
      ) : null}
      {visible.map((s, i) => (
        <div key={s.node.id} className="qz-s3-ledgerrow">
          {s.kind === "content" ? (
            <ContentRow
              doc={doc}
              step={s}
              index={i}
              onCommit={onCommit}
              onReorder={onReorder}
              onDelete={onDelete}
            />
          ) : (
            <LedgerRow
              doc={doc}
              question={{ node: s.node, qIndex: s.qIndex ?? 1 } as OrderedQuestion}
              index={i}
              isDecider={s.node.id === deciderId}
              deciderQIndex={deciderQIndex}
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
      {hidden.length > 0 ? (
        <button type="button" className="qz-ovw-more" onClick={() => setShowAll(true)}>
          {moreLabel}
        </button>
      ) : null}
    </div>
  );
}
