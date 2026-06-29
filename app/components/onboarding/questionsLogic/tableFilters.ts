import type { Answer } from "../../../lib/quizSchema";
import { answerBucketId, isAnswerMapped } from "./questionOrder";

// Questions & Logic spec §4 — the Table-view filter bar. "" = all rows,
// "gap" = answers with no bucket (the shared unmapped predicate, so the Table
// filter, the left-panel amber dot, and the Outcome-coverage pills agree),
// any other value = a specific bucket id.
export const GAP_FILTER = "gap";
export type TableFilter = string; // "" | "gap" | bucketId

export function answerPassesFilter(answer: Answer, filter: TableFilter): boolean {
  if (!filter) return true;
  if (filter === GAP_FILTER) return !isAnswerMapped(answer);
  return answerBucketId(answer) === filter;
}
