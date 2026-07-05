import type { ReactNode } from "react";
import { TopBar } from "../../chrome/TopBar";
import { StepNav, type StepNavStep } from "../../chrome/StepNav";
import { FUNNEL_STEPS, stepIndex } from "../../../lib/funnelStages";
import type { Tier1Report } from "../../../lib/pathReport";
import type { Step3View } from "./Step3Shell";

/* quiz-step3 v3 §2 — Step-3's floating top bar: the shared DS TopBar in its
   `floating` variant (sticky rounded widget). Left = wordmark (TopBar owns it) ·
   center = the funnel's 5 step pills (Questions current) · right = save chip +
   the HealthPill (a slot the shell composes with its single memoized report)
   + the tri-state Continue (P4): Content → "◆ Continue to Logic" (view
   switch) · Logic healthy → "◆ Continue to Results" (the stage's to-rec-page
   intent) · Logic blocked → "Fix N issues to continue", which stays CLICKABLE
   and opens the health popover (the shell routes the click — this button
   never advances while verdict.blocking > 0). */

// `savedAt` is an ISO string from the CLIENT autosave fetcher — never
// server-rendered, so local-time formatting is safe ([[ssr-unsafe-locale-dates]]).
function savedTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// The funnel's five visible steps with Questions current (FUNNEL_STEPS is the
// single source of truth). Done pills stay inert here — same posture as the
// funnel's own FunnelStepNav (navigation stays with Back/Continue intents).
function step3NavSteps(): StepNavStep[] {
  const currentIdx = stepIndex("question_builder");
  return FUNNEL_STEPS.map((s, i) => ({
    id: s.stage,
    label: s.short,
    number: i + 1,
    state: i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming",
  }));
}

export function TopBar3({
  view,
  verdict,
  healthPill,
  isSaving,
  savedAt,
  saveError,
  onRetry,
  navigating,
  onContinue,
}: {
  view: Step3View;
  verdict: Tier1Report["verdict"];
  /** The HealthPill (+ its controlled popover), composed by Step3Shell from
   *  the SAME report instance `verdict` comes from. */
  healthPill: ReactNode;
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
  navigating: boolean;
  /** Content view → switch to Logic; Logic healthy → to-rec-page; Logic
   *  blocked → the shell opens the health popover instead of advancing. */
  onContinue: () => void;
}) {
  const blocked = view === "logic" && verdict.blocking > 0;
  const continueLabel =
    view === "content"
      ? "◆ Continue to Logic"
      : blocked
        ? `Fix ${verdict.blocking} issue${verdict.blocking === 1 ? "" : "s"} to continue`
        : "◆ Continue to Results";

  return (
    <TopBar
      floating
      center={<StepNav steps={step3NavSteps()} />}
      right={
        <>
          <span className="qz-save-status" aria-live="polite">
            {isSaving ? (
              <span className="qz-save-chip is-saving">
                <span className="qz-save-dot" aria-hidden /> Saving…
              </span>
            ) : saveError ? (
              <span className="qz-save-chip is-error">
                <span aria-hidden>⚠</span> {saveError} ·{" "}
                <button type="button" className="qz-ql-retry" onClick={onRetry}>
                  Retry
                </button>
              </span>
            ) : savedAt ? (
              <span key={savedAt} className="qz-save-chip is-saved">
                <span aria-hidden>✓</span> Saved {savedTimeLabel(savedAt)}
              </span>
            ) : null}
          </span>
          {healthPill}
          <button
            type="button"
            className={`qz-btn qz-btn-sm qz-s3-continue${blocked ? " is-blocked" : " qz-btn-accent"}`}
            disabled={navigating}
            aria-haspopup={blocked ? "dialog" : undefined}
            onClick={onContinue}
          >
            {continueLabel}
          </button>
        </>
      }
    />
  );
}
