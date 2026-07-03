// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-12c) — the ADVISORY path-quality grounding builder. Turns the
// deterministic outcome table into a compact, human-readable list the AI can
// judge: for each reachable, mapped outcome — the path (answer text, or a rule
// with its conditions resolved to question/answer TEXT), the recommendation
// target's name, its effective why-copy, and a small product sample.
//
// PURE + injected (product titles passed in) so it's unit-testable and never
// touches pathReport.ts — the advisory pass is a SEPARATE code path by the
// spec's hard line, so the Tier-1 report stays byte-identical.
// ════════════════════════════════════════════════════════════════════════════
import type { Quiz as QuizDoc } from "./quizSchema";
import { outcomeTable } from "./pathAnalyzer";
import { settingsForTarget } from "./recommendDecider";

/** One outcome handed to the AI — everything server-derived, no client input. */
export interface PathQualityOutcome {
  /** = OutcomeRow.id (a decider answer id or a rule id) — the row anchor. */
  outcome_id: string;
  /** Human-readable path: the answer text, or the rule's resolved conditions. */
  path: string;
  /** The recommendation target (bucket) name. */
  target: string;
  /** The effective (override-merged) why-copy shown for this target. */
  whyCopy: string;
  /** A small sample of the target's product titles (grounding). */
  products: string[];
}

const PRODUCT_SAMPLE_CAP = 8;

/**
 * Build the AI grounding list from the draft doc + its buckets. Includes only
 * REACHABLE, MAPPED outcomes (an unmapped or dead outcome has no recommendation
 * to judge — Tier-1 already flags those). `productTitleById` resolves a bucket's
 * member ids to titles (the route supplies it from the synced catalog).
 */
export function buildPathQualityOutcomes(
  doc: QuizDoc,
  categories: readonly { id: string; name: string; productIds: readonly string[] }[],
  productTitleById: ReadonlyMap<string, string>,
): PathQualityOutcome[] {
  const catById = new Map(categories.map((c) => [c.id, c]));

  // answerId → text and questionId → text, for resolving rule conditions.
  const answerText = new Map<string, string>();
  const questionText = new Map<string, string>();
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    questionText.set(n.id, n.data.text);
    for (const a of n.data.answers) answerText.set(a.id, a.text);
  }

  const outcomes: PathQualityOutcome[] = [];
  for (const row of outcomeTable(doc)) {
    if (!row.reachable || !row.targetId) continue; // nothing to judge
    const cat = catById.get(row.targetId);
    if (!cat) continue; // dangling target — Tier-1's V4/V5 owns this

    const cfg = settingsForTarget(doc.rec_page_settings, row.targetId);
    const products = cat.productIds
      .map((id) => productTitleById.get(id))
      .filter((t): t is string => Boolean(t))
      .slice(0, PRODUCT_SAMPLE_CAP);

    const path =
      row.kind === "rule"
        ? resolveRuleConditions(doc, row.id, questionText, answerText)
        : row.label; // mapping label is already the answer text

    outcomes.push({
      outcome_id: row.id,
      path,
      target: cat.name,
      whyCopy: cfg.whyCopy,
      products,
    });
  }
  return outcomes;
}

/** Render a rule's conditions to plain language ("[Question] is [Answer] and …"),
 *  falling back to raw ids only if a referenced node/answer was deleted. */
function resolveRuleConditions(
  doc: QuizDoc,
  ruleId: string,
  questionText: ReadonlyMap<string, string>,
  answerText: ReadonlyMap<string, string>,
): string {
  const rule = (doc.decision_rules ?? []).find((r) => r.id === ruleId);
  if (!rule || rule.conditions.length === 0) return "(rule)";
  return rule.conditions
    .map((c) => {
      const q = questionText.get(c.question_id) ?? "a question";
      const a = answerText.get(c.answer_id) ?? "an answer";
      return c.op === "is" ? `${q} is “${a}”` : `${q} is not “${a}”`;
    })
    .join(" and ");
}
