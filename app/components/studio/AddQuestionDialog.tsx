import { useMemo, useRef, useState } from "react";
import { uid } from "../../lib/mutations/shared";
import { QzModal } from "../qz-overlays";

// ════════════════════════════════════════════════════════════════════════════
// THE "Add a question" dialog (owner ruling 2026-09-16): the app had grown
// two different popups for the same act — the Logic tab's banded modal and
// the Questions walkthrough's bare composer — and this is the ONE standard
// that replaced both. Live artifact C still governs the scope: type, title,
// answers, NOTHING else. Role, required, mapping and images all happen on
// the question itself once it exists.
//
// The dialog is deliberately dumb about documents: it collects a payload and
// hands it to the host's onSubmit. Every host appends through the SAME pure
// mutation (appendBankQuestion — the straightThroughRun add-anchor rule), so
// the dialog never needs a doc prop. Shell = QzModal (shared scrim, focus
// trap, Esc, the focus-ring-safe body). Interior reuses the .qz-lm-* band
// system the create-rule modal established.
// ════════════════════════════════════════════════════════════════════════════

export type AddQuestionType = "single_select" | "multi_select" | "image_tile" | "rating";

export interface AddQuestionPayload {
  text: string;
  question_type: AddQuestionType;
  answers: string[];
}

const TYPES: Array<{ type: AddQuestionType; name: string; hint: string }> = [
  { type: "single_select", name: "Single select", hint: "they pick one answer" },
  { type: "multi_select", name: "Multi select", hint: "they pick several" },
  { type: "image_tile", name: "Image select", hint: "answers show as image tiles" },
  { type: "rating", name: "Five point", hint: "a 1–5 scale" },
];

interface AnswerRow {
  key: string;
  text: string;
}

export function AddQuestionDialog({
  nextNumber,
  onSubmit,
  onClose,
}: {
  /** The would-be Q number, for the footer's "Adds Q4 with 3 answers". */
  nextNumber: number;
  /** The host appends (appendBankQuestion) and closes; the dialog is pure UI. */
  onSubmit: (payload: AddQuestionPayload) => void;
  onClose: () => void;
}) {
  const [qtype, setQtype] = useState<AddQuestionType>("single_select");
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<AnswerRow[]>([
    { key: uid("row"), text: "" },
    { key: uid("row"), text: "" },
  ]);
  const titleRef = useRef<HTMLInputElement>(null);

  // Empty rows are scratch space, not errors — only FILLED rows count.
  const filledRows = useMemo(() => rows.filter((r) => r.text.trim().length > 0), [rows]);
  const answerCount = qtype === "rating" ? 5 : filledRows.length;
  const canAdd = title.trim().length > 0 && (qtype === "rating" || filledRows.length >= 2);

  const setRowText = (key: string, text: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, text } : r)));
  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));
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
    if (!canAdd) return;
    onSubmit({
      text: title.trim(),
      question_type: qtype,
      answers:
        qtype === "rating" ? ["1", "2", "3", "4", "5"] : filledRows.map((r) => r.text.trim()),
    });
  };

  return (
    <QzModal
      open
      onClose={onClose}
      title="Add a question"
      size="md"
      initialFocusRef={titleRef}
      footer={
        <div className="qz-row" style={{ width: "100%", gap: 10, alignItems: "center" }}>
          <span className="qz-adq-sum">
            Adds <b>Q{nextNumber}</b> with {answerCount} {answerCount === 1 ? "answer" : "answers"}
          </span>
          <span style={{ marginLeft: "auto" }} />
          <button type="button" className="qz-btn qz-btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-primary qz-btn-sm"
            disabled={!canAdd}
            onClick={handleAdd}
          >
            Add question
          </button>
        </div>
      }
    >
      <div className="qz-lm-bands qz-adq">
        {/* ── band 1: Type ── */}
        <section className="qz-lm-band">
          <div className="qz-lm-bh">
            <span className="qz-lm-bn">1</span>
            <span className="qz-lm-bt">Type</span>
          </div>
          <div className="qz-adq-tgrid">
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

        {/* ── band 2: Question ── */}
        <section className="qz-lm-band">
          <div className="qz-lm-bh">
            <span className="qz-lm-bn">2</span>
            <span className="qz-lm-bt">Question</span>
          </div>
          <label className="qz-lm-fld">
            <input
              ref={titleRef}
              className="qz-lm-fi"
              value={title}
              maxLength={150}
              placeholder="Which chain length do you prefer?"
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Question"
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
                <span className="qz-lm-bhint">{rows.length} · needs at least 2</span>
              </span>
            ) : null}
          </div>
          {qtype === "rating" ? (
            <p className="qz-lm-ratingnote">
              Five point generates the answers itself — a 1–5 scale, nothing to type.
            </p>
          ) : (
            <div className="qz-lm-alist">
              {rows.map((r, i) => (
                <div key={r.key} className="qz-lm-arow">
                  <button
                    type="button"
                    className="qz-lm-agrip"
                    title="Reorder — arrow keys move this answer"
                    aria-label={`Reorder answer ${i + 1} — use arrow keys`}
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
                    maxLength={60}
                    placeholder="Answer text"
                    aria-label={`Answer ${i + 1}`}
                    onChange={(e) => setRowText(r.key, e.target.value)}
                  />
                  <button
                    type="button"
                    className="qz-lm-adel"
                    aria-label={`Delete answer ${i + 1}`}
                    disabled={rows.length <= 2}
                    onClick={() => removeRow(r.key)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="qz-lm-aadd" onClick={addRow}>
                + Add answer
              </button>
              {qtype === "image_tile" ? (
                <p className="qz-adq-note">Images attach on the question once it exists.</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </QzModal>
  );
}
