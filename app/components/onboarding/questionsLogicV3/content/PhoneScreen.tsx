import type { CSSProperties } from "react";
import type { Quiz as QuizDoc } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../../lib/questionOrder";
import { updateNodeData } from "../../../studio/studioDoc";
import { computeFitStep, isTitleLong } from "../fitSteps";
import { EditableText } from "./EditableText";
import { TypeChipSelector } from "./TypeChipSelector";

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
  totalQuestions,
  sectionVars,
  onCommit,
}: {
  doc: QuizDoc;
  question: OrderedQuestion;
  totalQuestions: number;
  /** The active question's section color (decider = gold), from sectionPalette. */
  sectionVars: { color: string; wash: string } | null;
  onCommit: (doc: QuizDoc) => void;
}) {
  const { node, qIndex } = question;
  const answers = node.data.answers;
  const freeform = isFreeformType(node.data.question_type);

  const setTitle = (text: string) => {
    onCommit(updateNodeData(doc, node.id, { text }));
  };
  // Mirrors AnswerRow's setText — patch ONE answer's text in the answers map.
  const setAnswerText = (answerId: string, text: string) => {
    const next = node.data.answers.map((a) => (a.id === answerId ? { ...a, text } : a));
    onCommit(updateNodeData(doc, node.id, { answers: next }));
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
      <div className="qz-s3-kickerrow">
        <span className="qz-s3-kicker">
          QUESTION {qIndex} OF {totalQuestions}
        </span>
        <TypeChipSelector doc={doc} node={node} onCommit={onCommit} />
      </div>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PhoneScreen({
  doc,
  position,
  totalQuestions,
  brandName,
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
  totalQuestions: number;
  brandName: string;
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
    <>
      <div className="qz-s3-screen-top">
        <button
          type="button"
          className="qz-s3-backpill"
          disabled={!canBack}
          onClick={onBack}
        >
          ‹ Back
        </button>
        <span className="qz-s3-brandname">{brandName}</span>
        <span className="qz-s3-progressbar" aria-hidden>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      </div>

      {position.kind === "question" ? (
        <QuestionSurface
          doc={doc}
          question={position.question}
          totalQuestions={totalQuestions}
          sectionVars={sectionVars}
          onCommit={onCommit}
        />
      ) : position.kind === "capture" ? (
        <div className="qz-s3-capture">
          <h2 className="qz-s3-qtitle">Your results are ready</h2>
          <p className="qz-s3-subtext">Where should we send your matches?</p>
          <div className="qz-s3-inputmock">you@example.com</div>
        </div>
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
