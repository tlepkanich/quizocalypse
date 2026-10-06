import { isFreeformType } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-10c) — deterministic decider mapping, SHARED by the funnel
// build (applyDeciderQuestionFlow) and the legacy→decider upgrade wizard
// (L2-10e). Correctness of the one-decider model is owned HERE, not by the
// AI: the generation prompt only steers quality, and this mapper guarantees
// every deciding answer carries a target (V4 by construction) and that
// exactly one question decides — the generator's marked decider when it has
// one, otherwise the question whose answers best cover the targets.
// ════════════════════════════════════════════════════════════════════════════

export interface MappingBucket {
  id: string;
  tags: string[];
}

/** Each answer's bucket id by tag overlap alone: argmax of case-insensitive
 *  overlap (the seedPointsFromCategories semantics; ties → the earlier
 *  bucket), or null when the answer shares no tag with any bucket. */
function overlapTargets(
  answers: readonly { tags: readonly string[] }[],
  buckets: readonly MappingBucket[],
): (string | null)[] {
  const bucketTagSets = buckets.map((b) => new Set(b.tags.map((t) => t.toLowerCase())));
  return answers.map((a) => {
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
}

/** Map each answer to ONE bucket id: its tag-overlap bucket (overlapTargets).
 *  Answers with no overlap are then filled from the UNUSED buckets in order (so
 *  distinct coverage maximises), and finally positionally (j % len) — every
 *  answer always gets a target when any bucket exists. */
export function mapAnswersToTargets(
  answers: readonly { tags: readonly string[] }[],
  buckets: readonly MappingBucket[],
): string[] {
  if (buckets.length === 0) return [];
  const mapped = overlapTargets(answers, buckets);
  const used = new Set(mapped.filter((m): m is string => m !== null));
  const unused = buckets.filter((b) => !used.has(b.id)).map((b) => b.id);
  let u = 0;
  return mapped.map((m, j) =>
    m !== null ? m : u < unused.length ? unused[u++]! : buckets[j % buckets.length]!.id,
  );
}

/** Pick the DECIDING question among eligible questions (never freeform,
 *  mirroring setQuestionRole's refusal; a multi-select may decide). Ranked by,
 *  in order:
 *   1. the generator's own role "decides" mark, when that question can
 *      separate at least two targets — the question was planned and written
 *      as the decider, one answer per bucket;
 *   2. the most DISTINCT targets its answers reach through real tag overlap;
 *   3. the most distinct targets after mapAnswersToTargets' fill.
 *  Ties → earliest in the flow. Returns -1 when no question is eligible.
 *
 *  The fill is the LAST key on purpose: it hands any untagged question with
 *  enough answers full coverage, so ranked first it let an untagged question
 *  placed ahead of the real decider win the tie and route shoppers by answer
 *  position. */
export function pickDeciderIndex(
  questions: readonly {
    question_type: string;
    role?: string;
    answers: readonly { tags: readonly string[] }[];
  }[],
  buckets: readonly MappingBucket[],
): number {
  let bestIdx = -1;
  let best: readonly number[] = [];
  questions.forEach((q, i) => {
    // QWIDGET decision 2 — multi-select may decide; freeform still cannot.
    if (isFreeformType(q.question_type)) return;
    const filled = new Set(mapAnswersToTargets(q.answers, buckets)).size;
    if (filled === 0) return;
    const matched = new Set(overlapTargets(q.answers, buckets).filter((m) => m !== null)).size;
    const score = [q.role === "decides" && filled >= 2 ? 1 : 0, matched, filled];
    const firstDiff = score.findIndex((part, k) => part !== best[k]);
    if (bestIdx === -1 || (firstDiff !== -1 && score[firstDiff]! > best[firstDiff]!)) {
      bestIdx = i;
      best = score;
    }
  });
  return bestIdx;
}
