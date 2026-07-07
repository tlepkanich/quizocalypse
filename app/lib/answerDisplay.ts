import type { CSSProperties } from "react";
import type { Quiz } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// QZY-9 (build-tab §5/§5.2) — pure resolution for the answer display modes.
// The runtime and the builder preview both read through these, so what the
// inspector configures is exactly what ships.
// ════════════════════════════════════════════════════════════════════════════

type QuestionData = Extract<Quiz["nodes"][number], { type: "question" }>["data"];
export type AnswerDisplay = NonNullable<QuestionData["answer_display"]>;
export type AnswerDisplayMode = NonNullable<AnswerDisplay["mode"]>;

/** §5.2 — shape presets set defined radius values; a custom radius overrides
 *  the preset. Absent both → the theme's var(--qz-radius). */
export function displayRadius(d: AnswerDisplay): number | string {
  if (d.radius !== undefined) return d.radius;
  switch (d.shape) {
    case "pill":
      return 999;
    case "square":
      return 0;
    case "rounded":
      return 12;
    default:
      return "var(--qz-radius)";
  }
}

/** CSS aspect-ratio for card/tile images. */
export function displayAspect(d: AnswerDisplay): string {
  switch (d.aspect) {
    case "4:3":
      return "4 / 3";
    case "16:9":
      return "16 / 9";
    default:
      return "1 / 1";
  }
}

/** The option container layout per mode. */
export function displayContainer(d: AnswerDisplay): CSSProperties {
  const gap = d.spacing ?? 10;
  switch (d.mode) {
    case "cards":
    case "tiles":
      return {
        display: "grid",
        gap,
        gridTemplateColumns: `repeat(${d.columns ?? 2}, minmax(0, 1fr))`,
      };
    case "pills":
      return { display: "flex", flexWrap: "wrap", gap };
    default:
      // list / icon — stacked rows.
      return { display: "grid", gap, gridTemplateColumns: "1fr" };
  }
}

/** §5.2 — the option background: solid, 2-stop gradient, or none (theme). */
export function displayBackground(d: AnswerDisplay): string | undefined {
  if (d.bg && d.bg2) return `linear-gradient(135deg, ${d.bg}, ${d.bg2})`;
  return d.bg || undefined;
}
