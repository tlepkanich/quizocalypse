// Design Settings spec §4 — per-quiz answer layout. Resolves the answer grid's
// CSS grid-template-columns from the quiz-level design tokens. Pure so it can be
// unit-tested without rendering. Precedence (highest first):
//   1. explicit answer_layout (list / grid) → wins on ANY chrome — the merchant
//      opted OUT of the chrome default (esp. minimal, which is the only chrome on
//      the standalone studio; otherwise the control would be a no-op there).
//        list = 1 col · grid = answer_grid_columns on desktop, 1-up on mobile
//   2. auto / UNSET → the chrome default: minimal = 1-up; classic = 2-up desktop,
//      1-up mobile. This reproduces today's layout exactly (byte-stable).
//   (a per-QUESTION answer_columns override is applied separately, on top of this,
//    in QuestionView — it is the final word for that one question.)

export function answerGridColumns(opts: {
  minimal: boolean;
  desktop: boolean;
  answerLayout?: "grid" | "list" | "auto";
  // 2 or 3 in practice (the funnel intent validates); typed loose to match the
  // schema's inferred number.
  gridColumns?: number;
}): string {
  // Explicit layout wins over the chrome default (so Grid/List works on minimal).
  if (opts.answerLayout === "list") return "1fr";
  if (opts.answerLayout === "grid") {
    return opts.desktop ? `repeat(${opts.gridColumns ?? 2}, minmax(0, 1fr))` : "1fr";
  }
  // "auto" / unset → today's chrome default (byte-stable).
  if (opts.minimal) return "1fr";
  return opts.desktop ? "repeat(2, minmax(0, 1fr))" : "1fr";
}
