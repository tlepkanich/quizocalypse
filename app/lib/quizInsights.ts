// ANALYTICS P0 — deterministic "What to fix" cards (research doc §7). No LLM
// anywhere in the trigger path, the math, the ranking, or the copy — templated
// slots only, so a card's text never changes between page loads. ~70% of the
// library is Tier A (doc-static): it reads the quiz's own logic and works at
// zero traffic, which is the whole low-volume strategy.
//
// Owner decisions baked in (2026-08-11, don't relitigate):
// - No modeled dollar figures. Cards rank by impact DENOMINATED IN SHOPPERS.
// - Confidence gates are enforced: thin-n leaks rank without a percentage.
//
// Pure: callers feed the parsed doc + precomputed aggregates.

import type { Quiz as QuizDoc } from "./quizSchema";
import { collectDeciderTargetIds } from "./quizPublish";
import { enumeratePaths } from "./pathEnumeration";
import type { StepLedger } from "./stepLedger";
import type { ReachabilityReport } from "./quizReachability";
import { GATES } from "./analyticsConfidence";

export type InsightSeverity = "info" | "warn" | "crit";

/** Where a card's action should land — the view maps kinds to surface hrefs. */
export interface InsightAction {
  label: string;
  kind: "logic" | "builder" | "flow" | "products" | "contacts" | "question";
  nodeId?: string;
}

export interface InsightCard {
  /** Stable per OBJECT (de-dupe + dismissal key), e.g. "leak:node123". */
  id: string;
  tier: "A" | "B";
  severity: InsightSeverity;
  headline: string;
  body: string;
  evidence: Array<{ label: string; value: string }>;
  /** How the finding was read — the trust line under the evidence. */
  basis: string;
  action: InsightAction;
  /** Ranking key: shoppers affected (0 for doc-static findings). */
  excess: number;
  /**
   * Very short label for a list cell ("1 result only") — set on the structural
   * findings worth seeing WITHOUT opening the quiz. Absent = don't surface in
   * the Status column.
   */
  chip?: string;
}

export interface InsightsResult {
  cards: InsightCard[];
  /** Findings beyond the 3-card cap ("N more findings are waiting"). */
  more: number;
  /** True when every rule came back clean. */
  clean: boolean;
}

const CARD_CAP = 3;
const SEV_RANK: Record<InsightSeverity, number> = { crit: 0, warn: 1, info: 2 };

