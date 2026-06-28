// Design Settings spec §4 — per-quiz answer layout. Resolves the answer grid's
// CSS grid-template-columns from the quiz-level design tokens. Pure so it can be
// unit-tested without rendering. Precedence (highest first):
//   1. minimal chrome  → always single column (the Quizell card-less look wins)
//   2. answer_layout   → list = 1 col · grid = answer_grid_columns (desktop) · auto = today
//   (a per-QUESTION answer_columns override is applied separately, on top of this,
//    in QuestionView — it is the final word for that one question.)
// UNSET answer_layout reproduces today's responsive default exactly (byte-stable).

export function answerGridColumns(opts: {
  minimal: boolean;
  desktop: boolean;
  answerLayout?: "grid" | "list" | "auto";
  // 2 or 3 in practice (the funnel intent validates); typed loose to match the
  // schema's inferred number.
  gridColumns?: number;
}): string {
  if (opts.minimal) return "1fr";
  if (opts.answerLayout === "list") return "1fr";
  if (opts.answerLayout === "grid") {
    return opts.desktop ? `repeat(${opts.gridColumns ?? 2}, minmax(0, 1fr))` : "1fr";
  }
  // "auto" or unset → today's behavior: 2-up on desktop, 1-up on mobile.
  return opts.desktop ? "repeat(2, minmax(0, 1fr))" : "1fr";
}
