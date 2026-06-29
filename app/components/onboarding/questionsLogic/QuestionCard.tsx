import { useLayoutEffect, useRef } from "react";
import type { Quiz as QuizDoc, QuestionType } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { addAnswer, setQuestionType } from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { AnswerRow, type SkipOption } from "./AnswerRow";
import { type QuestionNode } from "./questionOrder";

const TEXT_MAX = 150;
const MAX_ANSWERS = 8;

// Spec §3.1 type selector — the headline 5 first (single/multi/image/scale/text),
// then the remaining existing types so nothing a quiz already uses is hidden.
const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "image_tile", label: "Image select" },
  { value: "rating", label: "Scale / rating" },
  { value: "text", label: "Open text" },
  { value: "dropdown", label: "Dropdown" },
  { value: "searchable", label: "Searchable list" },
  { value: "swatch", label: "Swatch picker" },
  { value: "image_picker", label: "Image grid" },
  { value: "slider", label: "Slider (0–100)" },
  { value: "numeric", label: "Number input" },
  { value: "date", label: "Date input" },
  { value: "email", label: "Email input" },
];

// Questions & Logic spec §3.1 — one question card in the Builder view. Top bar
// (Q badge · type selector · ✦ AI pill · Delete) + auto-grow question text +
// the answer rows with inline mapping/skip. Open-text types swap the answer list
// for the "stored as customer data, not scored" note.
export function QuestionCard({
  doc,
  node,
  qIndex,
  categories,
  skipOptions,
  canDelete,
  active,
  onCommit,
  onDelete,
  onToast,
  onRef,
  onActivate,
  regenerating,
  showUndo,
  regenError,
  onRegenerate,
  onUndoRegenerate,
  onRetryRegenerate,
  onDismissRegenError,
}: {
  doc: QuizDoc;
  node: QuestionNode;
  qIndex: number;
  categories: BuilderCategory[];
  skipOptions: SkipOption[];
  canDelete: boolean;
  active: boolean;
  onCommit: (doc: QuizDoc) => void;
  onDelete: () => void;
  onToast: (msg: string) => void;
  onRef: (el: HTMLDivElement | null) => void;
  onActivate: () => void;
  regenerating: boolean;
  showUndo: boolean;
  regenError: { message: string; credits: boolean } | null;
  onRegenerate: () => void;
  onUndoRegenerate: () => void;
  onRetryRegenerate: () => void;
  onDismissRegenError: () => void;
}) {
  const data = node.data;
  const freeform = isFreeformType(data.question_type);
  const isRequired = data.required ?? true;
  const len = data.text.length;
  // Auto-grow the question textarea to fit pre-filled text (AI-built questions
  // mount with long copy that onInput alone wouldn't expand until first keystroke).
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [data.text]);
  // Skip-options exclude THIS question (can't skip to self).
  const skipForThis = skipOptions.filter((o) => o.value !== node.id);

  const onTypeChange = (next: QuestionType) => {
    if (next === data.question_type) return;
    const ok =
      typeof window === "undefined" ||
      window.confirm("Changing the question type will reset this question's answers. Continue?");
    if (ok) onCommit(setQuestionType(doc, node.id, next));
  };

  const onAddAnswer = () => {
    if (data.answers.length >= MAX_ANSWERS) {
      onToast(`${MAX_ANSWERS} answers max per question`);
      return;
    }
    onCommit(addAnswer(doc, node.id));
  };

  const minAnswers = freeform ? 1 : 2;

  return (
    <div
      ref={onRef}
      className={`qz-ql-card ${active ? "is-active" : ""}`}
      data-qid={node.id}
      onMouseDown={onActivate}
    >
      <div className="qz-ql-card-top">
        <span className="qz-ql-qbadge">Q{qIndex}</span>
        <select
          className="qz-ql-type"
          value={data.question_type}
          onChange={(e) => onTypeChange(e.target.value as QuestionType)}
          aria-label={`Question ${qIndex} type`}
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {data.ai_generated ? (
          <span className="qz-ql-aipill" title="AI-generated — edit or regenerate freely">
            ✦ AI
          </span>
        ) : null}
        <button
          type="button"
          className={`qz-ql-reqtoggle ${isRequired ? "" : "is-optional"}`}
          aria-pressed={!isRequired}
          aria-label={`Question ${qIndex} is ${isRequired ? "required" : "optional"} — toggle`}
          title={
            isRequired
              ? "Required — shoppers must answer to continue. Click to make optional."
              : "Optional — shoppers can skip this question (a skipped answer scores zero). Click to make required."
          }
          onClick={() => onCommit(updateNodeData(doc, node.id, { required: !isRequired }))}
        >
          {isRequired ? "Required" : "Optional"}
        </button>
        <span style={{ flex: 1 }} />
        {showUndo ? (
          <button
            type="button"
            className="qz-ql-regen-undo"
            onClick={onUndoRegenerate}
            title="Undo the regeneration"
          >
            ↺ Undo
          </button>
        ) : null}
        <button
          type="button"
          className="qz-ql-regen"
          disabled={regenerating}
          title="Regenerate this question with AI (keeps bucket mappings on unchanged answers)"
          aria-label={`Regenerate question ${qIndex}`}
          onClick={onRegenerate}
        >
          {regenerating ? (
            <>
              <span className="qz-ql-spin" aria-hidden /> Regenerating…
            </>
          ) : (
            "↻ Regenerate"
          )}
        </button>
        <button
          type="button"
          className="qz-ql-qdel"
          disabled={!canDelete}
          title={canDelete ? "Delete this question" : "Need at least 1 question"}
          aria-label={`Delete question ${qIndex}`}
          onClick={() => {
            if (!canDelete) return;
            const ok = typeof window === "undefined" || window.confirm("Delete this question?");
            if (ok) onDelete();
          }}
        >
          🗑
        </button>
      </div>

      {regenError ? (
        <div className={`qz-ql-regen-error ${regenError.credits ? "is-credits" : ""}`} role="alert">
          <span aria-hidden>⚠</span> {regenError.message}{" "}
          <button type="button" className="qz-ql-retry" onClick={onRetryRegenerate}>
            Retry
          </button>
          <button
            type="button"
            className="qz-ql-regen-dismiss"
            onClick={onDismissRegenError}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}

      <textarea
        ref={textRef}
        className="qz-ql-qtext"
        value={data.text}
        maxLength={TEXT_MAX}
        rows={2}
        placeholder="Type your question here…"
        aria-label={`Question ${qIndex} text`}
        onChange={(e) => onCommit(updateNodeData(doc, node.id, { text: e.target.value.slice(0, TEXT_MAX) }))}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
      />
      {len >= 100 ? (
        <div className="qz-ql-counter">{len}/{TEXT_MAX}</div>
      ) : null}

      {freeform ? (
        <p className="qz-ql-freeform-note">
          Open-text answers aren&rsquo;t scored — responses are stored as customer data, not used
          to pick a recommendation.
        </p>
      ) : (
        <>
          <div className="qz-ql-ahead">
            <span className="qz-ql-ahead-answer">Answer</span>
            <span className="qz-ql-ahead-bucket">Maps to bucket</span>
            <span className="qz-ql-ahead-skip">Skip to</span>
          </div>
          <div className="qz-ql-arows">
            {data.answers.map((a, i) => (
              <AnswerRow
                key={a.id}
                doc={doc}
                node={node}
                answer={a}
                index={i}
                categories={categories}
                skipOptions={skipForThis}
                canDelete={data.answers.length > minAnswers}
                onCommit={onCommit}
              />
            ))}
          </div>
          <button type="button" className="qz-ql-addanswer" onClick={onAddAnswer}>
            + Add answer option
          </button>
          {data.answers.length >= MAX_ANSWERS ? (
            <span className="qz-ql-nudge">More than 8 options may reduce completion rates</span>
          ) : null}
        </>
      )}
    </div>
  );
}
