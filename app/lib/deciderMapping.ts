import { isFreeformType } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-10c) — deterministic decider mapping, SHARED by the funnel
// build (applyDeciderQuestionFlow) and the legacy→decider upgrade wizard
// (L2-10e). Correctness of the one-decider model is owned HERE, not by the
// AI: the generation prompt only steers quality, and this mapper guarantees
// every deciding answer carries a target (V4 by construction) and that the
// picked question maximises distinct-target coverage.
// ════════════════════════════════════════════════════════════════════════════

export interface MappingBucket {
  id: string;
  tags: string[];
}

/** Map each answer to ONE bucket id. Argmax of case-insensitive tag overlap
 *  (the seedPointsFromCategories semantics; ties → the earlier bucket). Answers
 *  with no overlap are then filled from the UNUSED buckets in order (so
 *  distinct coverage maximises), and finally positionally (j % len) — every
 *  answer always gets a target when any bucket exists. */
export function mapAnswersToTargets(
  answers: readonly { tags: readonly string[] }[],
  buckets: readonly MappingBucket[],
): string[] {
  if (buckets.length === 0) return [];
  const bucketTagSets = buckets.map((b) => new Set(b.tags.map((t) => t.toLowerCase())));

  const mapped: (string | null)[] = answers.map((a) => {
    let bestIdx = -1;
    let bestOverlap = 0;
    const answerTags = a.tags.map((t) => t.toLowerCase());
    bucketTagSets.forEach((set, i) => {
      let overlap = 0;
      for (const tag of answerTags) if (set.has(tag)) overlap += 1;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    });
    return bestIdx >= 0 ? buckets[bestIdx]!.id : null;
  });

  const used = new Set(mapped.filter((m): m is string => m !== null));
  const unused = buckets.filter((b) => !used.has(b.id)).map((b) => b.id);
  let u = 0;
  return mapped.map((m, j) =>
    m !== null ? m : u < unused.length ? unused[u++]! : buckets[j % buckets.length]!.id,
  );
}

/** Pick the DECIDING question: among eligible questions (single-answer family —
 *  never multi_select or freeform, mirroring setQuestionRole's refusal), the
 *  one whose answers map to the most DISTINCT targets; ties → earliest in the
 *  flow. Returns -1 when no question is eligible. */
export function pickDeciderIndex(
  questions: readonly {
    question_type: string;
    answers: readonly { tags: readonly string[] }[];
  }[],
  buckets: readonly MappingBucket[],
): number {
  let bestIdx = -1;
  let bestScore = 0;
  questions.forEach((q, i) => {
    if (q.question_type === "multi_select" || isFreeformType(q.question_type)) return;
    const distinct = new Set(mapAnswersToTargets(q.answers, buckets)).size;
    if (distinct > bestScore) {
      bestScore = distinct;
      bestIdx = i;
    }
  });
  return bestIdx;
}
