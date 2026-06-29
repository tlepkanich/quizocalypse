import type { Quiz as QuizDoc, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import {
  setAnswerBucketDirect,
  setAnswerRoute,
  routeAnswerToEnd,
  removeAnswer,
} from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { answerBucketId, answerSkipValue, type QuestionNode } from "./questionOrder";
import { bucketColor, answerLetter, answerLetterColor } from "./bucketPalette";

const ANSWER_MAX = 60;

export interface SkipOption {
  /** Node id to route to, or the sentinel "__end__" for End-quiz. */
  value: string;
  label: string;
}

// Questions & Logic spec §3.1 — one answer row inside a question card. Carries the
// editable answer text plus the INLINE "Maps to bucket" colored pill and "Skip to"
// dropdown — the spec's core move (mapping + routing live on the row, not a side
// panel). All three write through the same reused mutations, so the Builder card
// and the Table view stay in lock-step over one doc.
export function AnswerRow({
  doc,
  node,
  answer,
  index,
  categories,
  skipOptions,
  canDelete,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuestionNode;
  answer: Answer;
  index: number;
  categories: BuilderCategory[];
  skipOptions: SkipOption[];
  canDelete: boolean;
  onCommit: (doc: QuizDoc) => void;
}) {
  // ── Maps to bucket (direct: first points key) ──
  const bucketId = answerBucketId(answer);
  const bucketIdx = bucketId ? categories.findIndex((c) => c.id === bucketId) : -1;
  const color = bucketIdx >= 0 ? bucketColor(bucketIdx) : null;
  // The inline pill is DIRECT-only (one bucket per answer). On a weighted quiz,
  // writing through it would collapse a multi-bucket weighted map to a single
  // entry — so disable it there (weights are edited via the Table view / the
  // scoring badge) rather than silently flatten the answer's weighted mapping.
  const weighted = (doc.scoring_model ?? "direct") === "weighted";

  // ── Skip to (edge sourced from this answer's handle) ──
  const skipValue = answerSkipValue(doc, node.id, answer);
  const isSkipping = skipValue !== "";

  const setText = (text: string) => {
    const answers = node.data.answers.map((a) =>
      a.id === answer.id ? { ...a, text: text.slice(0, ANSWER_MAX) } : a,
    );
    onCommit(updateNodeData(doc, node.id, { answers }));
  };

  return (
    <div className="qz-ql-arow">
      <span
        className="qz-ql-bullet"
        style={{ background: answerLetterColor(index) }}
        aria-hidden
      >
        {answerLetter(index)}
      </span>
      <input
        className="qz-ql-atext"
        value={answer.text}
        maxLength={ANSWER_MAX}
        placeholder="Answer option…"
        onChange={(e) => setText(e.target.value)}
        aria-label={`Answer ${answerLetter(index)} text`}
      />

      <select
        className={`qz-ql-bucket ${color ? "is-mapped" : "is-unset"}`}
        value={bucketId ?? ""}
        disabled={weighted}
        title={
          weighted
            ? "Weighted scoring is active — switch to Direct mapping in the top bar to edit buckets here"
            : undefined
        }
        onChange={(e) =>
          onCommit(setAnswerBucketDirect(doc, node.id, answer.id, e.target.value || null))
        }
        style={
          color
            ? { color: color.solid, background: color.bg, borderColor: color.mid }
            : undefined
        }
        aria-label={`Maps ${answer.text || "answer"} to bucket`}
      >
        <option value="">— Map to bucket</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        className={`qz-ql-skip ${isSkipping ? "is-active" : ""}`}
        value={skipValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__end__") onCommit(routeAnswerToEnd(doc, node.id, answer.id));
          else onCommit(setAnswerRoute(doc, node.id, answer.id, v || null));
        }}
        aria-label={`Skip-to destination for ${answer.text || "answer"}`}
      >
        <option value="">Next question</option>
        {skipOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="qz-ql-adel"
        disabled={!canDelete}
        title={canDelete ? "Remove answer" : "Minimum 2 answers required"}
        aria-label={`Remove answer ${answerLetter(index)}`}
        onClick={() => {
          if (canDelete) onCommit(removeAnswer(doc, node.id, answer.id));
        }}
      >
        ✕
      </button>
    </div>
  );
}
