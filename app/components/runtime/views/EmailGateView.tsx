import { useContext, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import { RuntimeChromeContext, RuntimePreviewContext } from "../runtimeContexts";
import type { InspectPart } from "../inspect";
import { MinimalNav } from "../bits/nav";

type QuizDoc = Quiz;

export function EmailGateView({
  node,
  styles,
  quizId,
  sessionId,
  onSubmit,
  onBack,
  canBack,
  inspect,
  region = false,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "email_gate" }>;
  styles: ReturnType<typeof stylesFor>;
  quizId: string;
  sessionId: string;
  onSubmit: (contact?: { email?: string; name?: string; phone?: string }) => void;
  onBack?: () => void;
  canBack?: boolean;
  inspect?: (part: InspectPart) => React.HTMLAttributes<HTMLElement>;
  // BLD-7 — render only the capture form (for the "email_input" block).
  region?: boolean;
}) {
  const tc = useChrome();
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email);

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      if (isPreviewMode) return; // preview: no /captures POST (finally still advances)
      await fetch("/captures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quiz_id: quizId,
          session_id: sessionId,
          email,
          ...(name ? { first_name: name } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
        keepalive: true,
      });
    } catch {
      // Don't block the quiz on capture failure.
    } finally {
      onSubmit({
        email,
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
      });
    }
  }
  const inputStyle: React.CSSProperties = {
    padding: minimal ? "15px 16px" : "12px 14px",
    borderRadius: "var(--qz-radius)",
    border: minimal
      ? "1.5px solid color-mix(in srgb, var(--qz-color-text) 22%, transparent)"
      : "1px solid #00000022",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
    ...(minimal ? { textAlign: "left" as const, background: "var(--qz-color-bg)" } : {}),
  };
  // BLD-7 — region mode: the layout's heading/text blocks own the headline.
  const shell = region ? { display: "flex", flexDirection: "column" as const } : styles.card;
  const header = region ? null : (
    <>
      <h2 style={styles.h2} {...(inspect?.("email_headline") ?? {})}>{node.data.headline}</h2>
      {node.data.subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("email_subtext") ?? {})}>
          {node.data.subtext}
        </p>
      )}
    </>
  );
  return (
    <div style={shell}>
      {header}
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        <input
          type="email"
          aria-label={tc("gate_email_placeholder")}
          placeholder={tc("gate_email_placeholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        {node.data.name_optional && (
          <input
            type="text"
            aria-label={tc("gate_name_placeholder")}
            placeholder={tc("gate_name_placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
        {node.data.collect_phone && (
          <input
            type="tel"
            aria-label={tc("gate_phone_placeholder")}
            placeholder={tc("gate_phone_placeholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={inputStyle}
          />
        )}
      </div>
      {minimal ? (
        <>
          {node.data.skip_allowed && (
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button
                onClick={() => onSubmit()}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--qz-color-text)",
                  fontWeight: 700,
                  fontSize: "var(--qz-base-size)",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "var(--qz-font-body)",
                }}
              >
                {tc("skip")}
              </button>
            </div>
          )}
          <MinimalNav
            onBack={onBack}
            canBack={canBack}
            onNext={handleSubmit}
            nextEnabled={valid && !submitting}
          />
        </>
      ) : (
        <>
          <button
            style={{ ...styles.primaryBtn, opacity: valid && !submitting ? 1 : 0.5 }}
            disabled={!valid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "…" : tc("continue")}
          </button>
          {node.data.skip_allowed && (
            <button
              onClick={() => onSubmit()}
              style={{
                background: "none",
                border: "none",
                color: "var(--qz-color-muted)",
                fontSize: 14,
                cursor: "pointer",
                marginTop: 12,
                padding: 0,
              }}
            >
              {tc("skip")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
