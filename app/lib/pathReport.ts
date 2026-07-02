import type { z } from "zod";
import type { Quiz } from "./quizSchema";
import { isFreeformType } from "./quizSchema";
import {
  answersReachDecider,
  brokenRuleRefs,
  deadRules,
  halfBuiltRules,
  outcomeTable,
  shadowedRules,
} from "./pathAnalyzer";
import { validateQuiz } from "./quizValidation";

type QuizDoc = z.infer<typeof Quiz>;

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 §7.1 — the Tier-1 "Test all paths" REPORT assembler. Pure + sync:
// every check is deterministic graph analysis (spec: "NO AI ... evaluates
// V1–V9 with certainty"), composed from pathAnalyzer + local ref checks.
// Consumed by the PathReportPanel overlay (L2-7) and mountable anywhere the
// owner wants the tester ("used in many places"). Tier 2 (AI quality) is a
// SEPARATE component by spec mandate — nothing here may depend on it.
// ════════════════════════════════════════════════════════════════════════════

export type CheckSeverity = "block" | "warn" | "info";
export type CheckStatus = "pass" | "fail";

export interface Tier1Link {
  kind: "question" | "rule";
  /** question node id (kind=question) */
  nodeId?: string;
  /** rule id (kind=rule) */
  ruleId?: string;
}

export interface Tier1Finding {
  message: string;
  link?: Tier1Link;
}

export interface Tier1Check {
  id: "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "V9" | "V10" | "S1";
  severity: CheckSeverity;
  status: CheckStatus;
  title: string;
  findings: Tier1Finding[];
}

export interface Tier1OutcomeRow {
  kind: "mapping" | "rule";
  label: string;
  targetName: string;
  reachable: boolean;
}

export interface Tier1Report {
  checks: Tier1Check[];
  outcomes: Tier1OutcomeRow[];
  /** §7.3 footer verdict: "N to review · M blocking · safe/not safe to publish." */
  verdict: { blocking: number; warnings: number; safe: boolean; label: string };
}

// §10 — the soft wrap-advisory threshold (mirrors the AnswerRow counter cap).
const ANSWER_ADVISORY_LEN = 60;

/** Assemble the full Tier-1 report for a DECIDER doc. `buckets` = the quiz's
 *  Step-1 Category rows (V4/V5's doc-side existence check runs against them —
 *  publish re-checks against the DB rows). */
