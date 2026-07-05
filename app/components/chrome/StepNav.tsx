import { Check } from "lucide-react";

/* Design-system-V2 §7.6 — step-nav pills. Present ONLY inside the quiz-creation
   flow. Mono step number + name, hairline connectors between pills:
   · upcoming — muted, not clickable (gated by the flow's own Continue rule)
   · done     — deeper ink + a green ✓, clickable (returns to that step)
   · current  — the gold-wash pill with a leading ◆ (the position beacon;
                canonical gold via --qz-gold-wash, part of moment #3's family)
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
      {steps.map((step, i) => {
        const clickable = step.state === "done" && Boolean(onStepClick);
        return (
          <span key={step.id} className="qz-stepnav-item">
            {i > 0 ? <span className="qz-stepnav-connector" aria-hidden="true" /> : null}
            <button
              type="button"
              className={`qz-stepnav-pill is-${step.state}`}
              disabled={!clickable && step.state !== "current"}
              aria-current={step.state === "current" ? "step" : undefined}
              onClick={clickable ? () => onStepClick?.(step.id) : undefined}
            >
              {step.state === "current" ? <span className="qz-mark qz-mark--sm" aria-hidden="true" /> : null}
              <span className="qz-stepnav-num">{String(step.number).padStart(2, "0")}</span>
              <span className="qz-stepnav-name">{step.label}</span>
              {step.state === "done" ? <Check size={11} strokeWidth={2.5} className="qz-stepnav-check" aria-label="done" /> : null}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
