import { useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { addAnswer, moveAnswer, removeAnswer } from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { EditableText } from "./content/EditableText";
import { TypeChipSelector } from "./content/TypeChipSelector";
import { IconGrip, IconMail, IconTarget, IconTrash, IconX } from "./icons";
import type { RegenApi } from "./Step3Shell";

/* questions-simple mock (AUDIT-22, owner-ruled binding spec) — the compact
   question list: one quiet row per question (19px mono number circle —
   deciding = accent · inline-editable wording · mono "N · TYPE" meta ·
   hover-reveal ⠿ drag + trash), click a row → its answers expand INLINE
   (⠿ grip · bordered editable input · hover ✕ delete, disabled at the
   2-answer floor · "+ answer"), whole-question AND answer drag-to-reorder
   with the mock's inset-top drop highlight, then the two quiet termini rows
   (✉ Email capture "Optional lead step" · ◎ Result reveal "Configured in
   Step 4 · Results").

   Functionality-preserving deviations (each keeps an existing capability,
   housed in the mock's nearest affordance):
   — the mono meta IS the type control: clicking it opens the same
     TypeChipSelector popover (radios · Min/Max · scale settings) that used
     to float beside the phone;
   — rows/answers are draggable only while the pointer is DOWN on the grip
     (the mock's always-draggable rows would fight inline text editing);
   — the termini stay clickable (they are real phone-canvas positions here);
     the ✉ row renders only while the capture step exists in the walk;
   — the decider row's delete stays disabled (deleting the deciding question
     would orphan every mapping — move the role first in ▦ Overview);
   — the per-question AI regenerate / undo / error bracket lives in the
     expanded question's footer row, next to "+ answer". */

/** Canvas position sentinels for the two termini (not real node ids). */
export const CAPTURE_ID = "__capture__";
export const REVEAL_ID = "__reveal__";

const TEXT_MAX = 150; // the shared question-text cap
const ANSWER_MAX = 60;

function AnswerList({
  doc,
  question,
  regen,
  onCommit,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  regen: RegenApi;
  onCommit: (doc: QuizDoc) => void;
}) {
  const { node } = question;
  const answers = node.data.answers;
  const freeform = isFreeformType(node.data.question_type);
  const canDelete = answers.length > 2; // card types must keep ≥2

  // ⠿ drag-to-reorder (mock dnd on the .ans container) — armed on the grip.
  const [armed, setArmed] = useState<string | null>(null);
  const from = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const endDrag = () => {
    from.current = null;
    setArmed(null);
    setDropIdx(null);
  };

  const setAnswerText = (answerId: string, text: string) => {
    const next = answers.map((a) => (a.id === answerId ? { ...a, text } : a));
    onCommit(updateNodeData(doc, node.id, { answers: next }));
  };

  const busy = regen.regeneratingId !== null;
  const regenError = regen.regenError?.nodeId === node.id ? regen.regenError : null;

  return (
    <div className="qz-qs-ans">
      {freeform ? (
        <p className="qz-qs-ffnote">
          Shoppers type their answer — this question has no fixed choices.
        </p>
      ) : (
        answers.map((a, i) => (
          <div
            key={a.id}
            className={`qz-qs-a${dropIdx === i ? " is-drophi" : ""}`}
            draggable={armed === a.id}
            onDragStart={(e: DragEvent<HTMLDivElement>) => {
              e.stopPropagation();
              from.current = i;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={endDrag}
            onDragOver={(e: DragEvent<HTMLDivElement>) => {
              if (from.current === null) return;
              e.preventDefault();
              e.stopPropagation();
              setDropIdx(i);
            }}
            onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              e.stopPropagation();
              const f = from.current;
              if (f !== null && f !== i) {
                const moving = answers[f];
                if (moving) onCommit(moveAnswer(doc, node.id, moving.id, i));
              }
              endDrag();
            }}
          >
            <span
              className="qz-qs-adot"
              title="Drag to reorder"
              onPointerDown={() => setArmed(a.id)}
              onPointerUp={() => setArmed(null)}
            >
              <IconGrip />
            </span>
            <EditableText
              value={a.text}
              onCommit={(text) => setAnswerText(a.id, text)}
              maxLength={ANSWER_MAX}
              ariaLabel={`Answer ${i + 1} text`}
              className="qz-qs-ainput"
            />
            <button
              type="button"
              className="qz-qs-adel"
              disabled={!canDelete}
              aria-label={`Delete answer ${i + 1}`}
              title={
                canDelete
                  ? "Delete this answer (its mapping and routing go with it)"
                  : "Questions need at least 2 answers"
              }
              onClick={(e) => {
                e.stopPropagation();
                if (canDelete) onCommit(removeAnswer(doc, node.id, a.id));
              }}
            >
              <IconX />
            </button>
          </div>
        ))
      )}
      <div className="qz-qs-ansfoot">
        {freeform ? null : (
          <button
            type="button"
            className="qz-qs-aadd"
            title="Add an answer to this question"
            onClick={() => onCommit(addAnswer(doc, node.id))}
          >
            + answer
          </button>
        )}
        {regen.undoNodeId === node.id ? (
          <button
            type="button"
            className="qz-qs-regenundo"
            onClick={regen.onUndoRegenerate}
            title="Undo the regeneration"
          >
            ↺ Undo
          </button>
        ) : null}
        <button
          type="button"
          className="qz-qs-regen"
          disabled={busy}
          title="Regenerate this question with AI (keeps recommendation mappings on unchanged answers)"
          onClick={() => regen.onRegenerate(node.id)}
        >
          {regen.regeneratingId === node.id ? (
            <>
              <span className="qz-ql-spin" aria-hidden /> Regenerating…
            </>
          ) : (
            "↻ Regenerate with AI"
          )}
        </button>
        {regenError ? (
          <span className="qz-qs-regenerr" role="alert">
            {regenError.message}{" "}
            <button
              type="button"
              className="qz-qs-regenretry"
              onClick={() => regen.onRegenerate(regenError.nodeId)}
            >
              Retry
            </button>
            <button
              type="button"
              className="qz-qs-regendismiss"
              onClick={regen.onDismissRegenError}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function LeftRail({
  doc,
  questions,
  deciderId,
  activeId,
  captureOn,
  regen,
  onSelect,
  onRename,
  onReorder,
  onDelete,
  onCommit,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  deciderId: string | null;
  activeId: string;
  /** Mirrors the phone walk: the ✉ row renders only when the capture screen exists. */
  captureOn: boolean;
  /** The stage's per-question AI-regenerate bracket (expanded-row footer). */
  regen: RegenApi;
  onSelect: (id: string) => void;
  /** Mock inline wording edit (contenteditable qtext). */
  onRename: (id: string, text: string) => void;
  /** Mock whole-row drag-to-reorder — move the question to the 0-based index. */
  onReorder: (id: string, toIndex: number) => void;
  /** Mock hover-trash delete (shell confirms + deletes via deleteNode). */
  onDelete: (id: string) => void;
  onCommit: (doc: QuizDoc) => void;
}) {
  // Whole-question drag-to-reorder (mock dnd on #list).
  const [armed, setArmed] = useState<string | null>(null);
  const from = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const endDrag = () => {
    from.current = null;
    setArmed(null);
    setDropIdx(null);
  };

  const onLineMouseDown = (e: MouseEvent<HTMLDivElement>, id: string) => {
    const t = e.target as HTMLElement;
    // Portal guard: the type popover's dialogs portal to document.body but
    // their React events still bubble here — a click in the modal must not
    // re-select the row (DOM containment, not the React tree).
    if (!e.currentTarget.contains(t)) return;
    // Mock: edits/tools/type work without switching the selection first.
    if (t.closest(".qz-qs-qtextwrap, .qz-qs-icon, .qz-qs-qtools, .qz-s3-typetagwrap")) return;
    if (activeId !== id) onSelect(id);
  };

  return (
    <div className="qz-qs-left">
      <div className="qz-qs-list" aria-label="Quiz questions">
        {questions.map((q, i) => {
          const isDecider = q.node.id === deciderId;
          const active = activeId === q.node.id;
          const canDelete = questions.length > 1 && !isDecider;
          return (
            <div
              key={q.node.id}
              className={`qz-qs-q${active ? " is-on" : ""}${dropIdx === i ? " is-drophi" : ""}`}
              draggable={armed === q.node.id}
              onDragStart={(e: DragEvent<HTMLDivElement>) => {
                from.current = i;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={endDrag}
              onDragOver={(e: DragEvent<HTMLDivElement>) => {
                if (from.current === null) return;
                e.preventDefault();
                setDropIdx(i);
              }}
              onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
              onDrop={(e: DragEvent<HTMLDivElement>) => {
                e.preventDefault();
                const f = from.current;
                if (f !== null && f !== i) {
                  const moving = questions[f];
                  if (moving) onReorder(moving.node.id, i);
                }
                endDrag();
              }}
            >
              <div
                className="qz-qs-qline"
                role="button"
                tabIndex={0}
                title={q.node.data.text}
                onMouseDown={(e) => onLineMouseDown(e, q.node.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  onSelect(q.node.id);
                }}
              >
                <span
                  className={`qz-qs-qn${isDecider ? " is-deciding" : ""}`}
                  title={isDecider ? "The deciding question" : undefined}
                >
                  {i + 1}
                </span>
                <span
                  className="qz-qs-qtextwrap"
                  onFocus={() => {
                    if (!active) onSelect(q.node.id);
                  }}
                >
                  <EditableText
                    value={q.node.data.text}
                    onCommit={(text) => onRename(q.node.id, text)}
                    maxLength={TEXT_MAX}
                    ariaLabel={`Question ${i + 1} wording`}
                    className="qz-qs-qtext"
                  />
                </span>
                <span className="qz-qs-qright">
                  {isDecider ? (
                    <span className="qz-qs-decdot" title="Deciding question" />
                  ) : null}
                  <TypeChipSelector doc={doc} node={q.node} onCommit={onCommit} variant="meta" />
                  <span className="qz-qs-qtools">
                    <button
                      type="button"
                      className="qz-qs-icon is-drag"
                      title="Drag to reorder"
                      aria-label={`Drag question ${i + 1} to reorder`}
                      onPointerDown={() => setArmed(q.node.id)}
                      onPointerUp={() => setArmed(null)}
                    >
                      <IconGrip />
                    </button>
                    <button
                      type="button"
                      className="qz-qs-icon"
                      disabled={!canDelete}
                      aria-label="Delete question"
                      title={
                        canDelete
                          ? "Delete this question"
                          : isDecider
                            ? "This question decides the result — make another question the decider first (▦ Overview)"
                            : "A quiz needs at least one question"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(q.node.id);
                      }}
                    >
                      <IconTrash />
                    </button>
                  </span>
                </span>
              </div>
              {active ? (
                <AnswerList doc={doc} question={q} regen={regen} onCommit={onCommit} />
              ) : null}
            </div>
          );
        })}
      </div>
      {captureOn ? (
        <button
          type="button"
          className={`qz-qs-term${activeId === CAPTURE_ID ? " is-on" : ""}`}
          title="Email capture — edit its heading, description, SMS and terms on the phone"
          onClick={() => onSelect(CAPTURE_ID)}
        >
          <span className="qz-qs-tc" aria-hidden>
            <IconMail />
          </span>
          <span>Email capture</span>
          <span className="qz-qs-ts">Optional lead step</span>
        </button>
      ) : null}
      <button
        type="button"
        className={`qz-qs-term${activeId === REVEAL_ID ? " is-on" : ""}`}
        title="Configured in Step 4 · Results"
        onClick={() => onSelect(REVEAL_ID)}
      >
        <span className="qz-qs-tc" aria-hidden>
          <IconTarget />
        </span>
        <span>Result reveal</span>
        <span className="qz-qs-ts">Configured in Step 4 · Results</span>
      </button>
    </div>
  );
}
