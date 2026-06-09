import { z } from "zod";
import type { Quiz } from "./quizSchema";

// Reviews/FAQ ingestion → AI copy enrichment (Dev Spec §3.2). The merchant pastes
// real review/FAQ text; the AI rewrites answer wording + answer tooltips + result
// why-bullets in the customers' own language. The AI returns this structured
// enrichment (referencing only existing node/answer ids); `applyReviewEnrichment`
// merges it deterministically onto the real doc — the AI never emits graph,
// products, or ids it wasn't given. Pure: no Claude, no IO (the Claude call lives
// in claude.ts `enrichFromReviews`; the intent in quizEditorIO does the apply +
// Quiz.parse gate).

type QuizDoc = z.infer<typeof Quiz>;

// ~6k tokens of review text keeps the enrichment prompt bounded.
const MAX_REVIEW_CHARS = 6000 * 4;

/** Cap + normalize pasted review/FAQ text before it goes to the AI. Pure. */
export function clampReviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_REVIEW_CHARS);
}

export const ReviewEnrichment = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        answers: z
          .array(
            z.object({
              id: z.string(),
              text: z.string().optional(),
              tooltip_text: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  results: z
    .array(
      z.object({
        id: z.string(),
        why_bullets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  summary: z.string().default(""),
});
export type ReviewEnrichment = z.infer<typeof ReviewEnrichment>;

/**
 * Merge a review enrichment onto the doc: rewrite answer text + tooltips by id,
 * and result why-bullets by result id. Only fields the AI supplied (and only ids
 * that exist) are touched — everything else is preserved by construction. Pure;
 * the caller runs Quiz.parse before committing. Returns the new doc + a count of
 * fields changed (so the UI can say "updated N things").
 */
export function applyReviewEnrichment(
  doc: QuizDoc,
  enr: ReviewEnrichment,
): { doc: QuizDoc; changed: number } {
  let changed = 0;
  const byQuestion = new Map(enr.questions.map((q) => [q.id, q]));
  const byResult = new Map(enr.results.map((r) => [r.id, r]));

  const nodes = doc.nodes.map((n) => {
    if (n.type === "question" && byQuestion.has(n.id)) {
      const eq = byQuestion.get(n.id)!;
      const byAnswer = new Map(eq.answers.map((a) => [a.id, a]));
      const answers = n.data.answers.map((a) => {
        const ea = byAnswer.get(a.id);
        if (!ea) return a;
        const next = { ...a };
        if (ea.text && ea.text.trim()) {
          next.text = ea.text.trim();
          changed += 1;
        }
        if (ea.tooltip_text && ea.tooltip_text.trim()) {
          next.tooltip_text = ea.tooltip_text.trim();
          changed += 1;
        }
        return next;
      });
      return { ...n, data: { ...n.data, answers } };
    }
    if (n.type === "result" && byResult.has(n.id)) {
      const bullets = byResult
        .get(n.id)!
        .why_bullets.map((b) => b.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (bullets.length > 0) {
        changed += 1;
        return { ...n, data: { ...n.data, why_bullets: bullets } };
      }
    }
    return n;
  });

  return { doc: { ...doc, nodes }, changed };
}
