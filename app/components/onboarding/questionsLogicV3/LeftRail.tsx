import { useState } from "react";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { EditableText } from "./content/EditableText";
import { IconDown, IconMail, IconTarget, IconTrash, IconUp } from "./icons";

/* questions-full-page mock (AUDIT-8 + AUDIT-17) — the left navigator: a mono
   FLOW kicker with the question count, bordered rows (click-to-renumber number
   chip · inline-editable 2-line clamped title · mono type sublabel · hover ✕
   delete · ↑/↓ movers), active = accent tint + inset left bar, then the mock's
   footer order: + New question · ▣ Question library · the two termini rows
   (✉ Email capture · ◎ Result reveal, mock .navterm styling). The decider's
   gold number chip is a DS gold moment and DELIBERATELY survives the mock's
   accent-number treatment; the termini stay clickable (they are real canvas
   positions here — a functionality-preserving deviation from the mock's inert
   navterm rows). */

/** Canvas position sentinels for the two termini (not real node ids). */
export const CAPTURE_ID = "__capture__";
export const REVEAL_ID = "__reveal__";

const TERMINUS_TOOLTIP = "Configured in Step 4 · Results";
const TEXT_MAX = 150; // the shared question-text cap (PhoneScreen TEXT_MAX)

/** Quiet mono sublabel per stored type (the mock's row type line). */
const ROW_TYPE_LABEL: Record<string, string> = {
  single_select: "Single select",
  multi_select: "Multi select",
  image_tile: "Image select",
  text: "Open text",
  email: "Email input",
  searchable: "Searchable list",
  image_picker: "Image grid",
  dropdown: "Dropdown",
  rating: "Scale",
  swatch: "Swatch picker",
  numeric: "Number input",
  date: "Date input",
  slider: "Slider",
};

