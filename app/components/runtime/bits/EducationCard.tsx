import type { stylesFor } from "../runtimeStyles";

// Micro-education card (Dev Spec §4.1) — a one-line teaching callout shown
// before a question (Continue-only, no CTA; set by the AI/merchant via the
// editor's set_education_card edit-op). Renders only when the field is present.
export function EducationCard({
  text,
  styles,
  inspectProps,
}: {
  text: string;
  styles: ReturnType<typeof stylesFor>;
  inspectProps?: React.HTMLAttributes<HTMLElement>;
}) {
  return (
    <div
      style={{
        ...styles.card,
        // Full hairline + tint instead of the 4px side-stripe accent (the
        // side-tab is the most recognizable template tell; a quiet tinted
        // callout reads as designed).
        border: "1px solid color-mix(in srgb, var(--qz-color-primary) 25%, transparent)",
        background: "color-mix(in srgb, var(--qz-color-primary) 6%, transparent)",
        marginBottom: 12,
      }}
      {...(inspectProps ?? {})}
    >
      <div className="qz-dim" style={{ fontSize: 13, lineHeight: 1.5 }}>💡 {text}</div>
    </div>
  );
}
