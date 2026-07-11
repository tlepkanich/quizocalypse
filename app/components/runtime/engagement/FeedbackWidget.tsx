import { useState } from "react";
import type { ResolvedEngagement } from "../../../lib/engagementSchema";

// §L L2/L3 — post-result feedback. Thumbs or 1–5 stars (+ optional open text),
// one submission per session → POST /feedback (202, fire-and-forget). Never
// blocks the result; thank-you state after submit. v1 = on-results only (Y3).
export function FeedbackWidget({
  config,
  quizId,
  sessionId,
  outcomeId,
}: {
  config: ResolvedEngagement["feedback"];
  quizId: string;
  sessionId: string;
  outcomeId?: string;
}) {
  const [sent, setSent] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number | null>(null);

  const submit = (rating: number) => {
    if (sent) return;
    setPicked(rating);
    setSent(true);
    try {
      void fetch("/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quiz_id: quizId,
          session_id: sessionId,
          rating,
          ...(config.openText && text.trim() ? { text: text.trim() } : {}),
          ...(outcomeId ? { outcome_id: outcomeId } : {}),
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // fire-and-forget; the shopper is never blocked by a failed POST.
    }
  };

  if (sent) {
    return (
      <div className="qz-fb qz-fb-done" role="status">
        <span aria-hidden>✓</span> Thanks for the feedback!
      </div>
    );
  }

  return (
    <div className="qz-fb">
      <span className="qz-fb-prompt">{config.prompt || "Was this helpful?"}</span>
      {config.type === "stars" ? (
        <div className="qz-fb-stars" role="group" aria-label="Rate 1 to 5 stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`qz-fb-star${picked && n <= picked ? " is-on" : ""}`}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              onClick={() => submit(n)}
            >
              ★
            </button>
          ))}
        </div>
      ) : (
        <div className="qz-fb-thumbs" role="group" aria-label="Was this helpful?">
          <button type="button" className="qz-fb-btn" aria-label="Yes, helpful" onClick={() => submit(1)}>
            👍
          </button>
          <button type="button" className="qz-fb-btn" aria-label="Not helpful" onClick={() => submit(0)}>
            👎
          </button>
        </div>
      )}
      {config.openText ? (
        <input
          className="qz-fb-text"
          placeholder="Tell us more (optional)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          aria-label="Optional feedback"
        />
      ) : null}
    </div>
  );
}
