import { useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent } from "react";
import type { Quiz as QuizDoc, RecPageGlobal } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../../lib/questionOrder";
import { updateNodeData } from "../../../studio/studioDoc";
import { addAnswer, moveAnswer, removeAnswer } from "../../../../lib/quizMutations";
import { resolveRecPageGlobal } from "../../../../lib/recommendDecider";
import { computeFitStep, isTitleLong } from "../fitSteps";
import { IconDots, IconGrip, IconTrash } from "../icons";
import { EditableText } from "./EditableText";

/* questions-full-page mock (AUDIT-17) — the phone SCREEN contents inside the
   brand-themed frame: one `.qz-s3-scr` column (mock scr — the Next button
   rides min-height:100% to the bottom, the screen itself scrolls), top chrome
   (‹ Back pill — HIDDEN at the first step per the mock, not disabled ·
   progress bar · step counter), then one of three surfaces — the ACTIVE
   question (title + answers inline-editable through EditableText; answer rows
   carry the mock's ⠿ drag handle (drag-to-reorder via the pure moveAnswer
   mutation), a radio/checkbox selection indicator with a shopper-style
   preview selection, and a ⋯ kebab menu with Delete answer; a "+ Add answer"
   dashed row follows; multi-select shows "Select up to N"; rating renders the
   mock's scale bar with endpoint labels), the capture mock, or the reveal
   mock. Everything inherits the brand CSS vars the canvas inlines on the
   screen div; the question wrapper additionally carries --sec-color/
   --sec-wash (the active question's section color — decider gold) which the
   editable hover/focus treatment reads. */

export type ScreenPosition =
  | { kind: "question"; question: OrderedQuestion }
  | { kind: "capture" }
  | { kind: "reveal" };

// The legacy Step-3 editor's caps (QuestionCard TEXT_MAX / AnswerRow ANSWER_MAX).
const TEXT_MAX = 150;
const ANSWER_MAX = 60;

