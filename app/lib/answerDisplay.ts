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
      // build-tab handoff §4 image guardrail — TILES default to 4:3 (the 1:1
      // default stretched each tile to ~349px tall on a 2-col desktop grid).
      // An explicit merchant aspect always wins above.
      return d.mode === "tiles" ? "4 / 3" : "1 / 1";
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

/** §5.2/§4 — the option background: image, gradient (2–3 stops, linear/radial),
 *  solid, or none (theme). R6-3 adds the image + radial/3-stop; a bare bg or a
 *  bg+bg2 pair with no extras resolves byte-identically to before. */
export function displayBackground(d: AnswerDisplay): string | undefined {
  if (d.bg_image) return `center / cover no-repeat url("${d.bg_image}")`;
  const stops = [d.bg, d.bg2, d.bg3].filter((c): c is string => Boolean(c));
  if (stops.length >= 2)
    return d.bg_gradient_type === "radial"
      ? `radial-gradient(circle, ${stops.join(", ")})`
      : `linear-gradient(135deg, ${stops.join(", ")})`;
  return d.bg || undefined;
}

/** §3.2 — "Apply this option's look to all options": push the source option's
 *  media (icon + image) across every other option, so the set matches. The
 *  source is left untouched; options without the source's media have theirs
 *  cleared to match. Pure. */
export function copyOptionMediaToAll<A extends { id: string; icon?: string; image_url?: string }>(
  answers: readonly A[],
  sourceId: string,
): A[] {
  const src = answers.find((a) => a.id === sourceId);
  if (!src) return [...answers];
  return answers.map((a) => {
    if (a.id === sourceId) return a;
    const next: A = { ...a };
    if (src.icon !== undefined) next.icon = src.icon;
    else delete next.icon;
    if (src.image_url !== undefined) next.image_url = src.image_url;
    else delete next.image_url;
    return next;
  });
}
