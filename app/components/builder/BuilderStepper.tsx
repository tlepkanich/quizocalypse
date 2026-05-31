import type { ReactNode } from "react";

// ───────────────────────────────────────────────────────────────────────────
// BuilderStepper — the top stepper for the 5-step guided quiz builder, matching
// the product spec verbatim. Pure presentational; the shell computes `states`
// from per-step canContinue() and owns navigation via onJump.
// ───────────────────────────────────────────────────────────────────────────

export type StepState = "done" | "current" | "upcoming";

export interface StepDef {
  n: number;
  title: string;
  subtitle: string;
}

export const BUILDER_STEPS: StepDef[] = [
  { n: 1, title: "Products", subtitle: "Add recommendation buckets" },
  { n: 2, title: "Page model", subtitle: "Shared vs per-page" },
  { n: 3, title: "Page gallery", subtitle: "Snap or fully build" },
  { n: 4, title: "Page builder", subtitle: "Visual editor" },
  { n: 5, title: "Preview", subtitle: "Quick walkthrough" },
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
        gap: 8,
        padding: "10px 14px",
        marginBottom: 16,
        overflowX: "auto",
      }}
    >
      {BUILDER_STEPS.map((s, i) => {
        const state = states[s.n] ?? "upcoming";
        // Every step is a free jump target — you can move in and out of any step
        // at any time (e.g. on an already-built or published quiz), not just the
        // ones already completed. The visual state stays as a progress cue.
        const clickable = true;
        const isCurrent = s.n === current;
        return (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {i > 0 ? (
              <div
                aria-hidden
                style={{
                  width: 28,
                  height: 2,
                  background: state === "upcoming" ? "#00000014" : "var(--qz-accent, #2a6df4)",
                  flex: "0 0 auto",
                }}
              />
            ) : null}
            <button
              onClick={() => clickable && onJump(s.n)}
              disabled={!clickable}
              title={`${s.title} — ${s.subtitle}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "none",
                background: isCurrent ? "var(--qz-cream-2, #f3f0ea)" : "transparent",
                borderRadius: 999,
                padding: "6px 12px 6px 6px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                opacity: state === "upcoming" ? 0.75 : 1,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  flex: "0 0 auto",
                  color: state === "done" ? "#fff" : isCurrent ? "#fff" : "var(--qz-ink, #222)",
                  background:
                    state === "done"
                      ? "var(--qz-accent, #2a6df4)"
                      : isCurrent
                        ? "var(--qz-ink, #222)"
                        : "#00000010",
                  border: state === "upcoming" ? "1px solid #00000022" : "none",
                }}
              >
                {state === "done" ? "✓" : s.n}
              </span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.title}</span>
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
