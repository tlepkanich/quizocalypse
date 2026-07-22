import type { CSSProperties } from "react";
import type { Quiz as QuizDoc, RecPageGlobal } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../../lib/questionOrder";
import { updateNodeData } from "../../../studio/studioDoc";
import { insertQuestionRelative, removeAnswer } from "../../../../lib/quizMutations";
import { resolveRecPageGlobal } from "../../../../lib/recommendDecider";
import { computeFitStep, isTitleLong } from "../fitSteps";
import { EditableText } from "./EditableText";

/* quiz-step3 v3 §4 — the phone SCREEN contents (inside the brand-themed
   bezel): top chrome (‹ Back pill · brand line · progress bar), then one of
   three surfaces — the ACTIVE question (P2: title + answers are inline-
   editable through EditableText, the kicker's type chip is a dropdown that
   intercepts type changes with the block/reset dialogs), the capture mock
   (read-only — configured in Step 4), or the reveal mock (read-only).
   Everything inherits the brand CSS vars the canvas inlines on the screen
   div; the question wrapper additionally carries --sec-color/--sec-wash
   (the active question's section color — decider gold) which the editable
   hover/focus treatment reads. */

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
  onNavigate,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  /** The active question's section color (decider = gold), from sectionPalette. */
  sectionVars: { color: string; wash: string } | null;
  onCommit: (doc: QuizDoc) => void;
  /** QZY-3 — "+ Add question" selects the freshly inserted screen. */
  onNavigate: (id: string) => void;
}) {
  const { node, qIndex } = question;
  const answers = node.data.answers;
  const freeform = isFreeformType(node.data.question_type);
  const canDeleteAnswer = answers.length > 2; // card types must keep ≥2

  const setTitle = (text: string) => {
    onCommit(updateNodeData(doc, node.id, { text }));
  };
  // Mirrors AnswerRow's setText — patch ONE answer's text in the answers map.
  const setAnswerText = (answerId: string, text: string) => {
    const next = node.data.answers.map((a) => (a.id === answerId ? { ...a, text } : a));
    onCommit(updateNodeData(doc, node.id, { answers: next }));
  };
  // QZY-3 (owner supplement) — tap-to-delete an answer ON the phone. The
  // mutation prunes the answer's route edge and refuses below the ≥2 floor.
  const deleteAnswer = (answerId: string) => {
    onCommit(removeAnswer(doc, node.id, answerId));
  };
  // QZY-3 — "+ Add question" under the final answer inserts BELOW this
  // question (the add-anchor lesson: relative to a movable step, never the
  // terminal) and jumps the canvas to it.
  const addQuestionBelow = () => {
    const before = new Set(doc.nodes.map((n) => n.id));
    const next = insertQuestionRelative(doc, node.id, "below");
    const newId = next.nodes.find((n) => !before.has(n.id))?.id ?? null;
    onCommit(next);
    if (newId) onNavigate(newId);
  };

  return (
    <div
      className="qz-s3-qbody"
      data-fit={computeFitStep(freeform ? 0 : answers.length)}
      data-title-long={isTitleLong(node.data.text) || undefined}
      style={
        sectionVars
          ? ({ "--sec-color": sectionVars.color, "--sec-wash": sectionVars.wash } as CSSProperties)
          : undefined
      }
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
      {freeform ? (
        <div className="qz-s3-inputmock">
          {node.data.input_config?.placeholder || "Type your answer…"}
        </div>
      ) : (
        <div className="qz-s3-achips">
          {answers.map((a, i) => (
            <div key={a.id} className="qz-s3-achip">
              {a.icon ? <span aria-hidden>{a.icon} </span> : null}
              <EditableText
                value={a.text}
                onCommit={(text) => setAnswerText(a.id, text)}
                maxLength={ANSWER_MAX}
                ariaLabel={`Answer ${i + 1} text`}
              />
              <button
                type="button"
                className="qz-s3-achip-del"
                disabled={!canDeleteAnswer}
                aria-label={`Delete answer “${a.text}”`}
                title={
                  canDeleteAnswer
                    ? "Delete this answer (its mapping and routing go with it)"
                    : "Questions need at least 2 answers"
                }
                onClick={() => deleteAnswer(a.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="qz-s3-addq"
        onClick={addQuestionBelow}
        title="Insert a new question right after this one"
      >
        + Add question
      </button>
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
  onNavigate,
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
  /** QZY-3 — canvas jumps (the "+ Add question" affordance). */
  onNavigate: (id: string) => void;
}) {
  const global = doc.rec_page_settings?.global;
  return (
    <>
      {/* Mock top bar: back · full-width progress · step counter. */}
      <div className="qz-s3-screen-top">
        <button
          type="button"
          className="qz-s3-backpill"
          disabled={!canBack}
          onClick={onBack}
        >
          ‹ Back
        </button>
        <span className="qz-s3-progressbar" aria-hidden>
          <span style={{ transform: `scaleX(${progress})` }} />
        </span>
        <span className="qz-s3-kicker">{stepLabel}</span>
      </div>

      {position.kind === "question" ? (
        <QuestionSurface
          doc={doc}
          question={position.question}
          sectionVars={sectionVars}
          onCommit={onCommit}
          onNavigate={onNavigate}
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
    </>
  );
}
