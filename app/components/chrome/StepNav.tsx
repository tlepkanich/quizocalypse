import { useEffect, useState } from "react";
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
  const currentId = steps.find((step) => step.state === "current")?.id ?? null;
  const [ignitingId, setIgnitingId] = useState<string | null>(currentId);

  useEffect(() => {
    if (!currentId) return;
    setIgnitingId(currentId);
    const timeout = window.setTimeout(() => setIgnitingId(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [currentId]);

  return (
    <nav className="qz-stepnav" aria-label="Setup steps">
      {steps.map((step, index) => {
        const clickable = step.state === "done" && Boolean(onStepClick);
        return (
          <span key={step.id} className="qz-stepnav-segment">
            {index > 0 ? (
              <span
                className={`qz-stepnav-link${index <= steps.findIndex((s) => s.state === "current") ? " is-done" : ""}`}
                aria-hidden
              />
            ) : null}
            <span className={`qz-stepnav-item${ignitingId === step.id ? " is-igniting" : ""}`}>
              <button
                type="button"
                className={`qz-stepnav-pill is-${step.state}`}
                disabled={!clickable && step.state !== "current"}
                aria-current={step.state === "current" ? "step" : undefined}
                onClick={clickable ? () => onStepClick?.(step.id) : undefined}
              >
                <span className="qz-stepnav-dot">
                  {step.state === "done" ? (
                    <Check size={13} strokeWidth={2.6} className="qz-stepnav-check" aria-label="done" />
                  ) : (
                    <span className="qz-stepnav-num">{String(step.number).padStart(2, "0")}</span>
                  )}
                  {step.state === "current" ? (
                    <span className="qz-stepnav-sparks" aria-hidden>
                      <i /><i /><i />
                    </span>
                  ) : null}
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
