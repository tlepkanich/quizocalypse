// Logic step redesign (D3, D19, B11/B12/B14) — THE per-rule status. The
// check report (V7/V8/V9 + the Rules-only blocks), every rule row's tag, the
// Table and the recommendation coverage helper all read this one
// computation, so a rule tagged "never runs" always has a matching finding
// with the same words.
//
// Two layers, mirroring the mock:
//   · neverRuns — ONE reason per rule (mock `deadCalc`, wording verbatim),
//     in order: incomplete → impossible all-of → shadowed by earlier rules.
//     Rendered as the tag "never runs · <why>" (neverRunsTag).
//   · flags — the live reasons D19 keeps beside it: a broken reference
//     (deleted answer/question — `brokenRuleRefs` semantics), a question no
//     shopper reaches / answers never on one path (`deadRuleReasons`), a
//     deleted recommendation, and "fires for everyone" (`overbroadRules`).
// Pure; built on pathAnalyzer (which evaluates with ruleConditionsMatch).
import type { Quiz } from "./quizSchema";
import {
  deadRuleReasons,
  impossibleAllOf,
  joinList,
  overbroadRules,
  shadowingRules,
} from "./pathAnalyzer";
import { orderedQuestions } from "./questionOrder";
import { ruleTargets } from "./recommendDecider";

export type RuleNeverRunsReason = "incomplete" | "impossible" | "shadowed";

export type RuleFlagKind =
  /** an `is` condition on a deleted answer/question — the rule can never fire */
  | "broken_never"
  /** only `is not` conditions are broken — that group now matches everyone */
  | "broken_always"
  /** match-any rule: a broken `is` kills one group; the others still run */
  | "broken_partial"
  /** V7: an `is` question no shopper reaches */
  | "unreachable"
  /** V7: two `is` questions on paths that never meet */
  | "exclusive"
  /** some (not all) of its recommendations were deleted */
  | "target_deleted"
  /** a match-any rule with an is-not-only group (overbroadRules) */
  | "fires_for_everyone";

export interface RuleFlag {
  kind: RuleFlagKind;
  /** Tag-style fragment, lowercase, no em dash (e.g. "fires for everyone"). */
  text: string;
}

export interface RuleStatus {
  ruleId: string;
  /** 1-based position = priority. */
  number: number;
  /** The mock's deadWhy text ("no answers left", "rule 2 catches them
   *  first", …) or null when nothing says it never runs. */
  neverRuns: string | null;
  reason: RuleNeverRunsReason | null;
  /** What an incomplete rule is missing (both false when complete). */
  missing: { answers: boolean; recommendations: boolean };
  /** The impossible all-of group, when that is the reason. */
  impossible: {
    questionId: string;
    /** Flow-order question number (the rail's), null if not found. */
    qNumber: number | null;
    needs: number;
    canPick: number;
  } | null;
  /** 1-based positions of the earlier rules that catch everyone first. */
  shadowedBy: number[];
  flags: RuleFlag[];
  /** True when the rule can put its recommendations in front of some
   *  shopper: no neverRuns reason and no flag that makes it unmatchable
   *  (broken_never, unreachable, exclusive). */
  canRun: boolean;
}

const FLAG_TEXT: Record<RuleFlagKind, string> = {
  broken_never: "uses a deleted answer, so it never runs",
  broken_always: "uses a deleted answer, so it now matches every shopper",
  broken_partial: "uses a deleted answer",
  unreachable: "needs a question no shopper reaches",
  exclusive: "two of its answers are never on the same path",
  target_deleted: "shows a deleted recommendation",
  fires_for_everyone: "fires for everyone",
};

const BLOCKS_RUNNING: ReadonlySet<RuleFlagKind> = new Set([
  "broken_never",
  "unreachable",
  "exclusive",
]);

/** Every rule's status, keyed by rule id (insertion order = rule order).
 *  `knownTargetIds` = the recommendation (Category) ids that exist; when
 *  given, a rule whose targets are ALL unknown is incomplete ("no
 *  recommendation left") and a partly-unknown one carries target_deleted.
 *  Omit it and targets are never judged. Decider-only by call site; a doc
 *  without rules returns an empty map. */
