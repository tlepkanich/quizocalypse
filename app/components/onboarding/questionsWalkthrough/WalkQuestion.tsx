import { useEffect, useRef } from "react";
import type { Quiz, QuizNode } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import {
  addAnswer,
  moveAnswer,
  removeAnswer,
} from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { EditableText } from "../questionsLogicV3/content/EditableText";
import { TypeChipSelector } from "../questionsLogicV3/content/TypeChipSelector";
export function WalkQuestion({
  doc,
  node,
  commit,
  onDelete,
  onRegenerate,
  busy,
}: {
  doc: Quiz;
  node: QuizNode;
  commit: (doc: Quiz) => void;
  onDelete: () => void;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const pendingFocus = useRef<string | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = editor.current?.querySelector<HTMLElement>(
      `[data-answer-id="${CSS.escape(id)}"] [role="textbox"]`,
    );
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      pendingFocus.current = null;
    }
  }, [node]);
  useEffect(() => {
    if (editor.current) editor.current.inert = busy;
  }, [busy]);
  const question = node.type === "question" ? node : null;
  const title = question
    ? question.data.text
    : node.type === "message"
      ? node.data.text
      : "Content screen";
  const editTitle = (text: string) =>
    commit(updateNodeData(doc, node.id, { text }));
  const move = (id: string, to: number) => {
    if (!question) return;
    commit(moveAnswer(doc, node.id, id, to));
  };
  return (
    <div ref={editor} aria-busy={busy}>
      <div className="qz-walk-heading">
        <h2>
          {question || node.type === "message" ? (
            <EditableText
              value={title}
              onCommit={editTitle}
              maxLength={150}
              ariaLabel={question ? "Question text" : "Message heading"}
            />
          ) : (
            title
          )}
        </h2>
        <button
          type="button"
          className="qz-walk-delete"
          aria-label={question ? "Delete question" : "Delete message screen"}
          onClick={onDelete}
        >
          ×
        </button>
      </div>
      {question ? (
        <>
          <TypeChipSelector doc={doc} node={question} onCommit={commit} />
          {isFreeformType(question.data.question_type) ? (
            <p className="qz-dim">Shoppers type their answer.</p>
          ) : (
            <div className="qz-walk-answers">
              {question.data.answers.map((answer, i) => (
                <div
                  className="qz-walk-answer"
                  key={answer.id}
                  data-answer-id={answer.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    if (question.data.answers.some((a) => a.id === id))
                      move(id, i);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.altKey &&
                      (e.key === "ArrowUp" || e.key === "ArrowDown")
                    ) {
                      e.preventDefault();
                      move(
                        answer.id,
                        Math.max(
                          0,
                          Math.min(
                            question.data.answers.length - 1,
                            i + (e.key === "ArrowUp" ? -1 : 1),
                          ),
                        ),
                      );
                    }
                  }}
                >
                  <span
                    className="qz-walk-grip"
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", answer.id)
                    }
                    title="Drag to reorder; Alt + Up or Down while editing"
                  >
                    <span>{i + 1}</span>
                    <span aria-hidden>⠿</span>
                  </span>
                  <EditableText
                    value={answer.text}
                    maxLength={60}
                    ariaLabel={`Answer ${i + 1}`}
                    onCommit={(text) =>
                      commit(
                        updateNodeData(doc, node.id, {
                          answers: question.data.answers.map((a) =>
                            a.id === answer.id ? { ...a, text } : a,
                          ),
                        }),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="qz-walk-delete"
                    disabled={question.data.answers.length <= 2}
                    aria-label={`Delete answer ${i + 1}`}
                    onClick={() =>
                      commit(removeAnswer(doc, node.id, answer.id))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="qz-walk-add"
                onClick={() => {
                  const next = addAnswer(doc, node.id);
                  const n = next.nodes.find((n) => n.id === node.id);
                  if (n?.type === "question")
                    pendingFocus.current = n.data.answers.at(-1)?.id ?? null;
                  commit(next);
                }}
              >
                + Add answer
              </button>
            </div>
          )}
          <div className="qz-walk-regen">
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={onRegenerate}
            >
              ↻ Regenerate
            </button>
          </div>
        </>
      ) : (
        <p className="qz-dim">
          {node.type === "message"
            ? "Shown on its own screen. No answers — the shopper taps Next."
            : "Configure this content screen in the main builder."}
        </p>
      )}
    </div>
  );
}
