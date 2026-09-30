import type { z } from "zod";
import type { DecisionRule, Quiz } from "./quizSchema";
import { ruleConditionsMatch } from "./recommendDecider";

type QuizDoc = z.infer<typeof Quiz>;

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 Tier-1 path analyzer (quiz-questions-logic-spec §6/§7.1) — the
// DETERMINISTIC structure/validity engine behind "Test all paths". No AI, by
// spec mandate: correctness checks need exhaustive, reliable graph analysis.
//
// Everything is POLYNOMIAL graph reachability — never cartesian enumeration.
// The spec's "every reachable answer combination" is satisfied because the
// checks reduce to per-answer/per-rule reachability questions:
//  · pickability      — an answer is offerable iff its question is reachable
//  · answer-level V2  — does an answer's DOWNSTREAM route still hit the decider
//  · V7 dead rules    — condition answers pickable + condition questions
//                       pairwise co-reachable (ancestor/descendant heuristic)
//  · V8 shadowing     — pairwise condition-set subset tests (pure set logic)
//  · outcome table    — one row per deciding answer + per rule (linear)
//
// Consumed by the L2-6 Rules tab + the L2-7 "Test all paths" report UI. Pure
// module — it rides in the questions-logic bundle, but every call site is
// decider-gated, so legacy docs never execute it.
// ════════════════════════════════════════════════════════════════════════════

// ── graph primitives (mirroring resolveNextStep's edge semantics) ───────────

/** All outbound targets of a node: every explicit per-answer/slot edge plus
 *  the default (handle-less) edge. Static analysis follows all of them. */
function outboundTargets(doc: QuizDoc, nodeId: string): string[] {
  return doc.edges.filter((e) => e.source === nodeId).map((e) => e.target);
}

/** The runtime's next node for ONE answer: its explicit source_handle edge,
 *  else the question's default edge (the resolveNextStep contract). */
export function answerNextNode(
  doc: QuizDoc,
  questionId: string,
  answerHandle: string,
): string | null {
  const explicit = doc.edges.find(
    (e) => e.source === questionId && e.source_handle === answerHandle,
  );
  if (explicit) return explicit.target;
  const fallback = doc.edges.find((e) => e.source === questionId && !e.source_handle);
  return fallback?.target ?? null;
}

/** Nodes reachable from `startId` following every outbound edge (cycle-safe). */
export function reachableNodeIds(doc: QuizDoc, startId: string): Set<string> {
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...outboundTargets(doc, id));
  }
  return seen;
}

function introId(doc: QuizDoc): string | null {
  return doc.nodes.find((n) => n.type === "intro")?.id ?? null;
}

function deciderOf(doc: QuizDoc) {
  const q = doc.nodes.find((n) => n.type === "question" && n.data.role === "decides");
  return q && q.type === "question" ? q : null;
}

// ── answer-level reachability ───────────────────────────────────────────────

/** answerId → is this answer OFFERABLE to some shopper (its question is
 *  reachable from the intro)? Every answer on a rendered question is pickable;
 *  the interesting granularity is what happens AFTER the pick (below). */
export function answersReachable(doc: QuizDoc): Map<string, boolean> {
  const intro = introId(doc);
  const reachable = intro ? reachableNodeIds(doc, intro) : new Set<string>();
  const out = new Map<string, boolean>();
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    const questionReachable = reachable.has(n.id);
    for (const a of n.data.answers) out.set(a.id, questionReachable);
  }
  return out;
}

/** BFS from `startId` that reaches `stopId` but never traverses BEYOND it —
 *  the dominator-walk primitive shared with the publish gate's V2 check. */
function stopAtWalk(doc: QuizDoc, startId: string, stopId: string): Set<string> {
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === stopId) continue; // reach it, never pass beyond it
    queue.push(...outboundTargets(doc, id));
  }
  return seen;
}

function isTerminalNode(doc: QuizDoc, id: string): boolean {
  const n = doc.nodes.find((x) => x.id === id);
  return n?.type === "result" || n?.type === "end";
}

