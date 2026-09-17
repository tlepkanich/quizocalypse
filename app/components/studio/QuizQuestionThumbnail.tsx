import type { CSSProperties } from "react";
import type { QuizCardThumb } from "../../lib/quizLibraryCard";
import { isFreeformType } from "../../lib/quizSchema";

/** A static content sample, never a live quiz or a simulated recommendation. */
export function QuizQuestionThumbnail({ thumb }: { thumb: QuizCardThumb }) {
  const q = thumb.question;
  if (!q) return null;
  const freeform = isFreeformType(q.type);
  return (
    <div
      className="qz-question-thumb"
      aria-hidden
      style={{
        background: thumb.bg,
        color: thumb.text,
        "--thumb-primary": thumb.primary,
        ...(thumb.font ? { fontFamily: thumb.font } : {}),
      } as CSSProperties}
    >
      <div className="qz-question-thumb-top">
        {thumb.logoUrl ? <img src={thumb.logoUrl} alt="" loading="lazy" /> : null}
        <span>Question preview</span>
      </div>
      <div className="qz-question-thumb-content">
        {q.imageUrl ? <img className="qz-question-thumb-image" src={q.imageUrl} alt="" loading="lazy" /> : null}
        <div className="qz-question-thumb-main">
          <div className="qz-question-thumb-title">{q.text}</div>
          {q.type === "slider" ? (
            <div className="qz-question-thumb-slider"><span /></div>
          ) : freeform || q.type === "dropdown" ? (
            <div className="qz-question-thumb-input">
              {q.placeholder || (q.type === "dropdown" ? "Select an answer" : q.type === "date" ? "Select a date" : q.type === "numeric" ? "Enter a number" : q.type === "email" ? "Your email address" : "Your answer")}
              {q.type === "dropdown" ? <span>⌄</span> : null}
            </div>
          ) : (
            <div className={`qz-question-thumb-answers${q.tiles ? " is-tiles" : ""}`}>
              {q.answers.map((a, i) => (
                <div className="qz-question-thumb-answer" key={i}>
                  {a.imageUrl ? <img src={a.imageUrl} alt="" loading="lazy" /> : <span className={`qz-question-thumb-check${q.type === "multi_select" ? " is-multi" : ""}`} />}
                  <span>{a.text}</span>
                </div>
              ))}
            </div>
          )}
          {!freeform && q.type !== "dropdown" && q.remainingAnswers > 0 ? (
            <div className="qz-question-thumb-more">+{q.remainingAnswers} more {q.remainingAnswers === 1 ? "answer" : "answers"}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
