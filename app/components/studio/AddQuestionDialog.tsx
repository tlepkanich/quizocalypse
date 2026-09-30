import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { uid } from "../../lib/mutations/shared";
import { QzModal } from "../qz-overlays";
import { ADD_QUESTION_COPY as COPY, MAX_QUESTION_ANSWERS, letterKey } from "./logicTab/logicCopy";

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
// trap, Esc, the focus-ring-safe body). The look is the mock's #aqm window
// (owner ruling 2026-09-30): 620 wide, numbered sentence-case bands split by
// hairlines, four types across, a ground footer band — classes .qz-lg-aq*
// mirror the mock's .aq* one for one. Both hosts (Logic step, Questions
// step) get the same look; never fork it.
//
// Logic step redesign (handoff "Add a question", mock aqHTML): the hint
// counts FILLED answers (B55), the grip reorders by pointer drag as well as
// the arrow keys (B56), a delete hands focus to the row that took its place
// (B57), the rows stop at appendBankQuestion's real cap of 12 and say so
// (B58), Five-point stamps the 1–5 preset, a scrim click never loses the
// draft, and the page behind is inert and still.
// ════════════════════════════════════════════════════════════════════════════

export type AddQuestionType = "single_select" | "multi_select" | "image_tile" | "rating";

export interface AddQuestionPayload {
  text: string;
  question_type: AddQuestionType;
  answers: string[];
  /** Five-point: the 1–5 preset (what the type popover's Five-point pick writes). */
  scale_config?: { min: number; max: number };
}

interface AnswerRow {
  key: string;
  text: string;
}