export function ruleStatuses(
  doc: Quiz,
  knownTargetIds?: Iterable<string>,
): Map<string, RuleStatus> {
  const rules = doc.decision_rules ?? [];
  const out = new Map<string, RuleStatus>();
  if (rules.length === 0) return out;
  const known = knownTargetIds ? new Set(knownTargetIds) : null;
  const qNumber = new Map(orderedQuestions(doc).map((q) => [q.node.id, q.qIndex]));

  const answersByQuestion = new Map<string, Set<string>>();
  for (const n of doc.nodes) {
    if (n.type === "question") {
      answersByQuestion.set(n.id, new Set(n.data.answers.map((a) => a.id)));
    }
  }
  const dead = new Map(deadRuleReasons(doc).map((d) => [d.ruleId, d.reason]));
  const overbroad = new Set(overbroadRules(doc).map((f) => f.ruleId));

  rules.forEach((rule, i) => {
    const flags: RuleFlag[] = [];
    const flag = (kind: RuleFlagKind) => flags.push({ kind, text: FLAG_TEXT[kind] });

    const broken = rule.conditions.filter(
      (c) => !answersByQuestion.get(c.question_id)?.has(c.answer_id),
    );
    if (broken.length > 0) {
      // brokenRuleRefs semantics: any broken is_not → matches everyone; a
      // broken `is` alone → never fires. Under match:"all" a broken `is`
      // kills the rule even beside a broken is_not.
      const brokenIs = broken.some((c) => c.op === "is");
      const brokenNot = broken.some((c) => c.op === "is_not");
      if (rule.match !== "any") {
        flag(brokenIs ? "broken_never" : "broken_always");
      } else if (brokenNot) {
        flag("broken_always");
      } else {
        // match any: a broken `is` kills only its own group.
        const groups = new Set(rule.conditions.map((c) => c.question_id));
        const deadGroups = new Set(broken.map((c) => c.question_id));
        flag(deadGroups.size === groups.size ? "broken_never" : "broken_partial");
      }
    }
    const deadReason = dead.get(rule.id);
    if (deadReason) flag(deadReason);

    const targets = ruleTargets(rule);
    const missingTargets = known ? targets.filter((t) => !known.has(t)) : [];
    const noRecs = known !== null && missingTargets.length === targets.length;
    if (missingTargets.length > 0 && !noRecs) flag("target_deleted");
    if (overbroad.has(rule.id)) flag("fires_for_everyone");

    const noAnswers = rule.conditions.length === 0;
    let neverRuns: string | null = null;
    let reason: RuleNeverRunsReason | null = null;
    let impossible: RuleStatus["impossible"] = null;
    let shadowedBy: number[] = [];

    if (noAnswers || noRecs) {
      reason = "incomplete";
      neverRuns = `no ${
        noAnswers && noRecs ? "answers or recommendation" : noAnswers ? "answers" : "recommendation"
      } left`;
    } else {
      const imp = impossibleAllOf(rule, doc);
      if (imp) {
        const n = qNumber.get(imp.questionId) ?? null;
        reason = "impossible";
        impossible = { ...imp, qNumber: n };
        neverRuns = `needs more ${n !== null ? `Q${n}` : "of its"} answers than they can pick`;
      } else {
        const by = shadowingRules(doc, i);
        if (by) {
          shadowedBy = by.map((j) => j + 1);
          reason = "shadowed";
          neverRuns = `rule${shadowedBy.length > 1 ? "s" : ""} ${joinList(shadowedBy)} catch${
            shadowedBy.length > 1 ? "" : "es"
          } them first`;
        }
      }
    }

    out.set(rule.id, {
      ruleId: rule.id,
      number: i + 1,
      neverRuns,
      reason,
      missing: { answers: noAnswers, recommendations: noRecs },
      impossible,
      shadowedBy,
      flags,
      canRun: neverRuns === null && !flags.some((f) => BLOCKS_RUNNING.has(f.kind)),
    });
  });
  return out;
}

/** The single tag a rule row / Table cell shows (mock `deadTag`):
 *  "never runs · <why>", or null. */
export function neverRunsTag(status: Pick<RuleStatus, "neverRuns"> | undefined): string | null {
  return status?.neverRuns ? `never runs · ${status.neverRuns}` : null;
}
