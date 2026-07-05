import type { Quiz as QuizDoc } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { OrderedQuestion } from "../../questionsLogic/questionOrder";
import { computeFitStep, isTitleLong } from "../fitSteps";

/* quiz-step3 v3 §4 — the phone SCREEN contents (inside the brand-themed
   bezel): top chrome (‹ Back pill · brand line · progress bar), then one of
   three surfaces — the ACTIVE question (read-only this phase: kicker
   "QUESTION N OF T" + a static type chip + title + answer chips, all sized by
   the data-fit steps), the capture mock (email field per rec_page_settings),
   or the reveal mock (headline + a product-card placeholder). Everything
   inherits the brand CSS vars the canvas inlines on the screen div. */

export type ScreenPosition =
  | { kind: "question"; question: OrderedQuestion }
  | { kind: "capture" }
  | { kind: "reveal" };

const TYPE_CHIP_LABEL: Record<string, string> = {
  single_select: "Single select",
  multi_select: "Multi select",
  image_tile: "Image tiles",
  text: "Free text",
  email: "Email",
  searchable: "Searchable",
  image_picker: "Image picker",
  dropdown: "Dropdown",
  rating: "Rating",
  swatch: "Swatch",
  numeric: "Number",
  date: "Date",
  slider: "Slider",
};

function QuestionSurface({
  question,
  totalQuestions,
}: {
  question: OrderedQuestion;
  totalQuestions: number;
}) {
  const { node, qIndex } = question;
  const answers = node.data.answers;
  const freeform = isFreeformType(node.data.question_type);
  return (
    <div
      className="qz-s3-qbody"
      data-fit={computeFitStep(freeform ? 0 : answers.length)}
      data-title-long={isTitleLong(node.data.text) || undefined}
    >
      <div className="qz-s3-kickerrow">
        <span className="qz-s3-kicker">
          QUESTION {qIndex} OF {totalQuestions}
        </span>
        {/* Static type chip — the TypeChipSelector lands in P2. */}
        <span className="qz-s3-typechip">
          {TYPE_CHIP_LABEL[node.data.question_type] ?? node.data.question_type}
        </span>
      </div>
      <h2 className="qz-s3-qtitle">{node.data.text}</h2>
      {freeform ? (
        <div className="qz-s3-inputmock">
          {node.data.input_config?.placeholder || "Type your answer…"}
        </div>
      ) : (
        <div className="qz-s3-achips">
          {answers.map((a) => (
            <div key={a.id} className="qz-s3-achip">
              {a.icon ? <span aria-hidden>{a.icon} </span> : null}
              {a.text}
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
        <QuestionSurface question={position.question} totalQuestions={totalQuestions} />
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
