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
          // Quiet outline: Back must not compete with Next for attention —
          // the softened border keeps it findable without weight.
          border: "1.5px solid color-mix(in srgb, var(--qz-color-text) 30%, transparent)",
          color: "var(--qz-color-text)",
          borderRadius: "var(--qz-radius)",
          padding: "calc(var(--qz-pad) * 0.5) calc(var(--qz-pad) * 1.1)",
          fontFamily: "var(--qz-font-body)",
          fontSize: "var(--qz-base-size)",
          fontWeight: 600,
          cursor: canBack ? "pointer" : "default",
          transition: "transform 140ms cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        {tc("back")}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!nextEnabled}
        style={{
          // Brand primary, not ink: the pre-redesign Quizell chrome painted this
          // with --qz-color-text, which made every quiz's main CTA black no
          // matter the palette. White label is AA-guaranteed by the preset
          // contrast tests (white/primary >=4.5).
          background: "var(--qz-color-primary)",
          color: "#FFF",
          border: "1.5px solid var(--qz-color-primary)",
          borderRadius: "var(--qz-radius)",
          padding: "calc(var(--qz-pad) * 0.5) calc(var(--qz-pad) * 1.5)",
          fontFamily: "var(--qz-font-body)",
          fontSize: "var(--qz-base-size)",
          fontWeight: 600,
          cursor: nextEnabled ? "pointer" : "default",
          opacity: nextEnabled ? 1 : 0.45,
          // The enable is the state change the shopper just caused — ease it in
          // instead of snapping. transform pairs with the global :active press.
          transition:
            "opacity 180ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        {tc("next")}
      </button>
    </div>
  );
}
