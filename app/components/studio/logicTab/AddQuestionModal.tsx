import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { insertQuestionRelative } from "../../../lib/quizMutations";
import { uid } from "../../../lib/mutations/shared";
import { updateNodeData } from "../studioDoc";
import { useFocusTrap } from "../../qz-overlays";

// ════════════════════════════════════════════════════════════════════════════
// Live artifact C — "Adding a question": type, title, answers, NOTHING else.
// Role, required and value mapping all happen on the question itself once it
// exists; putting them here would make every new question a settings form.
// One consequence the Live caption calls out: a multi select can never pick
// the result, so it lands role-less (Info only) — role is never written here.
// Five point generates answers 1–5 itself and needs none typed.
//
// The question is spliced onto the END of the spine (insertQuestionRelative
// below the last question — the same pure mutation the builder uses), then
// updateNodeData patches text / question_type / answers in the same commit.
// Portal + focus trap + document-level Esc, same conventions as the other
// Logic-step modals (the scrim deliberately does not close a draft).
// ════════════════════════════════════════════════════════════════════════════

type AddType = "single_select" | "multi_select" | "rating";

const TYPES: Array<{ type: AddType; name: string; hint: string }> = [
  { type: "single_select", name: "Single select", hint: "they pick one answer" },
  { type: "multi_select", name: "Multi select", hint: "they pick several" },
  { type: "rating", name: "Five point", hint: "a 1–5 scale" },
];

interface AnswerRow {
  key: string;
  text: string;
}

export function AddQuestionModal({
  doc,
  questions,
  onClose,
  commit,
}: {
  doc: Quiz;
  questions: OrderedQuestion[];
  onClose: () => void;
  commit: (doc: Quiz) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(boxRef, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [qtype, setQtype] = useState<AddType>("single_select");
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<AnswerRow[]>([
    { key: uid("row"), text: "" },
    { key: uid("row"), text: "" },
  ]);

  const filledRows = useMemo(
    () => rows.filter((r) => r.text.trim().length > 0),
    [rows],
  );
  const answerCount = qtype === "rating" ? 5 : filledRows.length;
  const nextQ = questions.length + 1;
  const anchorId = questions[questions.length - 1]?.node.id ?? null;
  const canAdd =
    title.trim().length > 0 &&
    anchorId !== null &&
    (qtype === "rating" || filledRows.length >= 2);

  const setRowText = (key: string, text: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, text } : r)));
  const removeRow = (key: string) =>
    setRows((prev) => prev.filter((r) => r.key !== key));
  const addRow = () => setRows((prev) => [...prev, { key: uid("row"), text: "" }]);
  // Reorder on the grip: up/down arrow keys swap the row with its neighbour.
  const moveRow = (key: string, delta: -1 | 1) =>
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(i, 1);
      next.splice(j, 0, row!);
      return next;
    });

  const handleAdd = () => {
    if (!canAdd || !anchorId) return;
    // The pure mutation mints the node id internally — diff the node sets to
    // find it, then patch the merchant's choices onto it in the same commit.
    const before = new Set(doc.nodes.map((n) => n.id));
    const inserted = insertQuestionRelative(doc, anchorId, "below");
    const created = inserted.nodes.find((n) => !before.has(n.id));
    if (!created) return;
    const answers =
      qtype === "rating"
        ? ["1", "2", "3", "4", "5"].map((t) => ({
            id: uid("a"),
            text: t,
            tags: [] as string[],
            edge_handle_id: uid("h"),
          }))
        : filledRows.map((r) => ({
            id: uid("a"),
            text: r.text.trim(),
            tags: [] as string[],
            edge_handle_id: uid("h"),
          }));
    // NO role — every new question lands as Info only (Live caption C); the
    // role is promoted on the question itself once it exists.
    commit(
      updateNodeData(inserted, created.id, {
        text: title.trim(),
        question_type: qtype,
        answers,
      }),
    );
    onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="qz-modal-scrim">
      <div
        ref={boxRef}
        className="qz-lm qz-lm-addq"
        role="dialog"
        aria-modal="true"
        aria-label="Add a question"
      >
        <header className="qz-lm-h">
          <h2>Add a question</h2>
          <button type="button" className="qz-lm-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="qz-lm-b">
          <div className="qz-lm-bands">
            {/* ── band 1: Type ── */}
            <section className="qz-lm-band">
              <div className="qz-lm-bh">
                <span className="qz-lm-bn">1</span>
                <span className="qz-lm-bt">Type</span>
              </div>
              <div className="qz-lm-tgrid3">
                {TYPES.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    className={`qz-lm-tq${qtype === t.type ? " is-on" : ""}`}
                    aria-pressed={qtype === t.type}
                    onClick={() => setQtype(t.type)}
                  >
                    <span className="qz-lm-tqn">{t.name}</span>
                    <span className="qz-lm-tqd">{t.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* ── band 2: Title ── */}
            <section className="qz-lm-band">
              <div className="qz-lm-bh">
                <span className="qz-lm-bn">2</span>
                <span className="qz-lm-bt">Title</span>
              </div>
              <label className="qz-lm-fld">
                <input
                  className="qz-lm-fi"
                  value={title}
                  placeholder="Which chain length do you prefer?"
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Question title"
                />
              </label>
            </section>

            {/* ── band 3: Answers ── */}
            <section className="qz-lm-band">
              <div className="qz-lm-bh">
                <span className="qz-lm-bn">3</span>
                <span className="qz-lm-bt">Answers</span>
                {qtype !== "rating" ? (
                  <span className="qz-lm-right">
                    <span className="qz-lm-bhint">
                      {rows.length} · needs at least 2
                    </span>
                  </span>
                ) : null}
              </div>
              {qtype === "rating" ? (
                <p className="qz-lm-ratingnote">
                  Five point generates the answers itself — a 1–5 scale, nothing
                  to type.
                </p>
              ) : (
                <div className="qz-lm-alist">
                  {rows.map((r, i) => (
                    <div key={r.key} className="qz-lm-arow">
                      <button
                        type="button"
                        className="qz-lm-agrip"
                        title="Reorder — arrow keys move this answer"
                        aria-label={`Reorder answer ${String.fromCharCode(65 + i)} — use arrow keys`}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            moveRow(r.key, -1);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            moveRow(r.key, 1);
                          }
                        }}
                      >
                        ⋮⋮
                      </button>
                      <span className="qz-lm-akey">{String.fromCharCode(65 + i)}</span>
                      <input
                        className="qz-lm-atext"
                        value={r.text}
                        placeholder="Answer text"
                        aria-label={`Answer ${String.fromCharCode(65 + i)}`}
                        onChange={(e) => setRowText(r.key, e.target.value)}
                      />
                      <button
                        type="button"
                        className="qz-lm-adel"
                        aria-label={`Delete answer ${String.fromCharCode(65 + i)}`}
                        onClick={() => removeRow(r.key)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className="qz-lm-aadd" onClick={addRow}>
                    + Add answer
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="qz-lm-f">
          <span>
            Adds <b>Q{nextQ}</b> with {answerCount}{" "}
            {answerCount === 1 ? "answer" : "answers"}
          </span>
          <span className="qz-lm-fright">
            <button type="button" className="qz-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              disabled={!canAdd}
              onClick={handleAdd}
            >
              Add question
            </button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