/** Where a drag would drop: before row `index` (rows.length = after the last). */
type DragState = { key: string; index: number };

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
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // After a reorder or a delete, the control that should hold focus (B57).
  const pendingFocus = useRef<string | null>(null);
  // After an add, the "+ Add answer" button (or the cap note) scrolls into
  // view too, so the next add stays one click away (mock ACT.aqrow).
  const pendingReveal = useRef(false);

  useEffect(() => {
    const sel = pendingFocus.current;
    if (!sel) return;
    pendingFocus.current = null;
    listRef.current?.querySelector<HTMLElement>(sel)?.focus();
    if (pendingReveal.current) {
      pendingReveal.current = false;
      const tail = listRef.current?.querySelector<HTMLElement>(".qz-lg-aqadd2, .qz-lg-aqnote");
      tail?.scrollIntoView?.({ block: "nearest" });
    }
  });

  // Empty rows are scratch space, not errors — only FILLED rows count.
  const filledRows = useMemo(() => rows.filter((r) => r.text.trim().length > 0), [rows]);
  const isFive = qtype === "rating";
  const answerCount = isFive ? 5 : filledRows.length;
  const canAdd = title.trim().length > 0 && (isFive || filledRows.length >= 2);
  const atCap = rows.length >= MAX_QUESTION_ANSWERS;

  const setRowText = (key: string, text: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, text } : r)));
  const removeRow = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    const next = rows.filter((r) => r.key !== key);
    const heir = next[Math.min(i, next.length - 1)];
    if (heir) {
      pendingFocus.current =
        next.length > 2
          ? `[data-row="${heir.key}"] .qz-lg-aqdel`
          : `[data-row="${heir.key}"] .qz-lg-aqai`;
    }
    setRows(next);
  };
  const addRow = () => {
    if (atCap) return;
    const key = uid("row");
    pendingFocus.current = `[data-row="${key}"] .qz-lg-aqai`;
    pendingReveal.current = true;
    setRows((prev) => [...prev, { key, text: "" }]);
  };
  const moveTo = (key: string, toIndex: number) =>
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      if (i < 0) return prev;
      const next = [...prev];
      const [row] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, row!);
      return next;
    });
  // Reorder on the grip: up/down arrow keys swap the row with its neighbour.
  const moveRow = (key: string, delta: -1 | 1) => {
    const i = rows.findIndex((r) => r.key === key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= rows.length) return;
    pendingFocus.current = `[data-row="${key}"] .qz-lg-aqgrip`;
    moveTo(key, j);
  };

  // B56 — pointer drag: capture on the grip, the row under the pointer is the
  // target, a drop line marks where it lands.
  const dropIndexAt = (clientY: number): number => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    for (let i = 0; i < els.length; i++) {
      const r = els[i]!.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return els.length;
  };
  const onGripDown = (e: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ key, index: rows.findIndex((r) => r.key === key) });
  };
  const onGripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const index = dropIndexAt(e.clientY);
    if (index !== drag.index) setDrag({ ...drag, index });
  };
  const onGripUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const from = rows.findIndex((r) => r.key === drag.key);
    // Dropping below yourself: the gap you leave shifts the slot up by one.
    const to = drag.index > from ? drag.index - 1 : drag.index;
    if (from >= 0 && to !== from) {
      pendingFocus.current = `[data-row="${drag.key}"] .qz-lg-aqgrip`;
      moveTo(drag.key, to);
    }
    setDrag(null);
  };

  const handleAdd = () => {
    if (!canAdd) return;
    onSubmit({
      text: title.trim(),
      question_type: qtype,
      answers: isFive ? ["1", "2", "3", "4", "5"] : filledRows.map((r) => r.text.trim()),
      ...(isFive ? { scale_config: { min: 1, max: 5 } } : {}),
    });
  };

  const dragFrom = drag ? rows.findIndex((r) => r.key === drag.key) : -1;
  const lineAt = drag && drag.index !== dragFrom && drag.index !== dragFrom + 1 ? drag.index : null;

  return (
    <QzModal
      open
      onClose={onClose}
      title={COPY.title}
      width={620}
      className="qz-lg-aqbox"
      draftSafe
      lockScroll
      initialFocusRef={titleRef}
      footer={
        <div className="qz-lg-aqfoot">
          <span className="qz-lg-aqsum">
            Adds <b>Q{nextNumber}</b> with {answerCount} {answerCount === 1 ? "answer" : "answers"}
          </span>
          <span className="qz-lg-aqsp" />
          <button type="button" className="qz-lg-btn" onClick={onClose}>
            {COPY.cancel}
          </button>
          <button type="button" className="qz-lg-btn is-pri" disabled={!canAdd} onClick={handleAdd}>
            {COPY.add}
          </button>
        </div>
      }
    >
      <div className="qz-lg-aqbands">
        {/* ── band 1: Type ── */}
        <section className="qz-lg-aqband">
          <div className="qz-lg-aqbh">
            <span className="qz-lg-aqbn">1</span>
            <span className="qz-lg-aqbt">{COPY.bandType}</span>
          </div>
          <div className="qz-lg-aqtgrid">
            {COPY.types.map((t) => (
              <button
                key={t.type}
                type="button"
                className={`qz-lg-aqt${qtype === t.type ? " is-on" : ""}`}
                aria-pressed={qtype === t.type}
                onClick={() => setQtype(t.type)}
              >
                <span className="qz-lg-aqtn">{t.name}</span>
                <span className="qz-lg-aqtd">{t.hint}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── band 2: Question ── */}
        <section className="qz-lg-aqband">
          <div className="qz-lg-aqbh">
            <span className="qz-lg-aqbn">2</span>
            <span className="qz-lg-aqbt">{COPY.bandQuestion}</span>
          </div>
          <input
            ref={titleRef}
            className="qz-lg-aqfi"
            value={title}
            maxLength={150}
            placeholder={COPY.placeholder}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Question"
          />
        </section>

        {/* ── band 3: Answers ── */}
        <section className="qz-lg-aqband">
          <div className="qz-lg-aqbh">
            <span className="qz-lg-aqbn">3</span>
            <span className="qz-lg-aqbt">{COPY.bandAnswers}</span>
            {!isFive ? (
              <span className="qz-lg-aqbhint" aria-live="polite" data-testid="adq-hint">
                {COPY.hint(filledRows.length)}
              </span>
            ) : null}
          </div>
          {isFive ? (
            <p className="qz-lg-aqnote">{COPY.fiveNote}</p>
          ) : (
            <div className="qz-lg-aqlist" ref={listRef}>
              {rows.map((r, i) => (
                <div
                  key={r.key}
                  data-row={r.key}
                  className={`qz-lg-aqrow${drag?.key === r.key ? " is-dragging" : ""}${
                    lineAt === i ? " is-drop-before" : ""
                  }${lineAt === rows.length && i === rows.length - 1 ? " is-drop-after" : ""}`}
                >
                  <button
                    type="button"
                    className="qz-lg-aqgrip"
                    title={COPY.grip(i + 1)}
                    aria-label={COPY.grip(i + 1)}
                    onPointerDown={(e) => onGripDown(e, r.key)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={() => setDrag(null)}
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
                  <span className="qz-lg-aqkey">{letterKey(i)}</span>
                  <input
                    className="qz-lg-aqai"
                    value={r.text}
                    maxLength={60}
                    placeholder={COPY.answerPlaceholder}
                    aria-label={`Answer ${i + 1}`}
                    onChange={(e) => setRowText(r.key, e.target.value)}
                  />
                  <button
                    type="button"
                    className="qz-lg-aqdel"
                    aria-label={COPY.deleteAnswer(i + 1)}
                    disabled={rows.length <= 2}
                    onClick={() => removeRow(r.key)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {atCap ? (
                <p className="qz-lg-aqnote">{COPY.cap(MAX_QUESTION_ANSWERS)}</p>
              ) : (
                <button type="button" className="qz-lg-aqadd2" onClick={addRow}>
                  {COPY.addAnswer}
                </button>
              )}
              {qtype === "image_tile" ? <p className="qz-lg-aqnote">{COPY.imageNote}</p> : null}
            </div>
          )}
        </section>
      </div>
    </QzModal>
  );
}
