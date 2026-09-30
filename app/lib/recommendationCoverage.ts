// Logic step redesign (B10/B41, D3) — THE per-recommendation coverage
// helper (mock `showsRecs` / `rulesShowing` / `recMapped` / `recCovered`).
// The recommendations strip, the rule window band, the Table's "Shown by
// rules" and the "“X” is never recommended" finding all read this, so they
// can never disagree. Pure.
//
// A rule SHOWS its targets when it can run (ruleStatus.canRun: complete,
// possible, not shadowed, not broken, reachable) AND its verb adds under
// the style:
//   · Rules only — the first matching rule's targets ARE the result, so an
//     action-less, show or prioritize rule shows them. A stored hide shows
//     NOTHING: the engine resolves a first-matching hide to no target (D1),
//     so it never counts (the mock's effVerb reads it as Show only because
//     the window re-saves it as Show).
//   · Filter Results + Rules — only show and the legacy action-less replace
//     add products; prioritize only reorders, hide removes (applyRuleAction).
//     D2 is still OPEN for this style (Show appends after the base and the
//     results cap can hide it): the predicate is `filterStyleVerbAdds`, one
//     marked place a second condition can join later.
// `mapped` (Filter Results + Rules only): a picking-question answer targets
// it (answerTargets). In Rules only mappings are never read, so always false.
import type { DecisionRule, Quiz } from "./quizSchema";
import type { LogicStyle } from "./logicStyle";
import { answerTargets, ruleTargets } from "./recommendDecider";
import { ruleStatuses, type RuleStatus } from "./ruleStatus";

export interface RecCoverage {
  /** 1-based positions of the rules that can show this recommendation. */
  rulesShowing: number[];
  /** Filter Results + Rules: an answer of the picking question lists it. */
  mapped: boolean;
  /** mapped || rulesShowing.length > 0 */
  covered: boolean;
}

/** D2 (OPEN, Filter Results + Rules only) — whether a rule's verb puts its
 *  products into the result. Kept as its own predicate so the owner's D2
 *  ruling can add a second condition without touching the Rules-only
 *  branch. */
export function filterStyleVerbAdds(rule: Pick<DecisionRule, "action">): boolean {
  return rule.action === undefined || rule.action === "show";
}

/** Whether a rule shows its recommendations under `style`, given its
 *  status (a rule that cannot run shows nothing). */
export function ruleShowsRecommendations(
  rule: Pick<DecisionRule, "action">,
  status: Pick<RuleStatus, "canRun"> | undefined,
  style: LogicStyle,
): boolean {
  if (!status?.canRun) return false;
  return style === "rules" ? rule.action !== "hide" : filterStyleVerbAdds(rule);
}

/** Coverage for every id in `categoryIds` (pass the quiz-scoped
 *  recommendations — Category rows with quizId set). `statuses` defaults to
 *  ruleStatuses(doc) (targets not judged: a deleted target is simply not in
 *  `categoryIds`). */
export function recommendationCoverage(
  doc: Quiz,
  style: LogicStyle,
  categoryIds: readonly string[],
  statuses: ReadonlyMap<string, RuleStatus> = ruleStatuses(doc),
): Map<string, RecCoverage> {
  const rules = doc.decision_rules ?? [];
  const showing = new Map<string, number[]>();
  rules.forEach((rule, i) => {
    if (!ruleShowsRecommendations(rule, statuses.get(rule.id), style)) return;
    for (const t of new Set(ruleTargets(rule))) {
      const list = showing.get(t) ?? [];
      list.push(i + 1);
      showing.set(t, list);
    }
  });
  const mappedIds = new Set<string>();
  if (style === "attributes") {
    for (const n of doc.nodes) {
      if (n.type !== "question" || n.data.role !== "decides") continue;
      for (const a of n.data.answers) for (const t of answerTargets(a)) mappedIds.add(t);
    }
  }
  const out = new Map<string, RecCoverage>();
  for (const id of categoryIds) {
    const rulesShowing = showing.get(id) ?? [];
    const mapped = mappedIds.has(id);
    out.set(id, { rulesShowing, mapped, covered: mapped || rulesShowing.length > 0 });
  }
  return out;
}
