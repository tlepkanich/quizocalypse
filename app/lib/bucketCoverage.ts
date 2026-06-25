import type { Quiz } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

// Question-Builder spec — Bucket Coverage Indicator. Counts how many answers
// across the quiz point at each bucket, then classifies coverage so the editor
// can warn about thinly-covered buckets (green/yellow/red pills).
//
// An answer "covers" a bucket when either:
//   • its tags overlap the bucket's tags (case-insensitive), or
//   • it carries a points entry for the bucket's category id.
// Classification is RELATIVE to the best-covered bucket (the spec's rule:
// "weak" = under 50% of the top bucket's coverage):
//   none   — zero answers point at it
//   weak   — covered, but < 50% of the top bucket's count
//   strong — ≥ 50% of the top bucket's count
export type CoverageLevel = "none" | "weak" | "strong";

export interface BucketCoverage {
  id: string;
  name: string;
  count: number;
  level: CoverageLevel;
}

export interface CoverageBucket {
  id: string;
  name: string;
  tags: string[];
}

export function computeBucketCoverage(
  doc: QuizDoc,
  buckets: CoverageBucket[],
): BucketCoverage[] {
  // Pre-lowercase each bucket's tags once.
  const bucketTags = buckets.map((b) => ({
    ...b,
    tagSet: new Set(b.tags.map((t) => t.toLowerCase())),
  }));

  const counts = new Map<string, number>(buckets.map((b) => [b.id, 0]));
  for (const node of doc.nodes) {
    if (node.type !== "question") continue;
    for (const answer of node.data.answers) {
      const answerTags = answer.tags.map((t) => t.toLowerCase());
      for (const b of bucketTags) {
        const byTag = answerTags.some((t) => b.tagSet.has(t));
        const byPoints = answer.points ? b.id in answer.points : false;
        if (byTag || byPoints) counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
      }
    }
  }

  const top = Math.max(0, ...counts.values());
  return buckets.map((b) => {
    const count = counts.get(b.id) ?? 0;
    const level: CoverageLevel =
      count === 0 ? "none" : top > 0 && count < top * 0.5 ? "weak" : "strong";
    return { id: b.id, name: b.name, count, level };
  });
}