/** answerId → does picking this answer still lead THROUGH the decider before
 *  the quiz ends? This is V2 at answer granularity, with the SAME dominator
 *  semantics as the publish gate (quizValidation V2): an answer is a BYPASS
 *  (false) only when (a) its question sits in the PRE-decider region — the
 *  intro's stop-at-decider walk — and (b) its own continuation, again never
 *  traversing beyond the decider, can still hit a result/end terminal (branch
 *  lanes included — the walk follows every outbound edge). Answers on the
 *  decider itself, on POST-decider questions (already answered it), or on
 *  unreachable questions (the gate's structural orphan checks own those) are
 *  all true. The prior forward-reachability EXISTS test was wrong on both
 *  sides of the decider — review-caught in L2-7. */
export function answersReachDecider(doc: QuizDoc): Map<string, boolean> {
  const decider = deciderOf(doc);
  const intro = introId(doc);
  const out = new Map<string, boolean>();
  if (!decider) return out;
  const preRegion = intro ? stopAtWalk(doc, intro, decider.id) : new Set<string>();
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    for (const a of n.data.answers) {
      if (n.id === decider.id || !preRegion.has(n.id)) {
        out.set(a.id, true);
        continue;
      }
      const next = answerNextNode(doc, n.id, a.edge_handle_id);
      if (next === null) {
        out.set(a.id, true); // dead-end — a structural issue, not a bypass
        continue;
      }
      const walk = stopAtWalk(doc, next, decider.id);
      out.set(a.id, ![...walk].some((id) => isTerminalNode(doc, id)));
    }
  }
  return out;
}

// ── rule diagnostics (V7/V8/V9) ─────────────────────────────────────────────

export interface RuleFinding {
  ruleId: string;
  message: string;
}

/** §9 — conditions referencing a DELETED question or answer. The engine's
 *  set-membership test makes the two ops diverge sharply on a broken ref:
 *  `is <missing>` can never be satisfied (the rule never fires), while
 *  `is_not <missing>` is VACUOUSLY TRUE for every shopper (the rule would fire
 *  for everyone, overriding everything below it). V6 blocks publish either
 *  way; this per-rule finding lets the Rules tab say WHICH it is instead of
 *  showing a confident match-% for a rule the engine treats very differently. */
export function brokenRuleRefs(doc: QuizDoc): RuleFinding[] {
  const answersByQuestion = new Map<string, Set<string>>();
  for (const n of doc.nodes) {
    if (n.type === "question") {
      answersByQuestion.set(n.id, new Set(n.data.answers.map((a) => a.id)));
    }
  }
  const findings: RuleFinding[] = [];
  for (const rule of doc.decision_rules ?? []) {
    const broken = rule.conditions.filter((c) => !answersByQuestion.get(c.question_id)?.has(c.answer_id));
    if (broken.length === 0) continue;
    const anyIsNot = broken.some((c) => c.op === "is_not");
    findings.push({
      ruleId: rule.id,
      message: anyIsNot
        ? "A condition references a deleted question/answer — as written it would match EVERY shopper. Fix it before publishing (publish is blocked)."
        : "A condition references a deleted question/answer — this rule can never fire. Fix it before publishing (publish is blocked).",
    });
  }
  return findings;
}

/** V9 (WARN) — zero-condition rules never fire (the engine skips them). */
export function halfBuiltRules(doc: QuizDoc): RuleFinding[] {
  return (doc.decision_rules ?? [])
    .filter((r) => r.conditions.length === 0)
    .map((r) => ({
      ruleId: r.id,
      message: "This rule has no conditions yet — it never fires.",
    }));
}

/** V7 (WARN, documented heuristic) — a rule is DEAD when some/all shoppers can
 *  never satisfy it: an `is` condition's question is unreachable, or two `is`
 *  condition questions never co-occur on a path (neither reaches the other —
 *  the ancestor/descendant test; parallel branch lanes are the classic case).
 *  `is_not` conditions are satisfiable without visiting the question (skipped
 *  = "answer is not X"), so they never dead-rule. Heuristic: rare topologies
 *  can slip through — acceptable because V7 never blocks.
 *
 *  match:"any" rules are SKIPPED (handoff §11 discipline): one dead group no
 *  longer kills the rule, so both tests above would be false warnings. A
 *  false "never fires" on a working rule is worse than a missed warning. */
export function deadRules(doc: QuizDoc): RuleFinding[] {
  return deadRuleReasons(doc).map((d) => ({
    ruleId: d.ruleId,
    message:
      d.reason === "unreachable"
        ? "A condition depends on a question no shopper can reach — this rule can never fire."
        : "Two of this rule's conditions live on paths that never co-occur — no shopper can match both.",
  }));
}

