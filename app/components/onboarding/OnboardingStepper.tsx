// Slim stepper for the onboarding wizard (Start · About · Design · Build),
// modeled on the Studio BuilderStepper. Steps up to `maxReached` are clickable
// so the merchant can step back; later steps are shown but locked.

export interface OnboardingStepDef {
  n: number;
  title: string;
  subtitle: string;
}

export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  { n: 1, title: "Start", subtitle: "Template or AI" },
  { n: 2, title: "About", subtitle: "Goals & inputs" },
  { n: 3, title: "Design", subtitle: "Brand look" },
  { n: 4, title: "Build", subtitle: "Generate" },
];

export function OnboardingStepper({
  current,
  maxReached,
  onJump,
}: {
  current: number;
  maxReached: number;
  onJump: (n: number) => void;
}) {
  return (
    <div
      className="qz-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        marginBottom: 20,
        overflowX: "auto",
      }}
    >
      {ONBOARDING_STEPS.map((s, i) => {
        const done = s.n < current;
        const isCurrent = s.n === current;
        const clickable = s.n <= maxReached;
        return (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {i > 0 ? (
              <div
                aria-hidden
                style={{
                  width: 24,
                  height: 2,
                  flex: "0 0 auto",
                  background: s.n <= maxReached ? "var(--qz-accent, #2a6df4)" : "#00000014",
                }}
              />
            ) : null}
            <button
              onClick={() => clickable && onJump(s.n)}
              disabled={!clickable}
              className="qz-row"
              style={{
                gap: 10,
                border: "none",
                background: isCurrent ? "var(--qz-cream-2, #f3f0ea)" : "transparent",
                borderRadius: 999,
                padding: "6px 12px 6px 6px",
                cursor: clickable ? "pointer" : "default",
                whiteSpace: "nowrap",
                opacity: clickable ? 1 : 0.55,
                alignItems: "center",
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
                  color: done || isCurrent ? "#fff" : "var(--qz-ink, #222)",
                  background: done
                    ? "var(--qz-accent, #2a6df4)"
                    : isCurrent
                      ? "var(--qz-ink, #222)"
                      : "#00000010",
                }}
              >
                {done ? "✓" : s.n}
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
    </div>
  );
}
