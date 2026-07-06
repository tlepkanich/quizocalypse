import { useContext, useState } from "react";
import { useChrome } from "../chromeStrings";
import { RuntimePreviewContext } from "../runtimeContexts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Spec §5 "Notify Me" — inline back-in-stock email capture shown in place of
// the add-to-cart CTA on an out-of-stock card (and as a section-level prompt
// when everything is sold out). Posts to /q/:id/notify. Preview = no POST.
export function NotifyMeForm({
  quizId,
  sessionId,
  productId,
  compact = false,
}: {
  quizId?: string;
  sessionId?: string;
  productId?: string | null;
  compact?: boolean;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  if (state === "done") {
    return (
      <div style={{ fontSize: 13, color: "var(--qz-color-muted)" }}>{tc("notify_done")}</div>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!EMAIL_RE.test(email)) return;
        setState("sending");
        if (isPreviewMode || !quizId) {
          setState("done");
          return;
        }
        try {
          await fetch(`/q/${quizId}/notify`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, product_id: productId ?? null, session_id: sessionId ?? null }),
          });
        } catch {
          // best-effort — still confirm so the shopper isn't stuck
        }
        setState("done");
      }}
      style={{ display: "flex", gap: 6, flexDirection: compact ? "column" : "row", alignItems: "stretch" }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(ev) => setEmail(ev.target.value)}
        placeholder={tc("notify_email_placeholder")}
        aria-label={tc("notify_email_placeholder")}
        style={{
          font: "inherit",
          fontSize: 13,
          padding: "6px 10px",
          borderRadius: "var(--qz-radius)",
          border: "1px solid #00000022",
          minWidth: 0,
          flex: 1,
        }}
      />
      <button
        type="submit"
        disabled={state === "sending"}
        style={{
          font: "inherit",
          fontSize: 13,
          padding: "6px 14px",
          borderRadius: "var(--qz-radius)",
          border: "1px solid var(--qz-color-primary)",
          background: "var(--qz-color-primary)",
          color: "#fff",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {tc("notify_me")}
      </button>
    </form>
  );
}