/** deadRules' structured form (Logic step: the rule status renders its own
 *  copy): "unreachable" = an `is` question no shopper reaches; "exclusive" =
 *  two `is` questions on paths that never co-occur. Same skips as deadRules. */
export function deadRuleReasons(
  doc: QuizDoc,
): Array<{ ruleId: string; reason: "unreachable" | "exclusive" }> {
  const intro = introId(doc);
  const reachable = intro ? reachableNodeIds(doc, intro) : new Set<string>();
  const findings: Array<{ ruleId: string; reason: "unreachable" | "exclusive" }> = [];

  for (const rule of doc.decision_rules ?? []) {
    if (rule.match === "any") continue;
    const isQuestions = [
      ...new Set(
        rule.conditions.filter((c) => c.op === "is").map((c) => c.question_id),
      ),
    ];
    const unreachable = isQuestions.find((qid) => !reachable.has(qid));
    if (unreachable) {
      findings.push({ ruleId: rule.id, reason: "unreachable" });
      continue;
    }
    // Pairwise co-reachability: for every pair of `is` questions, one must be
    // downstream of the other (else they sit on mutually exclusive lanes).
    let dead = false;
    for (let i = 0; i < isQuestions.length && !dead; i++) {
      for (let j = i + 1; j < isQuestions.length && !dead; j++) {
        const a = isQuestions[i]!;
        const b = isQuestions[j]!;
        const aReachesB = reachableNodeIds(doc, a).has(b);
        const bReachesA = reachableNodeIds(doc, b).has(a);
        if (!aReachesB && !bReachesA) dead = true;
      }
    }
    if (dead) findings.push({ ruleId: rule.id, reason: "exclusive" });
  }
  return findings;
}

/** V8 (WARN) — "never runs": rule i can never fire because every shopper
 *  who can match it matches an EARLIER rule first (first-match-wins,
 *  whatever the earlier rule's action). One finding per shadowed rule,
 *  naming the single earlier rule that catches everyone when one suffices,
 *  else the union (the shopper-set walk, `shadowingRules`). Sound, never
 *  optimistic: a false "never fires" on a working rule is worse than a
 *  missed one. match:"any" rules are never flagged here (handoff §11). */
export function shadowedRules(doc: QuizDoc): RuleFinding[] {
  const rules = doc.decision_rules ?? [];
  const findings: RuleFinding[] = [];
  rules.forEach((rule, i) => {
    const by = shadowingRules(doc, i);
    if (!by) return;
    const nums = by.map((j) => j + 1);
    findings.push({
      ruleId: rule.id,
      message:
        nums.length === 1
          ? `Rule ${nums[0]} always fires first for any shopper this rule would match — this rule can never fire.`
          : `Rules ${joinList(nums)} always fire first for any shopper this rule would match — this rule can never fire.`,
    });
  });
  return findings;
}

/** "1", "1 and 2", "1, 3 and 4" — the mock's nlist. */
export function joinList(items: ReadonlyArray<string | number>): string {
  const a = items.map(String);
  return a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : (a[0] ?? "");
}

// ── Logic step — the shadow walk and the impossible all-of (B12/B14) ────────

/** Above this many candidate answer combinations the walk gives up and
 *  flags nothing (sound but silent — the mock's cap). */
export const SHADOW_WALK_CAP = 200_000;
/** A multi-select naming more answers than this would enumerate 2^k subsets
 *  before the cap could bite — treated as over the cap. */
const MAX_NAMED_MULTI = 16;

/** A question is ALWAYS answered when it is required and no route from the
 *  intro can reach a result/end without passing it (the V2 stop-at walk). A
 *  doc without an intro is conservatively "not always answered". */
export function questionAlwaysAnswered(doc: QuizDoc, questionId: string): boolean {
  const node = doc.nodes.find((n) => n.id === questionId);
  if (!node || node.type !== "question") return false;
  if (node.data.required === false) return false;
  const intro = introId(doc);
  if (!intro) return false;
  const walk = stopAtWalk(doc, intro, questionId);
  return ![...walk].some((id) => id !== questionId && isTerminalNode(doc, id));
}

type QuestionNodeT = Extract<QuizDoc["nodes"][number], { type: "question" }>;

