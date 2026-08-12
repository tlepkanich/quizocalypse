import { orderFlow } from "./flowOrder";
import type { PublishedChapter, Quiz as QuizDoc } from "./quizSchema";

// Runtime progress bar (Phase 5). The denominator is the number of question
// steps on the ordered flow spine; the numerator is how many the shopper has
// answered (plus the one they're on). Pure + testable.

export function reachableQuestionCount(doc: QuizDoc): number {
  return orderFlow(doc).steps.filter((s) => s.type === "question").length;
}

/** Percent complete (0–100). `answered` is clamped to `total`. */
export function progressPct(total: number, answered: number): number {
  if (total <= 0) return 0;
  const a = Math.max(0, Math.min(answered, total));
  return Math.max(0, Math.min(100, Math.round((a / total) * 100)));
}

// ── QRTZ-O5 — Chapters progress bar (GAPS §A.4, owner call 2026-08-12) ──────
// Pure math for the runtime's Chapters bar. The gating chain — every step
// falls back to the classic bar UNCHANGED:
//   logic_model === "decider"  (legacy docs never reach the new render)
//   AND publish baked `chapters` (chapterless decider docs fall back)
//   AND ≥2 chapters             (a single chapter is just the classic bar)
//   AND barStyle === "bar"      (an explicit merchant dots/steps pick wins —
//                                it is also the merchant's off-ramp)

export function chaptersForRender(
  doc: QuizDoc,
  barStyle: "bar" | "dots" | "steps",
): PublishedChapter[] | null {
  if (doc.logic_model !== "decider" || barStyle !== "bar") return null;
  const chapters = doc.chapters;
  return chapters && chapters.length >= 2 ? chapters : null;
}

/** Per-chapter fill fraction (0–1): answered questions in the chapter (the
    in-progress one counts, matching the classic bar's numerator) over the
    chapter's question count. On the result/end step every chapter is full. */
export function chapterFills(
  chapters: readonly PublishedChapter[],
  answeredQuestionIds: readonly string[],
  currentQuestionId: string | null,
  onResult: boolean,
): number[] {
  if (onResult) return chapters.map(() => 1);
  const answered = new Set(answeredQuestionIds);
  if (currentQuestionId) answered.add(currentQuestionId);
  return chapters.map((c) => {
    const done = c.question_ids.filter((id) => answered.has(id)).length;
    return c.question_ids.length > 0
      ? Math.max(0, Math.min(1, done / c.question_ids.length))
      : 0;
  });
}

/** Which chapter label renders at full opacity: the one holding the current
    question; between chapters (email gate / message) the last one with any
    fill; on the result the final chapter. */
export function currentChapterIndex(
  chapters: readonly PublishedChapter[],
  currentQuestionId: string | null,
  fills: readonly number[],
  onResult: boolean,
): number {
  if (onResult) return chapters.length - 1;
  if (currentQuestionId) {
    const i = chapters.findIndex((c) => c.question_ids.includes(currentQuestionId));
    if (i >= 0) return i;
  }
  let last = 0;
  fills.forEach((f, i) => {
    if (f > 0) last = i;
  });
  return last;
}
