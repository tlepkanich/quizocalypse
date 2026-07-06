import { useContext, useState } from "react";
import type { createAnalyticsClient } from "../../../lib/analytics";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import { RuntimePreviewContext } from "../runtimeContexts";

// Inline email capture on the result page (Dev Spec §5), gated by
// Quiz.collect_email_on_result. Mirrors EmailGateView: preview mode does not
// POST; a real capture persists via /captures + fires email_captured.
export function ResultEmailCapture({
  quizId,
  sessionId,
  styles,
  analytics,
}: {
  quizId: string;
  sessionId: string;
  styles: ReturnType<typeof stylesFor>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email);

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      if (!isPreviewMode) {
        await fetch("/captures", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quiz_id: quizId, session_id: sessionId, email }),
          keepalive: true,
        });
      }
      analytics?.track("email_captured", { source: "result" });
      setDone(true);
    } catch {
      setDone(true); // never trap the shopper on a capture failure
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        style={{
          marginTop: 24,
          padding: 14,
          borderRadius: "var(--qz-radius)",
          background: "#00000008",
          textAlign: "center",
        }}
      >
        {tc("email_capture_thanks")}
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid #00000014" }}
    >
      <div style={{ fontWeight: 600, marginBottom: 10 }}>{tc("email_capture_heading")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="email"
          aria-label={tc("email_placeholder")}
          placeholder={tc("email_placeholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            flex: "1 1 200px",
            padding: "12px 14px",
            borderRadius: "var(--qz-radius)",
            border: "1px solid #00000022",
            fontSize: "var(--qz-base-size)",
            fontFamily: "var(--qz-font-body)",
          }}
        />
        <button
          type="submit"
          disabled={!valid || submitting}
          style={{ ...styles.primaryBtn, opacity: valid && !submitting ? 1 : 0.5 }}
        >
          {submitting ? tc("email_capture_sending") : tc("email_capture_button")}
        </button>
      </div>
    </form>
  );
}
