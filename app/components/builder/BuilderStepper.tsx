import type { ReactNode } from "react";

// ───────────────────────────────────────────────────────────────────────────
// BuilderStepper — the top stepper for the 4-step guided quiz builder
// (Products → Questions → Results → Preview). Pure presentational; the shell
// computes `states` from per-step canContinue() and owns navigation via onJump.
// ───────────────────────────────────────────────────────────────────────────

export type StepState = "done" | "current" | "upcoming";

export interface StepDef {
  n: number;
  title: string;
  subtitle: string;
}

export const BUILDER_STEPS: StepDef[] = [
  { n: 1, title: "Products", subtitle: "Group into buckets" },
  { n: 2, title: "Questions", subtitle: "Build & wire steps" },
  { n: 3, title: "Results", subtitle: "Logic, design & discount" },
  { n: 4, title: "Preview", subtitle: "Walk through & publish" },
];

export function BuilderStepper({
  current,
  states,
  onJump,
  right,
}: {
  current: number;
  states: Record<number, StepState>;
  onJump: (n: number) => void;
  right?: ReactNode;
}) {
  return (
    <div
      className="qz-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "12px 16px",
        marginBottom: 20,
        overflowX: "auto",
      }}
    >
      {BUILDER_STEPS.map((s, i) => {
        const state = states[s.n] ?? "upcoming";
        // Every step is a free jump target — move in/out of any step at any time
        // (e.g. an already-built or published quiz). State is just a progress cue.
        const isCurrent = s.n === current;
        const reached = state === "done" || isCurrent;
        return (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 ? (
              <div
                aria-hidden
                style={{
                  width: 32,
                  height: 2,
                  borderRadius: 2,
                  background: state === "upcoming" ? "var(--qz-rule)" : "var(--qz-accent)",
                  flex: "0 0 auto",
                  transition: "background var(--qz-dur) var(--qz-ease)",
                }}
              />
            ) : null}
            <button
              onClick={() => onJump(s.n)}
              title={`${s.title} — ${s.subtitle}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "none",
                background: isCurrent ? "var(--qz-cream-2)" : "transparent",
                borderRadius: "var(--qz-radius-pill)",
                padding: "7px 14px 7px 7px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background var(--qz-dur) var(--qz-ease)",
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12.5,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  flex: "0 0 auto",
                  color: reached ? "#fff" : "var(--qz-ink-4)",
                  background:
                    state === "done"
                      ? "var(--qz-accent)"
                      : isCurrent
                        ? "var(--qz-ink)"
                        : "transparent",
                  border: state === "upcoming" ? "1px solid var(--qz-rule)" : "none",
                  transition: "background var(--qz-dur) var(--qz-ease), color var(--qz-dur) var(--qz-ease)",
                }}
              >
                {state === "done" ? "✓" : s.n}
              </span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: reached ? "var(--qz-ink)" : "var(--qz-ink-3)",
                  }}
                >
                  {s.title}
                </span>
                <span className="qz-dim" style={{ fontSize: 11 }}>
                  {s.subtitle}
                </span>
              </span>
            </button>
          </div>
        );
      })}
      {right ? <div style={{ marginLeft: "auto", flex: "0 0 auto" }}>{right}</div> : null}
    </div>
  );
}
