import { useRef, useState } from "react";
import type { Quiz, QuestionType } from "../../../lib/quizSchema";
import { appendBankQuestion } from "../../../lib/quizMutations";
import { QzModal } from "../../qz-overlays";
export function QuestionComposer({
  doc,
  onAdd,
  onClose,
}: {
  doc: Quiz;
  onAdd: (next: Quiz, id: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<QuestionType>("single_select");
  const [answers, setAnswers] = useState(["", ""]);
  const first = useRef<HTMLInputElement>(null);
  const valid = Boolean(text.trim()) && answers.every((a) => a.trim());
  return (
    <QzModal
      open
      onClose={onClose}
      title="Add a question"
      size="md"
      initialFocusRef={first}
      footer={
        <>
          <button type="button" className="qz-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-primary"
            disabled={!valid}
            onClick={() => {
              const next = appendBankQuestion(doc, {
                text: text.trim(),
                question_type: type,
                answers: answers.map((a) => a.trim()),
              });
              const id = next.nodes.find(
                (n) => !doc.nodes.some((old) => old.id === n.id),
              )?.id;
              if (id) onAdd(next, id);
            }}
          >
            Add question
          </button>
        </>
      }
    >
      <div className="qz-walk-composer">
        <label>
          Question type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as QuestionType)}
          >
            <option value="single_select">Single select</option>
            <option value="multi_select">Multi-select</option>
            <option value="image_tile">Image select</option>
          </select>
        </label>
        <label>
          Question
          <input
            ref={first}
            value={text}
            maxLength={150}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="qz-walk-answer-count">
          <span>Answers</span>
          <button
            type="button"
            className="qz-btn qz-btn-sm"
            aria-label="Remove answer field"
            disabled={answers.length <= 2}
            onClick={() => setAnswers((a) => a.slice(0, -1))}
          >
            −
          </button>
          <span>{answers.length}</span>
          <button
            type="button"
            className="qz-btn qz-btn-sm"
            aria-label="Add answer field"
            disabled={answers.length >= 10}
            onClick={() => setAnswers((a) => [...a, ""])}
          >
            +
          </button>
        </div>
        {answers.map((answer, i) => (
          <label key={i}>
            Answer {i + 1}
            <input
              maxLength={60}
              value={answer}
              onChange={(e) =>
                setAnswers((a) =>
                  a.map((s, j) => (j === i ? e.target.value : s)),
                )
              }
            />
          </label>
        ))}
      </div>
    </QzModal>
  );
}
