import { useChrome } from "../chromeStrings";

// MQ — the minimal chrome's bottom Back/Next nav row (Quizell). Back is an
// outline pill (hidden, not removed, on the first question so layout is stable);
// Next is a solid pill that commits the pending selection.
// B6 — a "Skip" affordance for OPTIONAL questions (node.data.required === false).
// Mirrors the email-gate's two chrome styles; advances via the default next step
// with no answer recorded (onAdvance([], null)), which the engine resolves to the
// unconditional fallback edge (empty selectedAnswerIds contribute no tags).
export function SkipLink({ minimal, onSkip, label }: { minimal: boolean; onSkip: () => void; label: string }) {
  return (
    <div style={{ textAlign: "center", marginTop: minimal ? 20 : 0 }}>
      <button
        type="button"
        onClick={onSkip}
        style={
          minimal
            ? {
                background: "none",
                border: "none",
                color: "var(--qz-color-text)",
                fontWeight: 700,
                fontSize: "var(--qz-base-size)",
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
                fontFamily: "var(--qz-font-body)",
              }
            : {
                background: "none",
                border: "none",
                color: "var(--qz-color-muted)",
                fontSize: 14,
                cursor: "pointer",
                marginTop: 12,
                padding: 0,
              }
        }
      >
        {label}
      </button>
    </div>
  );
}

export function MinimalNav({
  onBack,
  canBack,
  onNext,
  nextEnabled,
}: {
  onBack?: () => void;
  canBack?: boolean;
  onNext: () => void;
  nextEnabled: boolean;
}) {
  const tc = useChrome();
  return (
    <div
      style={{
        marginTop: 34,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        style={{
          visibility: canBack ? "visible" : "hidden",
          background: "transparent",
          border: "1.5px solid var(--qz-color-text)",
          color: "var(--qz-color-text)",
          borderRadius: "var(--qz-radius)",
          padding: "calc(var(--qz-pad) * 0.5) calc(var(--qz-pad) * 1.1)",
          fontFamily: "var(--qz-font-body)",
          fontSize: "var(--qz-base-size)",
          fontWeight: 600,
          cursor: canBack ? "pointer" : "default",
        }}
      >
        {tc("back")}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!nextEnabled}
        style={{
          background: "var(--qz-color-text)",
          color: "var(--qz-color-bg)",
          border: "1.5px solid var(--qz-color-text)",
          borderRadius: "var(--qz-radius)",
          padding: "calc(var(--qz-pad) * 0.5) calc(var(--qz-pad) * 1.5)",
          fontFamily: "var(--qz-font-body)",
          fontSize: "var(--qz-base-size)",
          fontWeight: 600,
          cursor: nextEnabled ? "pointer" : "default",
          opacity: nextEnabled ? 1 : 0.45,
        }}
      >
        {tc("next")}
      </button>
    </div>
  );
}
