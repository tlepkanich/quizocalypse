import { useContext, useEffect, useRef, useState } from "react";
import type { createAnalyticsClient } from "../../../lib/analytics";
import { useChrome } from "../chromeStrings";
import { RuntimeLocaleContext, RuntimePreviewContext } from "../runtimeContexts";

// "Save my results" (BIC P6): links to the public My Results page keyed by the
// unguessable session token — cross-device, survives the tab closing. Live
// only: preview sessions never write a QuizSession row, so the page would 404.
export function SaveResultsLink({ quizId, sessionId }: { quizId?: string; sessionId?: string }) {
  const tc = useChrome();
  const locale = useContext(RuntimeLocaleContext);
  const isPreviewMode = useContext(RuntimePreviewContext);
  if (isPreviewMode || !quizId || !sessionId) return null;
  return (
    <a
      href={`/q/${quizId}/results?session_id=${encodeURIComponent(sessionId)}${locale !== "en" ? `&locale=${encodeURIComponent(locale)}` : ""}`}
      style={{
        display: "inline-block",
        marginTop: 14,
        fontSize: 13,
        color: "var(--qz-color-muted)",
        textDecorationLine: "underline",
        textUnderlineOffset: 3,
      }}
    >
      {tc("save_results_link")}
    </a>
  );
}

// Spec §6 "Share results button" — native share where available, copy-link
// everywhere else, of the shopper's persistent results URL (reconstructed
// server-side from the saved session). Live-only, like SaveResultsLink.
export function ShareResultsButton({ quizId, sessionId }: { quizId?: string; sessionId?: string }) {
  const tc = useChrome();
  const locale = useContext(RuntimeLocaleContext);
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [copied, setCopied] = useState(false);
  if (isPreviewMode || !quizId || !sessionId) return null;
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/q/${quizId}/results?session_id=${encodeURIComponent(sessionId)}${locale !== "en" ? `&locale=${encodeURIComponent(locale)}` : ""}`;
  return (
    <button
      type="button"
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ url });
            return;
          } catch {
            // dismissed — fall through to copy
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked — no-op
        }
      }}
      style={{
        display: "block",
        margin: "12px auto 0",
        font: "inherit",
        fontSize: 13,
        padding: "6px 14px",
        borderRadius: "var(--qz-radius)",
        border: "1px solid var(--qz-color-primary)",
        background: "transparent",
        color: "var(--qz-color-primary)",
        cursor: "pointer",
      }}
    >
      {copied ? tc("share_copied") : tc("share_results_cta")}
    </button>
  );
}

// Buddy mode (Phase L2): invite a friend (share/copy a ?buddy= link carrying
// MY session) and, when I arrived via someone's link, the comparison CTA.
// Live-only, like SaveResultsLink. buddy_completed fires once on render of
// the compare link (the friend finished an invited run).
export function BuddyRow({
  quizId,
  sessionId,
  buddySessionId,
  analytics,
}: {
  quizId?: string;
  sessionId?: string;
  buddySessionId?: string | null;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
}) {
  const tc = useChrome();
  const locale = useContext(RuntimeLocaleContext);
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [copied, setCopied] = useState(false);
  const completedFired = useRef(false);
  useEffect(() => {
    if (buddySessionId && sessionId && !isPreviewMode && !completedFired.current) {
      completedFired.current = true;
      analytics?.track("buddy_completed", { inviter_session: buddySessionId });
    }
  }, [buddySessionId, sessionId, isPreviewMode, analytics]);
  if (isPreviewMode || !quizId || !sessionId) return null;
  const localeQ = locale !== "en" ? `&locale=${encodeURIComponent(locale)}` : "";
  const inviteUrl = `${window.location.origin}/q/${quizId}?buddy=${encodeURIComponent(sessionId)}${localeQ.replace("&", "&")}`;
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      {buddySessionId ? (
        <a
          href={`/q/${quizId}/compare?a=${encodeURIComponent(buddySessionId)}&b=${encodeURIComponent(sessionId)}${localeQ}`}
          style={{ fontSize: 14, fontWeight: 600, color: "inherit" }}
        >
          {tc("see_comparison")}
        </a>
      ) : null}
      <button
        type="button"
        onClick={async () => {
          analytics?.track("buddy_invited", {});
          if (navigator.share) {
            try {
              await navigator.share({ url: inviteUrl });
              return;
            } catch {
              // dismissed — fall through to copy
            }
          }
          try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // clipboard blocked — nothing else to do
          }
        }}
        style={{
          font: "inherit",
          fontSize: 13,
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          opacity: 0.85,
        }}
      >
        {copied ? tc("invite_copied") : tc("invite_friend")}
      </button>
    </div>
  );
}