/** How many answers a shopper can pick on this question at most. */
function maxPicks(q: QuestionNodeT): number {
  const n = q.data.answers.length;
  if (q.data.question_type !== "multi_select") return Math.min(1, n);
  return Math.max(1, Math.min(n, q.data.max_selections ?? n));
}

/** An "all of" `is` group (question NOT in any_of, 2+ live answers) asking
 *  for more answers than the question lets a shopper pick: more than
 *  max_selections on a multi-select, or 2+ on any one-answer type. Such a
 *  group can never hold. Under match:"any" the rule is impossible only when
 *  EVERY group is. Returns the first impossible group, or null. */
export function impossibleAllOf(
  rule: Pick<DecisionRule, "conditions" | "any_of" | "match">,
  doc: QuizDoc,
): { questionId: string; needs: number; canPick: number } | null {
  const anyOf = new Set(rule.any_of ?? []);
  const groupIds = [...new Set(rule.conditions.map((c) => c.question_id))];
  const found: Array<{ questionId: string; needs: number; canPick: number }> = [];
  for (const qid of groupIds) {
    const node = doc.nodes.find((n) => n.id === qid);
    if (!node || node.type !== "question" || anyOf.has(qid)) continue;
    const live = new Set(node.data.answers.map((a) => a.id));
    const needs = new Set(
      rule.conditions
        .filter((c) => c.question_id === qid && c.op === "is" && live.has(c.answer_id))
        .map((c) => c.answer_id),
    ).size;
    const canPick = maxPicks(node);
    if (needs >= 2 && needs > canPick) found.push({ questionId: qid, needs, canPick });
  }
  if (found.length === 0) return null;
  if (rule.match === "any" && found.length < groupIds.length) return null;
  return found[0]!;
}

/** One question group of `rule` judged on its own — ruleConditionsMatch on
 *  that group alone (the predicate's own groupOk, never re-derived). */
function groupHolds(rule: DecisionRule, questionId: string, picked: ReadonlySet<string>): boolean {
  const conditions = rule.conditions.filter((c) => c.question_id === questionId);
  if (conditions.length === 0) return true;
  return ruleConditionsMatch({ conditions, any_of: rule.any_of }, picked);
}

/** What shoppers can answer on `q`, restricted to the answers the rules name
 *  (mock `picksFor`): one-answer types → each named answer alone, plus
 *  "none of the named" when an unnamed answer exists or the question can be
 *  skipped; multi-select → every subset of the named answers that fits
 *  min/max once unnamed picks are counted (plus the empty set when it can be
 *  skipped). An unreachable question is never answered. null = over cap. */
function candidateStates(
  doc: QuizDoc,
  q: QuestionNodeT,
  named: readonly string[],
  reachable: ReadonlySet<string> | null,
): string[][] | null {
  if (reachable && !reachable.has(q.id)) return [[]];
  const skippable = !questionAlwaysAnswered(doc, q.id);
  const other = q.data.answers.length - named.length;
  if (q.data.question_type !== "multi_select") {
    const out = named.map((id) => [id]);
    if (other > 0 || skippable) out.push([]);
    return out;
  }
  if (named.length > MAX_NAMED_MULTI) return null;
  const n = q.data.answers.length;
  const min = Math.max(1, Math.min(n, q.data.min_selections ?? 1));
  const max = maxPicks(q);
  const out: string[][] = [];
  for (let m = 0; m < 1 << named.length; m++) {
    const s = named.filter((_, b) => (m >> b) & 1);
    if ((skippable && s.length === 0) || (s.length <= max && s.length + other >= min)) {
      out.push(s);
    }
  }
  return out;
}

/** The shopper-set walk (mock `shadowedBy`, B12): the 0-based indexes of
 *  the earlier rules that catch EVERY shopper rule `index` could match —
 *  one rule when one suffices on its own, else the union — or null when
 *  some shopper gets through (or the rule is half-built, impossible,
 *  match:"any", matches nobody, or the walk exceeds SHADOW_WALK_CAP).
 *  Evaluates candidate answer sets with ruleConditionsMatch; questions are
 *  treated independently, which only adds combinations, so a flag is sound.
 *  Earlier rules with no conditions never catch (the engine skips them). */
