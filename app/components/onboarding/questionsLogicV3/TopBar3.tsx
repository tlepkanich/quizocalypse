import { TopBar } from "../../chrome/TopBar";
import { StepNav, type StepNavStep } from "../../chrome/StepNav";
import { FUNNEL_STEPS, stepIndex } from "../../../lib/funnelStages";
import type { Tier1Report } from "../../../lib/pathReport";
import type { Step3View } from "./Step3Shell";

/* quiz-step3 v3 §2 — Step-3's floating top bar: the shared DS TopBar in its
   `floating` variant (sticky rounded widget). Left = wordmark (TopBar owns it) ·
   center = the funnel's 5 step pills (Questions current) · right = save chip +
   the HealthPill stub + the tri-state Continue. The pill's popover and the
   full tri-state gate land in P4 — this phase renders the verdict and keeps
   the existing blocking behavior (blocked = disabled-styled, click no-ops). */

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
  isSaving,
  savedAt,
  saveError,
  onRetry,
  navigating,
  onContinue,
}: {
  view: Step3View;
  verdict: Tier1Report["verdict"];
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
  navigating: boolean;
  /** Content view → switch to Logic; Logic view (healthy) → to-rec-page. */
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
          {/* HealthPill stub — live verdict from the memoized Tier-1 report;
              the popover (checks + jump links) lands in P4. */}
          <span
            className={`qz-s3-healthpill ${verdict.blocking > 0 ? "is-bad" : "is-ok"}`}
            title={verdict.label}
          >
            <span className="qz-s3-healthdot" aria-hidden />
            {verdict.blocking > 0
              ? `${verdict.blocking} issue${verdict.blocking === 1 ? "" : "s"}`
              : "Logic valid"}
          </span>
          <button
            type="button"
            className="qz-btn qz-btn-accent qz-btn-sm"
            aria-disabled={blocked || navigating || undefined}
            disabled={navigating}
            onClick={blocked ? undefined : onContinue}
          >
            {continueLabel}
          </button>
        </>
      }
    />
  );
}
