import type { OrderedQuestion } from "../../../lib/questionOrder";

/* questions-full-page mock — the left navigator: a mono FLOW kicker with the
   question count, bordered rows (number chip · 2-line clamped title · mono
   type sublabel · ↑/↓ movers), active = accent tint + inset left bar, the two
   termini (✉ Email capture · ◆ Result reveal), and the + New question /
   ▣ Question library rows. The decider's gold number chip is a DS gold moment
   and DELIBERATELY survives the mock's accent-number treatment. */

/** Canvas position sentinels for the two termini (not real node ids). */
export const CAPTURE_ID = "__capture__";
export const REVEAL_ID = "__reveal__";

const TERMINUS_TOOLTIP = "Configured in Step 4 · Results";

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
  onSelect,
  onMove,
}: {
  question: OrderedQuestion;
  isDecider: boolean;
  active: boolean;
  canUp: boolean;
  canDown: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const type = question.node.data.question_type;
  return (
    <div
      className={`qz-s3-row${active ? " is-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      title={question.node.data.text}
    >
      <span
        className={`qz-s3-numchip${isDecider ? " is-decider" : ""}`}
        title={isDecider ? "The deciding question" : undefined}
      >
        {question.qIndex}
      </span>
      <span className="qz-s3-rowmid">
        <span className="qz-s3-rowtitle">{question.node.data.text}</span>
        <span className="qz-s3-rowtype">{ROW_TYPE_LABEL[type] ?? type}</span>
      </span>
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
          ↑
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
          ↓
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
            onSelect={() => onSelect(q.node.id)}
            onMove={(dir) => onMove(q.node.id, dir)}
          />
        ))}
        {/* QZY-3 — the capture screen is a FULL step now (heading/description
            editable on the canvas, SMS + terms toggles), so its row navigates
            like any question. The reveal row navigates too (read-only mock). */}
        {captureOn ? (
          <button
            type="button"
            className={`qz-s3-row is-terminus${activeId === CAPTURE_ID ? " is-active" : ""}`}
            title="Email capture — edit its heading, description, SMS and terms on the canvas"
            onClick={() => onSelect(CAPTURE_ID)}
          >
            <span className="qz-s3-numchip is-capture" aria-hidden>
              ✉
            </span>
            <span className="qz-s3-rowtitle">Email capture</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`qz-s3-row is-terminus${activeId === REVEAL_ID ? " is-active" : ""}`}
          title={TERMINUS_TOOLTIP}
          onClick={() => onSelect(REVEAL_ID)}
        >
          <span className="qz-s3-numchip is-reveal" aria-hidden>
            ◆
          </span>
          <span className="qz-s3-rowtitle">Result reveal</span>
        </button>
      </div>

      <div className="qz-s3-railfoot">
        <button type="button" className="qz-s3-navadd" onClick={onAddQuestion}>
          + New question
        </button>
        <button type="button" className="qz-s3-navadd is-quiet" onClick={onOpenLibrary}>
          ▣ Question library
        </button>
      </div>
    </aside>
  );
}
