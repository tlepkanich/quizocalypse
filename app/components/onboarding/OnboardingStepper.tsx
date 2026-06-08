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

// Standalone AI wizard (Catalog · Brand · Goal · Incentives · Build), aligned to
// the Miro "AI-Guided Quiz Builder" setup flow.
export const WIZARD_STEPS: OnboardingStepDef[] = [
  { n: 1, title: "Catalog", subtitle: "Readiness" },
  { n: 2, title: "Brand", subtitle: "Look & feel" },
  { n: 3, title: "Goal", subtitle: "Quiz shape" },
  { n: 4, title: "Incentives", subtitle: "Email & placement" },
  { n: 5, title: "Build", subtitle: "Review & go" },
];

function StepperShell({
  steps,
  current,
  maxReached,
  onJump,
}: {
  steps: OnboardingStepDef[];
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
      {steps.map((s, i) => {
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

// Thin wrappers so callers keep a stable API while sharing one render shell.
export function OnboardingStepper(props: {
  current: number;
  maxReached: number;
  onJump: (n: number) => void;
}) {
  return <StepperShell steps={ONBOARDING_STEPS} {...props} />;
}

export function WizardStepper(props: {
  current: number;
  maxReached: number;
  onJump: (n: number) => void;
}) {
  return <StepperShell steps={WIZARD_STEPS} {...props} />;
}