export function shadowingRules(doc: QuizDoc, index: number): number[] | null {
  const rules = doc.decision_rules ?? [];
  const r = rules[index];
  if (!r || r.conditions.length === 0 || r.match === "any") return null;
  if (impossibleAllOf(r, doc)) return null;
  const earlier = rules
    .slice(0, index)
    .map((rule, i) => ({ rule, i }))
    .filter(({ rule }) => rule.conditions.length > 0);
  if (earlier.length === 0) return null;

  const set = [...earlier.map((e) => e.rule), r];
  const namedQids = new Set(set.flatMap((x) => x.conditions.map((c) => c.question_id)));
  const qs = doc.nodes.filter(
    (n): n is QuestionNodeT => n.type === "question" && namedQids.has(n.id),
  );
  // r's groups on DELETED questions: judged with no picks (the engine never
  // sees an answer there) — an `is` group there means r matches nobody.
  const liveQids = new Set(qs.map((q) => q.id));
  for (const qid of namedQids) {
    if (!liveQids.has(qid) && !groupHolds(r, qid, new Set())) return null;
  }
  const intro = introId(doc);
  const reachable = intro ? reachableNodeIds(doc, intro) : null;
  const opts: string[][][] = [];
  let combos = 1;
  for (const q of qs) {
    const named = q.data.answers
      .map((a) => a.id)
      .filter((id) =>
        set.some((x) => x.conditions.some((c) => c.question_id === q.id && c.answer_id === id)),
      );
    const states = candidateStates(doc, q, named, reachable);
    if (!states) return null;
    const allowed = states.filter((p) => groupHolds(r, q.id, new Set(p)));
    if (allowed.length === 0) return null; // r matches nobody — its own warning
    combos *= allowed.length;
    if (combos > SHADOW_WALK_CAP) return null;
    opts.push(allowed);
  }
  const pos = new Map(qs.map((q, d) => [q.id, d]));
  const decidedAt = (rule: DecisionRule) =>
    Math.max(-1, ...rule.conditions.map((c) => pos.get(c.question_id) ?? -1));

  const by = new Set<number>();
  const walk = (
    d: number,
    live: ReadonlyArray<{ rule: DecisionRule; i: number }>,
    picked: ReadonlySet<string>,
  ): boolean => {
    let rest = live;
    while (rest.length > 0 && decidedAt(rest[0]!.rule) < d) {
      if (ruleConditionsMatch(rest[0]!.rule, picked)) {
        by.add(rest[0]!.i);
        return true;
      }
      rest = rest.slice(1);
    }
    if (rest.length === 0 || d >= qs.length) return false;
    const qid = qs[d]!.id;
    return opts[d]!.every((p) => {
      const pSet = new Set(p);
      const next = rest.filter(
        (e) => e.rule.match === "any" || groupHolds(e.rule, qid, pSet),
      );
      return walk(d + 1, next, new Set([...picked, ...p]));
    });
  };

  for (const e of earlier) {
    by.clear();
    if (walk(0, [e], new Set())) return [e.i];
  }
  by.clear();
  return walk(0, earlier, new Set()) ? [...by].sort((a, b) => a - b) : null;
}

/** Advisory (audit 2026-08-28) — a match:"any" rule carrying a question
 *  group made ONLY of `is_not` conditions is vacuously satisfied by every
 *  shopper who skips or answers that question differently — the rule fires
 *  for nearly everyone, and first-match-wins means it swallows every rule
 *  below it. V7/V8 deliberately look away from any-rules (§11), so this is
 *  the one flag that watches them. WARN-shaped; never blocks. */
export function overbroadRules(doc: QuizDoc): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of doc.decision_rules ?? []) {
    if (rule.match !== "any" || rule.conditions.length === 0) continue;
    const groups = new Map<string, { hasIs: boolean }>();
    for (const c of rule.conditions) {
      const g = groups.get(c.question_id) ?? { hasIs: false };
      if (c.op === "is") g.hasIs = true;
      groups.set(c.question_id, g);
    }
    if ([...groups.values()].some((g) => !g.hasIs)) {
      findings.push({
        ruleId: rule.id,
        message:
          'An "is not" column under match any is satisfied by anyone who answers differently or skips — this rule fires for nearly every shopper and everything below it never runs.',
      });
    }
  }
  return findings;
}

/** §4.3 — a rough uniform-independence estimate of the share of shoppers a
 *  rule matches. Per question group: Π 1/answerCount over all-of `is` chips,
 *  k/answerCount for an any_of group of k chips, Π (1−1/count) for `is_not`.
 *  Groups multiply under match all; under match any they combine as
 *  1 − Π(1−p). Explicitly an ESTIMATE for the Rules-tab match-% column + the
 *  fall-through note; never used for validation. */
