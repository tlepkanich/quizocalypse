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
        borderLeft: "4px solid var(--qz-color-primary)",
        marginBottom: 12,
      }}
      {...(inspectProps ?? {})}
    >
      <div className="qz-dim" style={{ fontSize: 13, lineHeight: 1.5 }}>💡 {text}</div>
    </div>
  );
}
