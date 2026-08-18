import { Check } from "lucide-react";

/* One-line-chrome §1.2 — the funnel's step flow: dot + label nodes joined by
   flexible hairlines. Lives in the top bar's centre zone, which owns all free
   width and stretches with the window.
   · upcoming — muted, `disabled` (gated by each step's own Continue rule)
   · done     — the accent-tint pill (the always-on "this is a button" signal;
                don't reduce it to hover-only), clickable when the host passes
                onStepClick (jumps straight there — no confirm, §1.5)
   · current  — solid accent dot with the wash halo (owner 2026-08-18: the
                one-shot ignite ring + sparkle graphic is retired)
   Render-only: the host decides step states and handles navigation. */
export type StepState = "done" | "current" | "upcoming";

export interface StepNavStep {
  /** Stable key the host uses to navigate (e.g. a funnel stage id). */
  id: string;
  label: string;
  /** 1-based; rendered as a zero-padded mono numeral (01, 02…). */
  number: number;
  state: StepState;
}

export function StepNav({
  steps,
  onStepClick,
}: {
  steps: StepNavStep[];
  onStepClick?: (id: string) => void;
}) {
  const currentIdx = steps.findIndex((s) => s.state === "current");

  return (
    <nav className="qz-stepnav" aria-label="Quiz setup steps">
      {steps.map((step, index) => {
        const clickable = step.state === "done" && Boolean(onStepClick);
        // §1.4 — every node names what a click (or the block) means.
        const title =
          step.state === "current"
            ? `You are here — ${step.label}`
            : step.state === "done"
              ? `Go back to ${step.label}`
              : `${step.label} — finish the steps before it first`;
        return (
          <span key={step.id} className="qz-stepnav-segment">
            {index > 0 ? (
              <span
                className={`qz-stepnav-link${index <= currentIdx ? " is-done" : ""}`}
                aria-hidden
              />
            ) : null}
            <span className="qz-stepnav-item">
              <button
                type="button"
                className={`qz-stepnav-pill is-${step.state}`}
                disabled={!clickable && step.state !== "current"}
                aria-current={step.state === "current" ? "step" : undefined}
                title={title}
                onClick={clickable ? () => onStepClick?.(step.id) : undefined}
              >
                <span className="qz-stepnav-dot">
                  {step.state === "done" ? (
                    <Check size={13} strokeWidth={2.6} className="qz-stepnav-check" aria-label="done" />
                  ) : (
                    <span className="qz-stepnav-num">{String(step.number).padStart(2, "0")}</span>
                  )}
                </span>
                <span className="qz-stepnav-name">{step.label}</span>
              </button>
            </span>
          </span>
        );
      })}
    </nav>
  );
}