function FlowRow({
  question,
  isDecider,
  active,
  canUp,
  canDown,
  canDelete,
  onSelect,
  onMove,
  onRename,
  onRenumber,
  onDelete,
}: {
  question: OrderedQuestion;
  isDecider: boolean;
  active: boolean;
  canUp: boolean;
  canDown: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onRename: (text: string) => void;
  onRenumber: (ordinal: number) => void;
  onDelete: () => void;
}) {
  const type = question.node.data.question_type;
  // Mock ncn-edit — the number chip flips to a tiny number input; Enter/blur
  // commits (move-to-ordinal), Escape cancels.
  const [renumbering, setRenumbering] = useState(false);
  const commitOrdinal = (raw: string, ok: boolean) => {
    setRenumbering(false);
    if (!ok) return;
    const v = Number.parseInt(raw, 10);
    if (!Number.isNaN(v)) onRenumber(v);
  };
  return (
    <div
      className={`qz-s3-row${active ? " is-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        // Only the row itself — keys inside the editable title/number input
        // must not steal focus or spaces.
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      title={question.node.data.text}
    >
      {renumbering ? (
        <span className={`qz-s3-numchip${isDecider ? " is-decider" : ""}`}>
          <input
            className="qz-s3-ncninput"
            type="number"
            min={1}
            defaultValue={question.qIndex}
            autoFocus
            aria-label="Move this question to position"
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitOrdinal(e.currentTarget.value, true);
              } else if (e.key === "Escape") {
                commitOrdinal("", false);
              }
            }}
            onBlur={(e) => commitOrdinal(e.currentTarget.value, true)}
          />
        </span>
      ) : (
        <button
          type="button"
          className={`qz-s3-numchip is-edit${isDecider ? " is-decider" : ""}`}
          title={
            isDecider
              ? "The deciding question — click to renumber (moves it to that spot)"
              : "Click to renumber — moves this question to that spot"
          }
          onClick={(e) => {
            e.stopPropagation();
            setRenumbering(true);
          }}
        >
          {question.qIndex}
        </button>
      )}
      <span className="qz-s3-rowmid">
        <span className="qz-s3-rowtitle">
          <EditableText
            value={question.node.data.text}
            onCommit={onRename}
            maxLength={TEXT_MAX}
            ariaLabel={`Question ${question.qIndex} title`}
            className="qz-s3-navedit"
          />
        </span>
        <span className="qz-s3-rowtype">{ROW_TYPE_LABEL[type] ?? type}</span>
      </span>
      <button
        type="button"
        className="qz-s3-ndel"
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
          onDelete();
        }}
      >
        <IconTrash />
      </button>
      <span className="qz-s3-mv">
        <button
          type="button"
          className="qz-s3-mvb"
          disabled={!canUp}
          aria-label="Move up"
          onClick={(e) => {
            e.stopPropagation();
            onMove(-1);
          }}
        >
          <IconUp />
        </button>
        <button
          type="button"
          className="qz-s3-mvb"
          disabled={!canDown}
          aria-label="Move down"
          onClick={(e) => {
            e.stopPropagation();
            onMove(1);
          }}
        >
          <IconDown />
        </button>
      </span>
    </div>
  );
}

export function LeftRail({
  questions,
  deciderId,
  activeId,
  captureOn,
  onSelect,
  onMove,
  onRename,
  onRenumber,
  onDelete,
  onAddQuestion,
  onOpenLibrary,
}: {
  questions: OrderedQuestion[];
  deciderId: string | null;
  activeId: string;
  /** Mirrors the phone walk: the ✉ row renders only when the capture screen exists. */
  captureOn: boolean;
  onSelect: (id: string) => void;
  /** Mock ↑/↓ movers — reorders via the pure moveStep mutation (shell-owned). */
  onMove: (id: string, dir: -1 | 1) => void;
  /** Mock inline nav title edit (contenteditable ncq). */
  onRename: (id: string, text: string) => void;
  /** Mock click-to-renumber — move the question to the 1-based ordinal. */
  onRenumber: (id: string, ordinal: number) => void;
  /** Mock hover ✕ delete (shell confirms + deletes via deleteNode). */
  onDelete: (id: string) => void;
  onAddQuestion: () => void;
  onOpenLibrary: () => void;
}) {
  return (
    <aside className="qz-s3-rail">
      <div className="qz-s3-navhd">
        Flow · {questions.length} question{questions.length === 1 ? "" : "s"}
      </div>
      <div className="qz-s3-flow" aria-label="Quiz flow">
        {questions.map((q, i) => (
          <FlowRow
            key={q.node.id}
            question={q}
            isDecider={q.node.id === deciderId}
            active={activeId === q.node.id}
            canUp={i > 0}
            canDown={i < questions.length - 1}
            canDelete={questions.length > 1 && q.node.id !== deciderId}
            onSelect={() => onSelect(q.node.id)}
            onMove={(dir) => onMove(q.node.id, dir)}
            onRename={(text) => onRename(q.node.id, text)}
            onRenumber={(ord) => onRenumber(q.node.id, ord)}
            onDelete={() => onDelete(q.node.id)}
          />
        ))}
        <button type="button" className="qz-s3-navadd" onClick={onAddQuestion}>
          + New question
        </button>
        <button type="button" className="qz-s3-navadd is-quiet" onClick={onOpenLibrary}>
          ▣ Question library
        </button>
        {/* QZY-3 — the capture screen is a FULL step (heading/description
            editable on the canvas, SMS + terms toggles), so its row navigates
            like any question. The reveal row navigates too (read-only mock). */}
        {captureOn ? (
          <button
            type="button"
            className={`qz-s3-navterm${activeId === CAPTURE_ID ? " is-active" : ""}`}
            title="Email capture — edit its heading, description, SMS and terms on the canvas"
            onClick={() => onSelect(CAPTURE_ID)}
          >
            <span className="qz-s3-navterm-tc" aria-hidden>
              <IconMail />
            </span>
            <span>Email capture</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`qz-s3-navterm${activeId === REVEAL_ID ? " is-active" : ""}`}
          title={TERMINUS_TOOLTIP}
          onClick={() => onSelect(REVEAL_ID)}
        >
          <span className="qz-s3-navterm-tc" aria-hidden>
            <IconTarget />
          </span>
          <span>Result reveal</span>
        </button>
      </div>
    </aside>
  );
}
