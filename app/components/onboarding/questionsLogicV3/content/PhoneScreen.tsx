import { useState } from "react";
import type { Quiz as QuizDoc, RecPageGlobal } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../../lib/questionOrder";
import { resolveRecPageGlobal } from "../../../../lib/recommendDecider";
import { computeFitStep, isTitleLong } from "../fitSteps";
import { EditableText } from "./EditableText";

/* questions-simple mock (AUDIT-22) — the phone SCREEN contents inside the
   brand-themed frame: one `.qz-s3-scr` column (the screen itself scrolls),
   top chrome (‹ Back pill — HIDDEN at the first step per the mock, not
   disabled · progress bar · step counter), then one of three surfaces. The
   QUESTION surface is now a pure live preview of the selected question
   (editing happens in the list): the 4-line-clamped title, the option cards
   (2-line clamp, tap moves the shopper-style preview selection — the mock
   renders the first one hot), then the Next button 20px below. Per-type
   truthfulness is kept as a functionality-preserving deviation from the
   mock's render-everything-as-cards: multi-select shows "Select up to N" +
   checkbox semantics, rating renders the scale bar with endpoint labels,
   freeform types show the input mock. No emoji anywhere (mock rule) — answer
   icon glyphs are not rendered, and the reveal card's image slot is a styled
   placeholder. The capture screen STAYS a full editable step (QZY-3 —
   heading/description/terms inline-edit + SMS/terms toggles; the list has no
   home for it), and the reveal mock stays read-only. */

export type ScreenPosition =
  | { kind: "question"; question: OrderedQuestion }
  | { kind: "capture" }
  | { kind: "reveal" };

function QuestionSurface({ question }: { question: OrderedQuestion }) {
  const { node } = question;
  const answers = node.data.answers;
  const type = node.data.question_type;
  const freeform = isFreeformType(type);
  const multi = type === "multi_select";
  const rating = type === "rating";
  const maxSelections = multi
    ? Math.max(1, Math.min(node.data.max_selections ?? answers.length, answers.length))
    : 1;

  // Shopper-style PREVIEW selection (mock opt.hot — first hot on load) —
  // local state only, never persisted. Remounts per question (key=node.id).
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
            <button
              key={a.id}
              type="button"
              className={`qz-s3-achip${isHot(i) ? " is-hot" : ""}`}
              aria-pressed={isHot(i)}
              onClick={() => toggleSel(i)}
            >
              {a.text}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      className="qz-s3-qbody"
      data-fit={computeFitStep(freeform || rating ? 0 : answers.length)}
      data-title-long={isTitleLong(node.data.text) || undefined}
    >
      {/* Mock q-scr — the plain 4-line-clamped question title (editing lives
          in the list; the clamp is in the stylesheet). */}
      <h2 className="qz-s3-qtitle">{node.data.text}</h2>
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
        <QuestionSurface key={position.question.node.id} question={position.question} />
      ) : position.kind === "capture" ? (
        <CaptureSurface doc={doc} onCommit={onCommit} />
      ) : (
        <div className="qz-s3-reveal">
          <h2 className="qz-s3-qtitle">{global?.headline || "Your perfect match"}</h2>
          <div className="qz-s3-prodcard">
            <div className="qz-s3-prodimg" aria-hidden />
            <strong className="qz-s3-prodname">Your top pick</strong>
            <p className="qz-s3-prodwhy">AI writes the “why we recommend this” at quiz time</p>
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
