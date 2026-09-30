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
import { answerTargets, ruleTargets } from "./recommendDecider";
import { engineLogicStyle } from "./logicStyle";

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

/** Hash the outcome-table STRUCTURE the advisory rows judged. Logic-step §3
 *  widened rule semantics (conditions, match, any_of) — a semantics-only rule
 *  edit changes routing without changing any outcomeKey, so the rules' own
 *  matching shape joins the digest (a stale AI review must be marked stale). */
export function pathReportHash(doc: QuizDoc): string {
  const canonical = outcomeTable(doc).map(outcomeKey).sort().join("\n");
  const ruleShapes = (doc.decision_rules ?? [])
    .map(
      (r) =>
        `${r.id}␟${r.match ?? "all"}␟${(r.any_of ?? []).join(",")}␟` +
        r.conditions.map((c) => `${c.question_id} ${c.answer_id} ${c.op}`).join("|"),
    )
    .sort()
    .join("\n");
  // Logic step (D11/D1) — ORDER is priority (a ↑/↓ reorder changes which
  // rule wins), the verb changes what a match does, every target (not only
  // target_id) and every picking answer's full target list are routing, and
  // the same rules under the two styles decide differently. All join the
  // digest, so each marks a stored AI review stale. (Every stored review
  // reads stale once after this lands — expected.)
  const ruleOrder = (doc.decision_rules ?? [])
    .map((r, i) => `${i}␟${r.id}␟${r.action ?? ""}␟${ruleTargets(r).join(",")}`)
    .join("\n");
  const answerTargetKeys = doc.nodes
    .flatMap((n) =>
      n.type === "question" && n.data.role === "decides"
        ? n.data.answers.map((a) => `${a.id}␟${answerTargets(a).join(",")}`)
        : [],
    )
    .sort()
    .join("\n");
  return fnv1a(
    `${canonical}\n␞\n${ruleShapes}\n␞\n${ruleOrder}\n␞\n${answerTargetKeys}\n␞\n${engineLogicStyle(doc) === "rules" ? "rules" : ""}`,
  );
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