export interface InsightInputs {
  doc: QuizDoc;
  /** Published JSON when live (enables reachability/dead-end proofs); else null. */
  reachability: ReachabilityReport | null;
  ledger: StepLedger | null;
  engaged: number;
  completed: number;
  /** Days covered by the active range (for "about N shoppers a month"). */
  rangeDays: number;
  published: boolean;
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const SELECT_TYPES = new Set(["single_select", "multi_select", "image_tile", "image_picker", "searchable", "dropdown"]);

/** Distinct outcomes the doc can produce (decider: mapped targets; legacy: result nodes). */
export function distinctOutcomes(doc: QuizDoc): number {
  if (doc.logic_model === "decider") return collectDeciderTargetIds(doc).size;
  return doc.nodes.filter((n) => n.type === "result").length;
}

export function buildQuizInsights(input: InsightInputs): InsightsResult {
  const { doc } = input;
  const cards: InsightCard[] = [];
  const questions = doc.nodes.filter((n) => n.type === "question");

  // ── Tier A — doc-static, zero traffic ────────────────────────────────────

  // SINGLE_RESULT — every answer leads to the same outcome.
  const outcomes = distinctOutcomes(doc);
  if (questions.length >= 2 && outcomes === 1) {
    cards.push({
      id: "single-result",
      tier: "A",
      severity: "crit",
      headline: "Every answer leads to the same result",
      body: `All ${questions.length} questions route to one outcome. Shoppers get an identical recommendation whatever they pick, which makes the quiz a form.`,
      evidence: [
        { label: "Questions", value: String(questions.length) },
        { label: "Distinct outcomes", value: "1" },
      ],
      basis: "Read from the quiz logic — no traffic needed",
      action: { label: "Open the logic", kind: "logic" },
      excess: 0,
      chip: "1 result only",
    });
  }

  // A2 UNREACHABLE_PRODUCT — provable from the baked target map.
  const reach = input.reachability;
  if (reach && reach.unreachable.length > 0) {
    cards.push({
      id: "unreachable-products",
      tier: "A",
      severity: "warn",
      headline: `${reach.unreachable.length} of your ${reach.mapped} mapped products can never be recommended`,
      body: "They sit in no result group and no fallback, so no combination of answers reaches them. This comes from your quiz's own logic, not from traffic.",
      evidence: [
        { label: "Unreachable", value: String(reach.unreachable.length) },
        { label: "Mapped", value: String(reach.mapped) },
        { label: "Result groups", value: String(reach.targetCount) },
      ],
      basis: "Read from the product mapping — no traffic needed",
      action: { label: "See the products", kind: "products" },
      excess: 0,
      chip: `${reach.unreachable.length} unreachable`,
    });
  }

  // A3 DEAD_END_PATH — decider only; enumeration is capped, so under-report
  // rather than overclaim when truncated.
  if (doc.logic_model === "decider") {
    const enumd = enumeratePaths(doc);
    if (enumd.deadEnds.length > 0) {
      const hasSafetyNet = Boolean(doc.rec_page_settings?.global.safetyNetCol);
      cards.push({
        id: "dead-end-paths",
        tier: "A",
        severity: hasSafetyNet ? "warn" : "crit",
        headline: `${enumd.deadEnds.length}${enumd.truncated ? "+" : ""} answer combinations don't resolve to a result`,
        body: hasSafetyNet
          ? "Shoppers on these paths get the safety-net products instead of a real match."
          : "Shoppers on these paths finish the quiz and get nothing.",
        evidence: [
          { label: "Dead-end paths", value: `${enumd.deadEnds.length}${enumd.truncated ? "+" : ""}` },
          { label: "Paths checked", value: String(enumd.count) },
        ],
        basis: "Read from the quiz logic — no traffic needed",
        action: { label: "Open the logic", kind: "logic" },
        excess: 0,
        chip: `${enumd.deadEnds.length}${enumd.truncated ? "+" : ""} dead ends`,
      });
    }
  }

  // A6 QUIZ_TOO_LONG.
  if (questions.length > 7) {
    cards.push({
      id: "quiz-too-long",
      tier: "A",
      severity: "warn",
      headline: `${questions.length} questions is longer than shoppers usually finish`,
      body: "Best practice is 5–7. Every extra step costs a slice of the shoppers who reached it.",
      evidence: [
        { label: "Questions", value: String(questions.length) },
        { label: "Best practice", value: "5–7" },
      ],
      basis: "Read from the quiz structure — no traffic needed",
      action: { label: "Review the flow", kind: "flow" },
      excess: 0,
      chip: `${questions.length} questions`,
    });
  }

  // A7 OPTION_OVERLOAD / A8 PROMPT_TOO_LONG — one card per question object.
  for (const q of questions) {
    if (q.type !== "question") continue;
    if (SELECT_TYPES.has(q.data.question_type) && q.data.answers.length > 8) {
      cards.push({
        id: `option-overload:${q.id}`,
        tier: "A",
        severity: "info",
        headline: `"${q.data.text}" offers ${q.data.answers.length} choices`,
        body: "Past about 8 options, picking gets slower and skips go up. Group or trim the list.",
        evidence: [{ label: "Options", value: String(q.data.answers.length) }],
        basis: "Read from the quiz structure — no traffic needed",
        action: { label: "Edit the question", kind: "question", nodeId: q.id },
        excess: 0,
      });
    } else if (words(q.data.text) > 15) {
      cards.push({
        id: `prompt-long:${q.id}`,
        tier: "A",
        severity: "info",
        headline: `One question's prompt runs ${words(q.data.text)} words`,
        body: `"${q.data.text.slice(0, 80)}${q.data.text.length > 80 ? "…" : ""}" — shorter prompts read faster and lose fewer shoppers.`,
        evidence: [{ label: "Words", value: String(words(q.data.text)) }],
        basis: "Read from the quiz structure — no traffic needed",
        action: { label: "Edit the question", kind: "question", nodeId: q.id },
        excess: 0,
      });
    }
  }

  // ── Tier B — traffic-based, gated ────────────────────────────────────────

  // B1 QUESTION_LEAK — steepest RELATIVE drop vs the median of the others.
  const ledger = input.ledger;
  if (ledger && !ledger.branching && ledger.steepestNodeId) {
    const qRows = ledger.steps.filter((s) => s.kind === "question" && s.dropoff != null);
    const target = qRows.find((s) => s.nodeId === ledger.steepestNodeId);
    if (target && target.reached != null && qRows.length >= 2) {
      const others = qRows.filter((s) => s.nodeId !== target.nodeId).map((s) => s.dropoff!) .sort((a, b) => a - b);
      const median = others[Math.floor(others.length / 2)] ?? 0;
      const n = target.reached;
      const drop = target.dropoff!;
      const meaningful = drop >= 0.1 && drop >= median * 2;
      if (meaningful && n >= GATES.dropoff_rank.provisional) {
        const exact = n >= GATES.dropoff_exact.provisional; // ≥100 → show numbers
        const excess = Math.max(0, Math.round(n * (drop - median)));
        const perMonth = input.rangeDays > 0 ? Math.round((excess / input.rangeDays) * 30) : 0;
        cards.push({
          id: `leak:${target.nodeId}`,
          tier: "B",
          severity: exact && drop >= median * 3 ? "crit" : "warn",
          headline: exact
            ? `"${target.label}" loses ${Math.round(drop * 100)}% of the shoppers who reach it`
            : `"${target.label}" is the steepest drop in this quiz`,
          body: exact
            ? `That's well above the ${Math.round(median * 100)}% typical of your other steps.`
            : "At this volume we can rank the step but an exact percentage would swing on luck. It appears here because it is consistently your worst step.",
          evidence: exact
            ? [
                { label: "Reached", value: String(n) },
                { label: "Left here", value: String(target.left ?? 0) },
                { label: "Other steps", value: `${Math.round(median * 100)}%` },
                ...(perMonth > 0 ? [{ label: "About", value: `${perMonth} shoppers a month` }] : []),
              ]
            : [{ label: "Reached", value: String(n) }],
          basis: "Read from per-question answer events against the quiz's own step order",
          action: { label: "See it in the flow", kind: "flow", nodeId: target.nodeId },
          excess,
        });
      }
    }
  }

  // B10 TRAFFIC_STARVED — fires when the quiz is live but the sample is thin.
  if (input.published && input.engaged > 0 && input.engaged < 200) {
    cards.push({
      id: "traffic-starved",
      tier: "B",
      severity: "info",
      headline: "The biggest upside right now is more shoppers, not a better quiz",
      body: `${input.engaged} sessions in this window is below the volume where rates mean much. Placement — where the quiz sits on your store — is what's capping it.`,
      evidence: [
        { label: "Sessions", value: String(input.engaged) },
        { label: "Rates unlock at", value: "200" },
      ],
      basis: "Read from session counts in the selected range",
      action: { label: "Review where it's embedded", kind: "builder" },
      excess: 0,
    });
  }

  // ── Rank + cap ───────────────────────────────────────────────────────────
  cards.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.excess - a.excess);
  return {
    cards: cards.slice(0, CARD_CAP),
    more: Math.max(0, cards.length - CARD_CAP),
    clean: cards.length === 0,
  };
}
