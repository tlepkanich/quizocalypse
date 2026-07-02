import type { z } from "zod";
import type { Quiz } from "./quizSchema";

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
 *  can slip through — acceptable because V7 never blocks. */
export function deadRules(doc: QuizDoc): RuleFinding[] {
  const intro = introId(doc);
  const reachable = intro ? reachableNodeIds(doc, intro) : new Set<string>();
  const findings: RuleFinding[] = [];

  for (const rule of doc.decision_rules ?? []) {
    const isQuestions = [
      ...new Set(
        rule.conditions.filter((c) => c.op === "is").map((c) => c.question_id),
      ),
    ];
    const unreachable = isQuestions.find((qid) => !reachable.has(qid));
    if (unreachable) {
      findings.push({
        ruleId: rule.id,
        message:
          "A condition depends on a question no shopper can reach — this rule can never fire.",
      });
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
    if (dead) {
      findings.push({
        ruleId: rule.id,
        message:
          "Two of this rule's conditions live on paths that never co-occur — no shopper can match both.",
      });
    }
  }
  return findings;
}

/** V8 (WARN) — a HIGHER rule fully shadows a LOWER one when the higher's
 *  condition set is a subset of the lower's: any path matching the lower also
 *  matches the higher, and the higher fires first (first-match-wins). */
export function shadowedRules(doc: QuizDoc): RuleFinding[] {
  const rules = doc.decision_rules ?? [];
  const key = (c: { question_id: string; answer_id: string; op: string }) =>
    `${c.question_id} ${c.answer_id} ${c.op}`;
  const findings: RuleFinding[] = [];
  for (let hi = 0; hi < rules.length; hi++) {
    const higher = rules[hi]!;
    if (higher.conditions.length === 0) continue; // half-built never fires
    const higherSet = new Set(higher.conditions.map(key));
    for (let lo = hi + 1; lo < rules.length; lo++) {
      const lower = rules[lo]!;
      if (lower.conditions.length === 0) continue;
      const subset = [...higherSet].every((k) =>
        lower.conditions.some((c) => key(c) === k),
      );
      if (subset) {
        findings.push({
          ruleId: lower.id,
          message: `Rule ${hi + 1} always fires first for any shopper this rule would match — this rule can never fire.`,
        });
      }
    }
  }
  return findings;
}

/** §4.3 — a rough uniform-independence estimate of the share of shoppers a
 *  rule matches (Π 1/answerCount for `is`; Π (1−1/count) for `is_not`).
 *  Explicitly an ESTIMATE for the Rules-tab match-% column + the fall-through
 *  note; never used for validation. */
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
    let p = 1;
    for (const c of rule.conditions) {
      const count = answerCount.get(c.question_id) ?? 0;
      if (count === 0) {
        p = 0;
        break;
      }
      p *= c.op === "is" ? 1 / count : 1 - 1 / count;
    }
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
        .join(" AND "),
      targetId: rule.target_id,
      reachable: !deadIds.has(rule.id) && !halfIds.has(rule.id) && !shadowIds.has(rule.id),
    });
  }
  return rows;
}