export function buildTier1Report(
  doc: QuizDoc,
  buckets: Array<{ id: string; name: string }>,
): Tier1Report {
  const bucketIds = new Set(buckets.map((b) => b.id));
  // Distinguish "never picked" from "picked, then the bucket was deleted" —
  // the outcome table should match the V4/V5 finding wording.
  const bucketName = (id: string | null) =>
    id
      ? buckets.find((b) => b.id === id)?.name ?? "(deleted result)"
      : "(no result picked)";
  const questions = doc.nodes.filter((n) => n.type === "question");
  const qIndex = new Map(questions.map((n, i) => [n.id, i + 1]));
  const qLabel = (id: string) => (qIndex.has(id) ? `Q${qIndex.get(id)}` : "a deleted question");
  const deciders = questions.filter((n) => n.type === "question" && n.data.role === "decides");
  const decider = deciders.length === 1 ? deciders[0]! : null;
  const rules = doc.decision_rules ?? [];
  const check = (
    id: Tier1Check["id"],
    severity: CheckSeverity,
    title: string,
    findings: Tier1Finding[],
  ): Tier1Check => ({ id, severity, title, status: findings.length === 0 ? "pass" : "fail", findings });

  // The publish gate's own verdict — the report's checks must NEVER be safer
  // than the gate (review-caught in L2-7: the two must agree or the footer's
  // "safe to publish" is a lie). Run it once; V2 falls back to it and the S1
  // structural row folds in everything the V-checks don't cover.
  const gateIssues = validateQuiz(doc);
  const DECIDER_KINDS = new Set([
    "missing_decider",
    "decider_bypass",
    "decider_optional",
    "unmapped_decider_answer",
    "broken_rule_reference",
  ]);

  // V1 — exactly one deciding question. BLOCK. Each EXTRA decider gets its own
  // deep-linked finding (§7.3: every fail deep-links where a target exists).
  const v1: Tier1Finding[] =
    deciders.length === 1
      ? []
      : deciders.length === 0
        ? [
            {
              message:
                "No question decides the result yet — promote one with the ◇ Make decider toggle.",
            },
          ]
        : deciders.slice(1).map((d) => ({
            message: `${qLabel(d.id)} is ALSO marked as deciding — keep exactly one (demote the extras).`,
            link: { kind: "question" as const, nodeId: d.id },
          }));

  // V2 — every reachable path passes through the decider before the quiz ends.
  // ANSWER-level (spec: "REACHABILITY IS ANSWER-LEVEL") via the dominator-
  // consistent answersReachDecider; then a GATE FALLBACK: if the publish
  // gate's own dominator walk found a bypass this answer-level pass missed
  // (e.g. the intro wired straight to a terminal — no answer to pin it on),
  // surface the gate's finding so the report can never read safer. BLOCK.
  const v2: Tier1Finding[] = [];
  if (decider) {
    const reach = answersReachDecider(doc);
    for (const n of questions) {
      if (n.type !== "question" || n.id === decider.id) continue;
      for (const a of n.data.answers) {
        if (reach.get(a.id) === false) {
          v2.push({
            message: `Picking “${a.text || "an answer"}” on ${qLabel(n.id)} ends the quiz without reaching the deciding question.`,
            link: { kind: "question", nodeId: n.id },
          });
        }
      }
    }
    if (v2.length === 0) {
      for (const issue of gateIssues.filter((i) => i.kind === "decider_bypass")) {
        v2.push({ message: issue.message });
      }
    }
  }

  // V3 — the decider is Required (auto-enforced, re-checked). BLOCK.
  const v3: Tier1Finding[] =
    decider && decider.type === "question" && decider.data.required === false
      ? [
          {
            message: "The deciding question is optional — a shopper could skip it and get no result.",
            link: { kind: "question", nodeId: decider.id },
          },
        ]
      : [];

  // V4 — every deciding answer maps to a bucket THAT EXISTS. BLOCK.
  const v4: Tier1Finding[] = [];
  if (decider && decider.type === "question") {
    for (const a of decider.data.answers) {
      if (!a.target_id) {
        v4.push({
          message: `The deciding answer “${a.text || "Untitled"}” doesn't point at a result yet.`,
          link: { kind: "question", nodeId: decider.id },
        });
      } else if (!bucketIds.has(a.target_id)) {
        v4.push({
          message: `The deciding answer “${a.text || "Untitled"}” points at a deleted bucket — pick a new result.`,
          link: { kind: "question", nodeId: decider.id },
        });
      }
    }
  }

  // V5 — no rule references a deleted bucket. BLOCK.
  const v5: Tier1Finding[] = rules
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !bucketIds.has(r.target_id))
    .map(({ r, i }) => ({
      message: `Rule ${i + 1} recommends a deleted bucket — pick a new result.`,
      link: { kind: "rule" as const, ruleId: r.id },
    }));

  // V6 — no rule references a deleted question/answer. BLOCK.
  const ruleNo = new Map(rules.map((r, i) => [r.id, i + 1]));
  const v6: Tier1Finding[] = brokenRuleRefs(doc).map((f) => ({
    message: `Rule ${ruleNo.get(f.ruleId) ?? "?"}: ${f.message}`,
    link: { kind: "rule", ruleId: f.ruleId },
  }));

  // V7/V8/V9 — rule warnings straight from the analyzer.
  const wrapRule = (f: { ruleId: string; message: string }): Tier1Finding => ({
    message: `Rule ${ruleNo.get(f.ruleId) ?? "?"}: ${f.message}`,
    link: { kind: "rule", ruleId: f.ruleId },
  });
  const v7 = deadRules(doc).map(wrapRule);
  const v8 = shadowedRules(doc).map(wrapRule);
  const v9 = halfBuiltRules(doc).map(wrapRule);

  // V10 — answer length advisory (§10 — NEVER blocks).
  const v10: Tier1Finding[] = [];
  for (const n of questions) {
    if (n.type !== "question" || isFreeformType(n.data.question_type)) continue;
    for (const a of n.data.answers) {
      if (a.text.length >= ANSWER_ADVISORY_LEN) {
        v10.push({
          message: `${qLabel(n.id)}: “${a.text.slice(0, 40)}…” is long — it may wrap on small screens.`,
          link: { kind: "question", nodeId: n.id },
        });
      }
    }
  }

  // S1 — every OTHER publish-gate issue (orphans, dead ends, broken routing,
  // missing fallbacks, …). Without this fold-in the footer could say "safe to
  // publish" while quizPublish throws on the very same doc — the one thing a
  // path tester must never do. Decider kinds are excluded (V1–V6 cover them).
  const s1: Tier1Finding[] = gateIssues
    .filter((i) => !DECIDER_KINDS.has(i.kind))
    .map((i) => ({
      message: i.message,
      ...(qIndex.has(i.nodeId) ? { link: { kind: "question" as const, nodeId: i.nodeId } } : {}),
    }));

  const checks: Tier1Check[] = [
    check("V1", "block", "Exactly one deciding question", v1),
    check("V2", "block", "Every path reaches the decider", v2),
    check("V3", "block", "The deciding question is required", v3),
    check("V4", "block", "Every deciding answer has a result", v4),
    check("V5", "block", "Rules point at existing buckets", v5),
    check("V6", "block", "Rule conditions reference existing answers", v6),
    check("V7", "warn", "No rule sits on paths that never co-occur", v7),
    check("V8", "warn", "No rule is shadowed by a higher one", v8),
    check("V9", "warn", "No half-built rules", v9),
    check("V10", "info", "Answer text fits comfortably", v10),
    check("S1", "block", "Structure (orphans, dead ends, routing)", s1),
  ];

  const outcomes: Tier1OutcomeRow[] = outcomeTable(doc).map((row) => ({
    kind: row.kind,
    label:
      row.kind === "rule"
        ? `Rule ${ruleNo.get(row.id) ?? "?"}`
        : `“${row.label || "Untitled answer"}”`,
    targetName: bucketName(row.targetId),
    reachable: row.reachable,
  }));

  const blocking = checks
    .filter((c) => c.severity === "block")
    .reduce((n, c) => n + c.findings.length, 0);
  const warnings = checks
    .filter((c) => c.severity === "warn")
    .reduce((n, c) => n + c.findings.length, 0);
  const safe = blocking === 0;
  return {
    checks,
    outcomes,
    verdict: {
      blocking,
      warnings,
      safe,
      // §7.3 verbatim shape: "N to review · M blocking · safe/not safe to publish."
      label: `${warnings} to review · ${blocking} blocking · ${safe ? "safe" : "not safe"} to publish`,
    },
  };
}
