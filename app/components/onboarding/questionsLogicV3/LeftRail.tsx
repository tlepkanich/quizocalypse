import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { Step3View } from "./Step3Shell";

/* quiz-step3 v3 §3 — the left flow rail: view toggle on top (✎ Content ·
   λ Logic, gold-wash active), simplified flow rows (26px mono number chip —
   the DECIDER's chip is solid gold with a light numeral — + a 2-line-clamped
   title), a 1.5px vertical connector behind the chips, the two read-only
   termini (✉ Email capture · ◆ Result reveal, "Configured in Step 4 ·
   Results"), and the + New question / ▣ Question library footer. */

/** Canvas position sentinels for the two termini (not real node ids). */
export const CAPTURE_ID = "__capture__";
export const REVEAL_ID = "__reveal__";

const TERMINUS_TOOLTIP = "Configured in Step 4 · Results";

function FlowRow({
  question,
  isDecider,
  active,
  onSelect,
}: {
  question: OrderedQuestion;
  isDecider: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`qz-s3-row${active ? " is-active" : ""}`}
      onClick={onSelect}
      title={question.node.data.text}
    >
      <span
        className={`qz-s3-numchip${isDecider ? " is-decider" : ""}`}
        title={isDecider ? "The deciding question" : undefined}
      >
        {question.qIndex}
      </span>
      <span className="qz-s3-rowtitle">{question.node.data.text}</span>
    </button>
  );
}

export function LeftRail({
  questions,
  deciderId,
  activeId,
  view,
  captureOn,
  onViewChange,
  onSelect,
  onAddQuestion,
  onOpenLibrary,
}: {
  questions: OrderedQuestion[];
  deciderId: string | null;
  activeId: string;
  view: Step3View;
  /** Mirrors the phone walk: the ✉ row renders only when the capture screen exists. */
  captureOn: boolean;
  onViewChange: (view: Step3View) => void;
  onSelect: (id: string) => void;
  onAddQuestion: () => void;
  onOpenLibrary: () => void;
}) {
  return (
    <aside className="qz-s3-rail">
      <div className="qz-s3-viewtoggle" role="group" aria-label="Content or Logic view">
        <button
          type="button"
          aria-pressed={view === "content"}
          onClick={() => onViewChange("content")}
        >
          ✎ Content
        </button>
        <button
          type="button"
          aria-pressed={view === "logic"}
          onClick={() => onViewChange("logic")}
        >
          λ Logic
        </button>
      </div>

      <div className="qz-s3-flow" aria-label="Quiz flow">
        {questions.map((q) => (
          <FlowRow
            key={q.node.id}
            question={q}
            isDecider={q.node.id === deciderId}
            active={activeId === q.node.id}
            onSelect={() => onSelect(q.node.id)}
          />
        ))}
        {captureOn ? (
          <div
            className={`qz-s3-row is-terminus${activeId === CAPTURE_ID ? " is-active" : ""}`}
            title={TERMINUS_TOOLTIP}
          >
            <span className="qz-s3-numchip is-capture" aria-hidden>
              ✉
            </span>
            <span className="qz-s3-rowtitle">Email capture</span>
          </div>
        ) : null}
        <div
          className={`qz-s3-row is-terminus${activeId === REVEAL_ID ? " is-active" : ""}`}
          title={TERMINUS_TOOLTIP}
        >
          <span className="qz-s3-numchip is-reveal" aria-hidden>
            ◆
          </span>
          <span className="qz-s3-rowtitle">Result reveal</span>
        </div>
      </div>

      <div className="qz-s3-railfoot">
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onAddQuestion}>
          + New question
        </button>
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onOpenLibrary}>
          ▣ Question library
        </button>
      </div>
    </aside>
  );
}
