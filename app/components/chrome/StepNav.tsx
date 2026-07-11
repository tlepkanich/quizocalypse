import { Check } from "lucide-react";

/* Design-system-V2 §7.6 — step-nav pills. Present ONLY inside the quiz-creation
   flow. Mono step number + name, hairline connectors between pills:
   · upcoming — muted, not clickable (gated by the flow's own Continue rule)
   · done     — deeper ink + a green ✓, clickable (returns to that step)
   · current  — the violet-wash pill with a leading accent dot (the position
                beacon; Soft Pastel §7 progress-dot motif — no gold, no diamond)
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
  return (
    <nav className="qz-stepnav" aria-label="Setup steps">
      {steps.map((step) => {
        const clickable = step.state === "done" && Boolean(onStepClick);
        return (
          <span key={step.id} className="qz-stepnav-item">
            <button
              type="button"
              className={`qz-stepnav-pill is-${step.state}`}
              disabled={!clickable && step.state !== "current"}
              aria-current={step.state === "current" ? "step" : undefined}
              onClick={clickable ? () => onStepClick?.(step.id) : undefined}
            >
              {step.state === "done" ? (
                <Check size={13} strokeWidth={2.5} className="qz-stepnav-check" aria-label="done" />
              ) : (
                <span className="qz-stepnav-num">{String(step.number).padStart(2, "0")}</span>
              )}
              <span className="qz-stepnav-name">{step.label}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