export function ruleMatchEstimates(doc: QuizDoc): Map<string, number> {
  const answerCount = new Map<string, number>();
  for (const n of doc.nodes) {
    if (n.type === "question") answerCount.set(n.id, n.data.answers.length);
  }
  const out = new Map<string, number>();
  for (const rule of doc.decision_rules ?? []) {
    if (rule.conditions.length === 0) {
      out.set(rule.id, 0);
      continue;
    }
    const anyOf = new Set(rule.any_of ?? []);
    const groups = new Map<string, typeof rule.conditions>();
    for (const c of rule.conditions) {
      const list = groups.get(c.question_id);
      if (list) list.push(c);
      else groups.set(c.question_id, [c]);
    }
    const groupPs: number[] = [];
    let broken = false;
    for (const [qid, conds] of groups) {
      const count = answerCount.get(qid) ?? 0;
      if (count === 0) {
        broken = true;
        break;
      }
      const isConds = conds.filter((c) => c.op === "is");
      let p = 1;
      for (const c of conds) {
        if (c.op === "is_not") p *= 1 - 1 / count;
      }
      if (isConds.length > 0) {
        p *=
          anyOf.has(qid) && isConds.length > 1
            ? Math.min(1, isConds.length / count)
            : isConds.reduce((acc) => acc / count, 1);
      }
      groupPs.push(p);
    }
    if (broken) {
      out.set(rule.id, 0);
      continue;
    }
    const p =
      rule.match === "any"
        ? 1 - groupPs.reduce((acc, g) => acc * (1 - g), 1)
        : groupPs.reduce((acc, g) => acc * g, 1);
    out.set(rule.id, p);
  }
  return out;
}

// ── the outcome table (§7.1) ────────────────────────────────────────────────

export interface OutcomeRow {
  kind: "mapping" | "rule";
  /** answerId for mappings, ruleId for rules. */
  id: string;
  label: string;
  targetId: string | null;
  /** Mappings: the answer is offerable AND its question is the decider (always
   *  true when a decider exists). Rules: not dead/half-built/shadowed. */
  reachable: boolean;
}

/** One row per deciding answer + one per rule — the linear outcome table that
 *  satisfies the spec's "enumerate every reachable outcome" without cartesian
 *  explosion (outcomes = decider answers ∪ rules, nothing else can resolve). */
export function outcomeTable(doc: QuizDoc): OutcomeRow[] {
  const rows: OutcomeRow[] = [];
  const decider = deciderOf(doc);
  const pickable = answersReachable(doc);
  if (decider) {
    for (const a of decider.data.answers) {
      rows.push({
        kind: "mapping",
        id: a.id,
        label: a.text,
        targetId: a.target_id ?? null,
        reachable: pickable.get(a.id) ?? false,
      });
    }
  }
  const deadIds = new Set(deadRules(doc).map((f) => f.ruleId));
  const halfIds = new Set(halfBuiltRules(doc).map((f) => f.ruleId));
  const shadowIds = new Set(shadowedRules(doc).map((f) => f.ruleId));
  for (const rule of doc.decision_rules ?? []) {
    rows.push({
      kind: "rule",
      id: rule.id,
      label: rule.conditions
        .map((c) => `${c.question_id} ${c.op === "is" ? "is" : "is not"} ${c.answer_id}`)
        .join(rule.match === "any" ? " OR " : " AND "),
      targetId: rule.target_id,
      reachable: !deadIds.has(rule.id) && !halfIds.has(rule.id) && !shadowIds.has(rule.id),
    });
  }
  return rows;
}

/** QZY-1 (quiz-logic dev-handoff v1.2 §1) — would routing an answer of
 *  `fromQuestionId` to `targetId` create a revisit (cycle) on some path?
 *  True when the target IS the source, or the target can reach the source
 *  again by following any forward edge. The THEN GO TO dropdown disables
 *  such targets; the mutation layer refuses to write them. */
export function wouldCreateRevisit(
  doc: QuizDoc,
  fromQuestionId: string,
  targetId: string,
): boolean {
  if (targetId === fromQuestionId) return true;
  return reachableNodeIds(doc, targetId).has(fromQuestionId);
}