function QuestionSurface({
  doc,
  question,
  sectionVars,
  onCommit,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  /** The active question's section color (decider = gold), from sectionPalette. */
  sectionVars: { color: string; wash: string } | null;
  onCommit: (doc: QuizDoc) => void;
}) {
  const { node, qIndex } = question;
  const answers = node.data.answers;
  const type = node.data.question_type;
  const freeform = isFreeformType(type);
  const multi = type === "multi_select";
  const rating = type === "rating";
  const canDeleteAnswer = answers.length > 2; // card types must keep ≥2
  const maxSelections = multi
    ? Math.max(1, Math.min(node.data.max_selections ?? answers.length, answers.length))
    : 1;

  // Shopper-style PREVIEW selection (mock opt.hot / sb-n.on) — local state
  // only, never persisted. The surface remounts per question (key=node.id).
  const [singleSel, setSingleSel] = useState(0);
  const [multiSel, setMultiSel] = useState<number[]>([0]);
  const isHot = (i: number) => (multi ? multiSel.includes(i) : singleSel === i);
  const toggleSel = (i: number) => {
    if (multi) {
      setMultiSel((arr) => {
        if (arr.includes(i)) return arr.filter((x) => x !== i);
        if (arr.length >= maxSelections) return arr;
        return [...arr, i];
      });
    } else {
      setSingleSel(i);
    }
  };

  // ⋯ kebab menu (mock omore/omenu) — one open at a time.
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // ⠿ drag-to-reorder (mock odrag + drop-hi). The row is draggable only while
  // the pointer is DOWN on the grip, so inline text editing never starts an
  // element drag (functionality-preserving deviation from the mock's
  // always-draggable rows).
  const [dragArmed, setDragArmed] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const endDrag = () => {
    dragFrom.current = null;
    setDragArmed(null);
    setDropIdx(null);
  };

  const setTitle = (text: string) => {
    onCommit(updateNodeData(doc, node.id, { text }));
  };
  // Mirrors AnswerRow's setText — patch ONE answer's text in the answers map.
  const setAnswerText = (answerId: string, text: string) => {
    const next = node.data.answers.map((a) => (a.id === answerId ? { ...a, text } : a));
    onCommit(updateNodeData(doc, node.id, { answers: next }));
  };
  // Tap-to-delete an answer ON the phone (mock omenu → Delete answer). The
  // mutation prunes the answer's route edge and refuses below the ≥2 floor.
  const deleteAnswer = (answerId: string) => {
    onCommit(removeAnswer(doc, node.id, answerId));
    setSingleSel(0);
    setMultiSel([0]);
  };

  const onRowClick = (e: MouseEvent<HTMLDivElement>, i: number) => {
    const t = e.target as HTMLElement;
    if (t.closest(".qz-s3-editable, .qz-s3-omore, .qz-s3-omenu, .qz-s3-odrag")) return;
    toggleSel(i);
  };
  const onRowDragStart = (e: DragEvent<HTMLDivElement>, i: number) => {
    dragFrom.current = i;
    e.dataTransfer.effectAllowed = "move";
  };
  const onRowDragOver = (e: DragEvent<HTMLDivElement>, i: number) => {
    if (dragFrom.current === null) return;
    e.preventDefault();
    setDropIdx(i);
  };
  const onRowDrop = (e: DragEvent<HTMLDivElement>, i: number) => {
    e.preventDefault();
    const from = dragFrom.current;
    if (from !== null && from !== i) {
      const moving = answers[from];
      if (moving) onCommit(moveAnswer(doc, node.id, moving.id, i));
    }
    endDrag();
  };

  const scale = node.data.scale_config;
  const scaleLow = scale?.endpoint_label_min || "1";
  const scaleHigh = scale?.endpoint_label_max || String(answers.length);
  const scaleFill =
    answers.length > 1 ? (singleSel / (answers.length - 1)) * 100 : 0;

  let body;
  if (freeform) {
    body = (
      <div className="qz-s3-inputmock">
        {node.data.input_config?.placeholder || "Type your answer…"}
      </div>
    );
  } else if (rating) {
    // Mock scalebar — every point is a REAL answer (mappings ride on them);
    // endpoint labels come from scale_config.
    body = (
      <>
        <p className="qz-s3-subcap">Slide or tap where you land.</p>
        <div className="qz-s3-scalebar">
          <div className="qz-s3-sbtrack" aria-hidden>
            <span style={{ width: `${scaleFill.toFixed(1)}%` }} />
          </div>
          <div className="qz-s3-sbnums">
            {answers.map((a, i) => (
              <button
                key={a.id}
                type="button"
                className={`qz-s3-sbn${singleSel === i ? " is-on" : ""}`}
                aria-pressed={singleSel === i}
                aria-label={`Scale point ${i + 1}`}
                onClick={() => setSingleSel(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
        <div className="qz-s3-scalelab" aria-hidden>
          <span>{scaleLow}</span>
          <span>{scaleHigh}</span>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {multi ? <p className="qz-s3-subcap">Select up to {maxSelections}</p> : null}
        <div className="qz-s3-achips">
          {answers.map((a, i) => (
            <div
              key={a.id}
              className={`qz-s3-achip${isHot(i) ? " is-hot" : ""}${dropIdx === i ? " is-drophi" : ""}`}
              draggable={dragArmed === a.id}
              onClick={(e) => onRowClick(e, i)}
              onDragStart={(e) => onRowDragStart(e, i)}
              onDragEnd={endDrag}
              onDragOver={(e) => onRowDragOver(e, i)}
              onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
              onDrop={(e) => onRowDrop(e, i)}
            >
              <span
                className="qz-s3-odrag"
                title="Drag to reorder"
                onPointerDown={() => setDragArmed(a.id)}
                onPointerUp={() => setDragArmed(null)}
              >
                <IconGrip />
              </span>
              <span className={multi ? "qz-s3-obox" : "qz-s3-oradio"} aria-hidden />
              {a.icon ? <span aria-hidden>{a.icon} </span> : null}
              <span className="qz-s3-otext">
                <EditableText
                  value={a.text}
                  onCommit={(text) => setAnswerText(a.id, text)}
                  maxLength={ANSWER_MAX}
                  ariaLabel={`Answer ${i + 1} text`}
                />
              </span>
              <button
                type="button"
                className="qz-s3-omore"
                aria-haspopup="menu"
                aria-expanded={menuFor === a.id}
                aria-label={`Answer ${i + 1} options`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor((m) => (m === a.id ? null : a.id));
                }}
              >
                <IconDots />
              </button>
              {menuFor === a.id ? (
                <span className="qz-s3-omenu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="qz-s3-omdel"
                    disabled={!canDeleteAnswer}
                    title={
                      canDeleteAnswer
                        ? "Delete this answer (its mapping and routing go with it)"
                        : "Questions need at least 2 answers"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(null);
                      if (canDeleteAnswer) deleteAnswer(a.id);
                    }}
                  >
                    <IconTrash /> Delete answer
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="qz-s3-addopt"
          title="Add an answer to this question"
          onClick={() => onCommit(addAnswer(doc, node.id))}
        >
          + Add answer
        </button>
      </>
    );
  }

  return (
    <div
      className="qz-s3-qbody"
      data-fit={computeFitStep(freeform || rating ? 0 : answers.length)}
      data-title-long={isTitleLong(node.data.text) || undefined}
      style={
        sectionVars
          ? ({ "--sec-color": sectionVars.color, "--sec-wash": sectionVars.wash } as CSSProperties)
          : undefined
      }
      onClick={(e) => {
        // Any click outside a kebab closes the open answer menu (mock).
        const t = e.target as HTMLElement;
        if (!t.closest(".qz-s3-omore, .qz-s3-omenu")) setMenuFor(null);
      }}
    >
      {/* questions-full-page mock — the type moved OUT of the phone (the
          floating tag beside the frame); the step counter lives in the top
          bar. No in-phone kicker row. */}
      <h2 className="qz-s3-qtitle">
        <EditableText
          value={node.data.text}
          onCommit={setTitle}
          maxLength={TEXT_MAX}
          ariaLabel={`Question ${qIndex} text`}
        />
      </h2>
      {body}
    </div>
  );
}

// QZY-3 (owner supplement) — the capture screen as a FULL editable step:
// heading + description inline-edit (stored on rec_page_settings.global;
// absent = the locale-aware chrome copy), input mocks per capture option,
// and two toggles — SMS collection (capturePhone) and a terms & conditions
// checkbox with editable consent text.
function CaptureSurface({
  doc,
  onCommit,
}: {
  doc: QuizDoc;
  onCommit: (doc: QuizDoc) => void;
}) {
  const cfg = resolveRecPageGlobal(doc.rec_page_settings);
  const patch = (p: Partial<RecPageGlobal>) =>
    onCommit({
      ...doc,
      rec_page_settings: {
        global: { ...(doc.rec_page_settings?.global ?? {}), ...p },
        overrides: doc.rec_page_settings?.overrides ?? {},
      },
    });
  return (
    <div className="qz-s3-capture">
      <h2 className="qz-s3-qtitle">
        <EditableText
          value={cfg.captureHeadline || "Your results are ready"}
          onCommit={(t) => patch({ captureHeadline: t })}
          maxLength={80}
          ariaLabel="Capture screen heading"
        />
      </h2>
      <p className="qz-s3-subtext">
        <EditableText
          value={cfg.captureSubtext || "Where should we send your matches?"}
          onCommit={(t) => patch({ captureSubtext: t })}
          maxLength={140}
          ariaLabel="Capture screen description"
        />
      </p>
      {cfg.captureEmail ? <div className="qz-s3-inputmock">you@example.com</div> : null}
      {cfg.captureName ? <div className="qz-s3-inputmock">First name</div> : null}
      {cfg.capturePhone ? <div className="qz-s3-inputmock">Phone number (SMS)</div> : null}
      {cfg.captureTermsOn ? (
        <label className="qz-s3-termsmock">
          <input type="checkbox" disabled readOnly checked={false} aria-hidden />
          <EditableText
            value={
              cfg.captureTermsText ||
              "I agree to receive marketing messages and accept the terms & conditions."
            }
            onCommit={(t) => patch({ captureTermsText: t })}
            maxLength={200}
            ariaLabel="Terms & conditions text"
          />
        </label>
      ) : null}
      <div className="qz-s3-capttoggles">
        <button
          type="button"
          className={`qz-s3-capttoggle${cfg.capturePhone ? " is-on" : ""}`}
          aria-pressed={cfg.capturePhone}
          onClick={() => patch({ capturePhone: !cfg.capturePhone })}
        >
          {cfg.capturePhone ? "✓" : "+"} SMS collection
        </button>
        <button
          type="button"
          className={`qz-s3-capttoggle${cfg.captureTermsOn ? " is-on" : ""}`}
          aria-pressed={cfg.captureTermsOn}
          onClick={() => patch({ captureTermsOn: !cfg.captureTermsOn })}
        >
          {cfg.captureTermsOn ? "✓" : "+"} Terms checkbox
        </button>
      </div>
    </div>
  );
}

export function PhoneScreen({
  doc,
  position,
  stepLabel,
  progress,
  canBack,
  onBack,
  onNext,
  onRestart,
  ctaText,
  sectionVars,
  onCommit,
}: {
  doc: QuizDoc;
  position: ScreenPosition;
  /** The top-bar step counter, e.g. "1/7" (mock stepn). */
  stepLabel: string;
  /** 0..1 fill of the top progress bar. */
  progress: number;
  canBack: boolean;
  onBack: () => void;
  onNext: () => void;
  onRestart: () => void;
  /** Contrast-safe label color on the brand primary (the runtime's rule). */
  ctaText: string;
  /** Active question's section color vars (null on the termini). */
  sectionVars: { color: string; wash: string } | null;
  onCommit: (doc: QuizDoc) => void;
}) {
  const global = doc.rec_page_settings?.global;
  return (
    <div className="qz-s3-scr">
      {/* Mock top bar: back (hidden at the first step) · progress · counter. */}
      <div className="qz-s3-screen-top">
        {canBack ? (
          <button type="button" className="qz-s3-backpill" onClick={onBack}>
            ‹ Back
          </button>
        ) : null}
        <span className="qz-s3-progressbar" aria-hidden>
          <span style={{ transform: `scaleX(${progress})` }} />
        </span>
        <span className="qz-s3-kicker">{stepLabel}</span>
      </div>

      {position.kind === "question" ? (
        <QuestionSurface
          key={position.question.node.id}
          doc={doc}
          question={position.question}
          sectionVars={sectionVars}
          onCommit={onCommit}
        />
      ) : position.kind === "capture" ? (
        <CaptureSurface doc={doc} onCommit={onCommit} />
      ) : (
        <div className="qz-s3-reveal">
          <h2 className="qz-s3-qtitle">{global?.headline || "Your perfect match"}</h2>
          <div className="qz-s3-prodcard">
            <div className="qz-s3-prodimg" aria-hidden>
              📦
            </div>
            <strong className="qz-s3-prodname">Your top pick</strong>
            <p className="qz-s3-prodwhy">✦ AI writes the “why we recommend this” at quiz time</p>
            <div className="qz-s3-prodrow">
              <span className="qz-s3-prodprice">$—</span>
              <span className="qz-s3-prodcta" style={{ color: ctaText }}>
                Add to cart
              </span>
            </div>
          </div>
        </div>
      )}

      {position.kind === "reveal" ? (
        <button type="button" className="qz-s3-next is-restart" onClick={onRestart}>
          ↺ Start over
        </button>
      ) : (
        <button
          type="button"
          className="qz-s3-next"
          style={{ color: ctaText }}
          onClick={onNext}
        >
          {position.kind === "capture" ? "Continue" : "Next"}
        </button>
      )}
    </div>
  );
}
