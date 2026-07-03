// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-12c) — advisory path-quality provenance. When the merchant runs
// the AI quality review, the doc stores WHEN it ran and a hash of the OUTCOME
// STRUCTURE it judged, so the panel can flag the advice STALE after the logic
// changes (an answer remap, a rule add/delete). CLIENT-SAFE pure TS (the panel
// recomputes the current hash) — no node:crypto, mirrors whyCopyMeta.ts.
//
// The hash covers the STABLE identity of each outcome (kind + id + targetId),
// NOT the human-readable label — so a cosmetic answer-text edit doesn't
// spuriously mark the advice stale, but a remap/add/delete of a decider answer
// or a rule (which is what the AI actually judged) does.
// ════════════════════════════════════════════════════════════════════════════
import { outcomeTable, type OutcomeRow } from "./pathAnalyzer";
import type { Quiz as QuizDoc } from "./quizSchema";

/** Order-insensitive FNV-1a over a canonical string, hex-encoded (the exact
 *  whyCopyMeta.membershipHash algorithm, so both files stay in lockstep). */
function fnv1a(canonical: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The canonical fingerprint of one outcome — its stable routing identity,
 *  label EXCLUDED (a label edit is cosmetic; a remap/add/delete is not). */
function outcomeKey(row: OutcomeRow): string {
  return `${row.kind}␟${row.id}␟${row.targetId ?? ""}`;
}

/** Hash the outcome-table STRUCTURE the advisory rows judged. */
export function pathReportHash(doc: QuizDoc): string {
  const canonical = outcomeTable(doc).map(outcomeKey).sort().join("\n");
  return fnv1a(canonical);
}

/** Stale = a report snapshot exists but the current outcome-structure hash no
 *  longer matches. A never-generated report is never "stale" (mirrors
 *  isWhyCopyStale). */
export function isPathReportStale(
  meta: { hash: string } | undefined,
  currentHash: string,
): boolean {
  return Boolean(meta) && meta!.hash !== currentHash;
}
