import type { z } from "zod";
import type { Quiz } from "./quizSchema";
import { isFreeformType } from "./quizSchema";
import { answersReachDecider, brokenRuleRefs, outcomeTable } from "./pathAnalyzer";
import { validateQuiz, validateQuizWarnings } from "./quizValidation";
import { answerFilterValues, filterAnswerMatchCount } from "./filterMatching";
import { bandCoverage, sliderBandAnswers } from "./sliderBands";
import { isSellable, type IndexedProduct } from "./recommendationEngine";
import { answerTargets, ruleTargets } from "./recommendDecider";
import { REPORT_COPY, structureMessage } from "./reportCopy";
import { engineLogicStyle, resolveLogicStyle } from "./logicStyle";
import { orderedQuestions } from "./questionOrder";
import { ruleStatuses } from "./ruleStatus";
import { recommendationCoverage, ruleShowsRecommendations } from "./recommendationCoverage";

type QuizDoc = z.infer<typeof Quiz>;

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 §7.1 — the Tier-1 "Test all paths" REPORT assembler. Pure + sync:
// every check is deterministic graph analysis (spec: "NO AI ... evaluates
// V1–V9 with certainty"), composed from pathAnalyzer + local ref checks.
// Consumed by the Step-3 v3 health surface (Step3Shell → HealthPill/Popover →
// Tier1CheckList; the L2-7 PathReportPanel overlay was retired in QL3-P5) and
// mountable anywhere the owner wants the tester ("used in many places"). Tier 2
// (AI quality) is a
// SEPARATE component by spec mandate — nothing here may depend on it.
// ════════════════════════════════════════════════════════════════════════════

export type CheckSeverity = "block" | "warn" | "info";
export type CheckStatus = "pass" | "fail";

export interface Tier1Link {
  /** "question" → select nodeId; "rule" → the rule ruleId; "rules" → the
   *  rules list itself (no single rule — e.g. "needs at least one rule");
   *  "recommendation" → categoryId (Filter style also names the picking
   *  question in nodeId); "style" → the header's logic-style menu. Hosts
   *  ignore kinds they do not handle. */
  kind: "question" | "rule" | "rules" | "recommendation" | "style";
  /** question node id (kind=question; optional on kind=recommendation) */
  nodeId?: string;
  /** rule id (kind=rule) */
  ruleId?: string;
  /** recommendation (Category) id (kind=recommendation) */
  categoryId?: string;
}

export interface Tier1Finding {
  message: string;
  link?: Tier1Link;
}

export interface Tier1Check {
  id:
    | "V1"
    | "V2"
    | "V3"
    | "V4"
    | "V5"
    | "V6"
    | "V7"
    | "V8"
    | "V9"
    | "V10"
    | "V11"
    | "V12"
    | "V13"
    | "V14"
    | "V15"
    | "V16"
    | "S1"
    | "S2"
    // Logic step D3 — style-aware checks:
    | "R0" // style shown but not saved (warn)
    | "R1" // Rules only: needs at least one rule (block)
    | "R2" // Rules only: no rule can show anything (block)
    | "R3" // Rules only: a rule missing its answers / recommendations (block)
    | "R4" // an impossible all-of (warn, both styles)
    | "R5"; // a recommendation nothing can show (warn, both styles)
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
  // `productIds` is optional-per-bucket: hosts that have it (the funnel and
  // builder pass full Category rows) unlock the Live-M starting-set
  // coverage check; hosts that don't simply omit it.
  buckets: Array<{
    id: string;
    name: string;
    productIds?: string[];
    /** Category.quizId — when hosts pass it, R5 ("never recommended")
     *  iterates only quiz-scoped rows (the tray's filter). */
    quizId?: string | null;
  }>,
  // QZY-1 (quiz-logic spec §5/§8) — pass the product index to enable the V11
  // filter dead-end check (a filter answer matching 0 products is BLOCKING).
  // Absent (some hosts have no catalog handy) → the check is omitted, never
  // rendered as a hollow "pass".
  productIndex?: readonly IndexedProduct[],
  // Logic step D3 — `recommendationIds` = the quiz-scoped recommendations
  // R5 checks. Absent → derived from buckets carrying `quizId`; when no
  // bucket says, R5 is omitted (never a hollow pass over account groups).
  // `styleNote` opts into R0 (see below).
  opts: { recommendationIds?: readonly string[]; styleNote?: boolean } = {},
): Tier1Report {
  // Logic step D1/D3 — the report checks the ENGINE style (the stored field;
  // absent = Filter Results + Rules), never the inferred screen style, so it
  // can never read safer than the publish gate.
  const rulesOnly = engineLogicStyle(doc) === "rules";
  const bucketIds = new Set(buckets.map((b) => b.id));
  // Distinguish "never picked" from "picked, then the bucket was deleted" —
  // the outcome table should match the V4/V5 finding wording.
  const bucketName = (id: string | null) =>
    id
      ? buckets.find((b) => b.id === id)?.name ?? "(deleted result)"
      : "(no result picked)";
  const questions = doc.nodes.filter((n) => n.type === "question");
  // Numbered the way the rail numbers them (flow order), not node order.
  const qIndex = new Map(orderedQuestions(doc).map((q) => [q.node.id, q.qIndex]));
  const qLabel = (id: string) => (qIndex.has(id) ? `Q${qIndex.get(id)}` : "a deleted question");
  const deciders = rulesOnly
    ? []
    : questions.filter((n) => n.type === "question" && n.data.role === "decides");
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
    "rules_only_no_rules",
    "rules_only_incomplete_rule",
    "rules_only_nothing_shows",
  ]);
  // The ONE per-rule status (rule rows, the Table and coverage read it too).
  const statuses = ruleStatuses(doc, bucketIds);
  const statusOf = (id: string) => statuses.get(id);

  // V1 — exactly one deciding question. BLOCK. Each EXTRA decider gets its own
  // deep-linked finding (§7.3: every fail deep-links where a target exists).
  const v1: Tier1Finding[] =
    deciders.length === 1
      ? []
      : deciders.length === 0
        ? [{ message: REPORT_COPY.noPicker }]
        : deciders.slice(1).map((d) => ({
            message: REPORT_COPY.alsoPicks(qLabel(d.id)),
            link: { kind: "question" as const, nodeId: d.id },
          }));

  // V2 — every reachable path passes through the decider before the quiz ends.
  // ANSWER-level (spec: "REACHABILITY IS ANSWER-LEVEL") via the dominator-
  // consistent answersReachDecider, then narrowed to the answers whose OWN
  // route causes the skip (handoff §13 "V2: report the route"): a route to
  // the results or to a question numbered after the picking question. An
  // answer that only feeds an earlier question is dropped (that question's
  // answer carries the finding). If the narrowing leaves nothing, every
  // flagged answer is kept; then a GATE FALLBACK: if the publish gate's own
  // dominator walk found a bypass this answer-level pass missed (e.g. the
  // intro wired straight to a terminal — no answer to pin it on), surface
  // it so the report can never read safer. BLOCK.
  const v2: Tier1Finding[] = [];
  if (decider) {
    const reach = answersReachDecider(doc);
    const pickerNo = qIndex.get(decider.id) ?? 0;
    const nodeById = new Map(doc.nodes.map((n) => [n.id, n] as const));
    const flagged: Tier1Finding[] = [];
    for (const n of questions) {
      if (n.type !== "question" || n.id === decider.id) continue;
      const out = doc.edges.filter((e) => e.source === n.id);
      const defaultEdge = out.find((e) => !e.source_handle) ?? out[0];
      for (const a of n.data.answers) {
        if (reach.get(a.id) !== false) continue;
        const text = a.text || "an answer";
        const link = { kind: "question" as const, nodeId: n.id };
        flagged.push({ message: REPORT_COPY.canFinishWithout(qLabel(n.id), text), link });
        // A question after the picking one is only reached by a skip; the
        // route that caused the skip carries the finding (mock `findings()`).
        if ((qIndex.get(n.id) ?? 0) > pickerNo) continue;
        const route = out.find((e) => e.source_handle === a.edge_handle_id) ?? defaultEdge;
        const to = route ? nodeById.get(route.target) : undefined;
        if (!to) continue;
        if (to.type === "result" || to.type === "end") {
          v2.push({ message: REPORT_COPY.straightToResults(qLabel(n.id), text), link });
        } else if (to.type === "question") {
          const toNo = qIndex.get(to.id) ?? 0;
          if (toNo > pickerNo) {
            v2.push({ message: REPORT_COPY.skipsTo(qLabel(n.id), text, qLabel(to.id)), link });
          }
        } else {
          v2.push({ message: REPORT_COPY.canFinishWithout(qLabel(n.id), text), link });
        }
      }
    }
    if (v2.length === 0) v2.push(...flagged);
    if (v2.length === 0 && gateIssues.some((i) => i.kind === "decider_bypass")) {
      v2.push({ message: REPORT_COPY.pathSkipsPicker });
    }
  }

  // V3 — the decider is Required (auto-enforced, re-checked). BLOCK.
  const v3: Tier1Finding[] =
    decider && decider.type === "question" && decider.data.required === false
      ? [
          {
            message: REPORT_COPY.pickerOptional(qLabel(decider.id)),
            link: { kind: "question", nodeId: decider.id },
          },
        ]
      : [];

  // V4 — every deciding answer maps to targets THAT EXIST. BLOCK. Checks
  // every answerTargets entry (publish throws on any missing row), and
  // groups per question per case: "Q1 · 3 answers have no recommendation"
  // counts once (handoff §13 count rule).
  const v4: Tier1Finding[] = [];
  if (decider && decider.type === "question") {
    const answers = decider.data.answers;
    const unset = answers.filter((a) => answerTargets(a).length === 0).length;
    const deleted = answers.filter((a) => answerTargets(a).some((t) => !bucketIds.has(t))).length;
    const link = { kind: "question" as const, nodeId: decider.id };
    if (unset) v4.push({ message: REPORT_COPY.answersNoRec(qLabel(decider.id), unset), link });
    if (deleted) v4.push({ message: REPORT_COPY.answersDeletedRec(qLabel(decider.id), deleted), link });
  }

  // V5 — no rule references a deleted bucket. BLOCK. Covers EVERY target of
  // a multi-target rule (target_ids, Logic-tab G1) — publish's DB check
  // already blocks on any of them, so the health pill must agree (review
  // L1-2: a dangling target_ids[1] previously read "safe to publish").
  const v5: Tier1Finding[] = rules
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => ruleTargets(r).some((t) => !bucketIds.has(t)))
    .filter(({ r }) => !(rulesOnly && statusOf(r.id)?.missing.recommendations))
    .map(({ r, i }) => ({
      message: ruleTargets(r).every((t) => !bucketIds.has(t))
        ? REPORT_COPY.ruleNoRec(i + 1)
        : REPORT_COPY.ruleDeletedRec(i + 1),
      link: { kind: "rule" as const, ruleId: r.id },
    }));

  // V6 — no rule references a deleted question/answer. BLOCK. "is" never
  // runs; a broken "is not" now matches every shopper (ruleStatus flags).
  const ruleNo = new Map(rules.map((r, i) => [r.id, i + 1]));
  const v6: Tier1Finding[] = brokenRuleRefs(doc).map((f) => {
    const n = ruleNo.get(f.ruleId) ?? "?";
    const always = statusOf(f.ruleId)?.flags.some((x) => x.kind === "broken_always");
    return {
      message: always ? REPORT_COPY.ruleDeletedAnswerMatchesAll(n) : REPORT_COPY.ruleDeletedAnswer(n),
      link: { kind: "rule", ruleId: f.ruleId },
    };
  });

  // V7/V8/V9 + R3/R4 — all read the one per-rule status (ruleStatus.ts), so
  // a rule tagged "never runs" always has a finding with the same words.
  const ruleLink = (ruleId: string): Tier1Link => ({ kind: "rule", ruleId });
  const v7: Tier1Finding[] = [];
  const v8: Tier1Finding[] = [];
  const v9: Tier1Finding[] = [];
  const r3: Tier1Finding[] = [];
  const r4: Tier1Finding[] = [];
  for (const st of statuses.values()) {
    for (const f of st.flags) {
      if (f.kind === "unreachable" || f.kind === "exclusive") {
        v7.push({
          message:
            f.kind === "unreachable"
              ? REPORT_COPY.ruleUnreachable(st.number)
              : REPORT_COPY.ruleExclusive(st.number),
          link: ruleLink(st.ruleId),
        });
      }
    }
    if (st.reason === "incomplete") {
      const finding = {
        message: REPORT_COPY.ruleIncomplete(st.number, st.neverRuns ?? ""),
        link: ruleLink(st.ruleId),
      };
      // Rules only: a rule missing its answers or recommendations BLOCKS
      // (D3). Filter Results + Rules: no answers warns (V9); a rule whose
      // targets are all deleted already blocks through V5.
      if (rulesOnly) r3.push(finding);
      else if (st.missing.answers) v9.push(finding);
    } else if (st.reason === "impossible" && st.impossible) {
      r4.push({
        message: REPORT_COPY.ruleImpossible(
          st.number,
          st.impossible.needs,
          st.impossible.qNumber !== null ? `Q${st.impossible.qNumber}` : null,
          st.impossible.canPick,
        ),
        link: ruleLink(st.ruleId),
      });
    } else if (st.reason === "shadowed") {
      v8.push({
        message: REPORT_COPY.ruleNeverRuns(st.number, st.neverRuns ?? ""),
        link: ruleLink(st.ruleId),
      });
    }
  }

  // R1/R2 — Rules only needs a rule that can show something (D3).
  const r1: Tier1Finding[] = [];
  const r2: Tier1Finding[] = [];
  if (rulesOnly) {
    if (rules.length === 0) {
      r1.push({ message: REPORT_COPY.rulesOnlyNeedsRule, link: { kind: "rules" } });
    } else {
      const canRun = rules.some((r) => statusOf(r.id)?.canRun);
      const shows = rules.some((r) => ruleShowsRecommendations(r, statusOf(r.id), "rules"));
      if (!canRun || !shows) {
        r2.push({
          message: !canRun ? REPORT_COPY.noRuleCanRun : REPORT_COPY.noRuleShows,
          link: { kind: "rules" },
        });
      }
    }
  }

  // R5 — a quiz-scoped recommendation nothing can show (warn, both styles):
  // the shared coverage helper, so the strip and this finding agree.
  const recIds =
    opts.recommendationIds ??
    (buckets.some((b) => b.quizId !== undefined)
      ? buckets.filter((b) => b.quizId).map((b) => b.id)
      : null);
  const r5: Tier1Finding[] = [];
  // P1-3: Rules only with ZERO rules lists only "needs at least one rule";
  // the mock names uncovered recommendations only once rules exist.
  if (recIds && !(rulesOnly && rules.length === 0)) {
    const coverage = recommendationCoverage(
      doc,
      rulesOnly ? "rules" : "attributes",
      recIds,
      statuses,
    );
    for (const id of recIds) {
      if (coverage.get(id)?.covered) continue;
      r5.push({
        message: REPORT_COPY.neverRecommended(buckets.find((b) => b.id === id)?.name ?? id),
        link: {
          kind: "recommendation",
          categoryId: id,
          ...(decider ? { nodeId: decider.id } : {}),
        },
      });
    }
  }

  // R0 — the screen opens on Rules only (inferred / legacy session key) but
  // the doc stores no style, so shoppers still get Filter Results + Rules.
  // A warning only; nothing here ever writes the style (D5). Opt-in
  // (`opts.styleNote`): only a host with the title switch (the funnel Logic
  // step) can act on it — the builder has no style control while D6 is
  // parked, so it never sees this row.
  const r0: Tier1Finding[] =
    opts.styleNote &&
    !rulesOnly &&
    doc.logic_style === undefined &&
    resolveLogicStyle(doc) === "rules"
      ? [{ message: REPORT_COPY.styleNotSaved, link: { kind: "style" } }]
      : [];

  // V10 — answer length advisory (§10 — NEVER blocks).
  const v10: Tier1Finding[] = [];
  for (const n of questions) {
    if (n.type !== "question" || isFreeformType(n.data.question_type)) continue;
    for (const a of n.data.answers) {
      if (a.text.length >= ANSWER_ADVISORY_LEN) {
        v10.push({
          message: REPORT_COPY.answerLong(qLabel(n.id), a.text.slice(0, 40)),
          link: { kind: "question", nodeId: n.id },
        });
      }
    }
  }

  // S1 — every OTHER publish-gate issue (orphans, dead ends, broken routing,
  // missing fallbacks, …). Without this fold-in the footer could say "safe to
  // publish" while quizPublish throws on the very same doc — the one thing a
  // path tester must never do. Decider kinds are excluded (V1–V6 cover them).
  // The gate's own messages stay as they are; the report shows each kind in
  // merchant words (reportCopy.structureMessage, D18).
  const typeOf = (id: string) => doc.nodes.find((n) => n.id === id)?.type;
  const placeOf = (id: string): string => {
    if (qIndex.has(id)) return qLabel(id);
    const t = typeOf(id);
    const P = REPORT_COPY.place;
    return t === "intro" ? P.intro : t === "result" ? P.result : t === "end" ? P.end : P.step;
  };
  const s1: Tier1Finding[] = gateIssues
    .filter((i) => !DECIDER_KINDS.has(i.kind))
    .map((i) => ({
      message: structureMessage(i.kind, i.message, placeOf(i.nodeId), typeOf(i.nodeId)),
      ...(qIndex.has(i.nodeId) ? { link: { kind: "question" as const, nodeId: i.nodeId } } : {}),
    }));

  // QZY-1 (spec §5/§8) — V11: every filter answer must match ≥1 sellable
  // product; 0 = a dead end that blocks every path traversing that answer.
  // "No preference" / unmapped answers return null from the counter and are
  // pass-throughs, never dead ends.
  const v11: Tier1Finding[] = [];
  if (productIndex) {
    const sellable = productIndex.filter(isSellable);
    for (const q of questions) {
      if (q.type !== "question" || q.data.role !== "filter") continue;
      // One finding per question (handoff §13 count rule).
      const empty = q.data.answers.filter((a) => filterAnswerMatchCount(a, sellable) === 0);
      if (empty.length === 0) continue;
      v11.push({
        message:
          empty.length === 1
            ? REPORT_COPY.keepsNoProducts(qLabel(q.id), empty[0]!.text)
            : REPORT_COPY.answersKeepNoProducts(qLabel(q.id), empty.length),
        link: { kind: "question", nodeId: q.id },
      });
    }
  }

  // QZY-12 §6.3 — slider RANGE-BAND coverage: bands must cover the full
  // scale; a gap is a BLOCKING dead end (a shopper can land where no band —
  // and so no mapping/route — exists). Overlaps flag as warnings (first band
  // wins, like rules). Sliders WITHOUT bands are legacy-valid.
  const v12: Tier1Finding[] = [];
  const v12warn: Tier1Finding[] = [];
  for (const q of questions) {
    if (q.type !== "question" || q.data.question_type !== "slider") continue;
    if (sliderBandAnswers(q.data.answers).length === 0) continue;
    const min = q.data.scale_config?.min ?? 0;
    const max = q.data.scale_config?.max ?? 100;
    const step = q.data.scale_config?.step ?? 1;
    const cov = bandCoverage(q.data.answers, min, max, step);
    for (const [from, to] of cov.gaps) {
      v12.push({
        message: REPORT_COPY.bandGap(qLabel(q.id), from, to),
        link: { kind: "question", nodeId: q.id },
      });
    }
    for (const [from, to] of cov.overlaps) {
      v12warn.push({
        message: REPORT_COPY.bandOverlap(qLabel(q.id), from, to),
        link: { kind: "question", nodeId: q.id },
      });
    }
  }

  // Logic-step module 15 (Live M) — the three gates the shipped set lacked.
  // V13 (WARN): an unmapped narrowing answer never narrows — the shopper's
  // choice is silently ignored. Pass-through stays first-class (§5), so this
  // warns rather than blocks; "No preference" is deliberate and exempt.
  const v13: Tier1Finding[] = [];
  for (const q of questions) {
    if (q.type !== "question" || q.data.role !== "filter") continue;
    // One row per question; "Keeps everything" answers are chosen, not unset.
    const unset = q.data.answers.filter(
      (a) => a.no_preference !== true && answerFilterValues(a) === null,
    ).length;
    if (unset) {
      v13.push({
        message: REPORT_COPY.keepsEverything(qLabel(q.id), unset),
        link: { kind: "question", nodeId: q.id },
      });
    }
  }
  // V14 (INFO): not-live products. isSellable now drops non-active products
  // (§7 bug 2 root fix), so they can never reach a shopper — this reports
  // the count rather than blocking.
  const v14: Tier1Finding[] = [];
  if (productIndex) {
    const notLive = productIndex.filter(
      (p) => p.status !== undefined && p.status.toLowerCase() !== "active",
    ).length;
    if (notLive > 0) {
      v14.push({
        message: REPORT_COPY.notLive(notLive, productIndex.length),
      });
    }
  }
  // V15 (WARN): weak narrowing — one answer keeps >90% of the catalog, so
  // most shoppers land in the same bucket. Allowed, but worth knowing.
  const v15: Tier1Finding[] = [];
  if (productIndex) {
    const sellable = productIndex.filter(isSellable);
    if (sellable.length >= 5) {
      for (const q of questions) {
        if (q.type !== "question" || q.data.role !== "filter") continue;
        const counts = q.data.answers
          .map((a) => filterAnswerMatchCount(a, sellable))
          .filter((n): n is number => n !== null && n > 0);
        if (counts.length === 0) continue;
        const largest = Math.max(...counts);
        if (largest > 0.9 * sellable.length) {
          v15.push({
            message: REPORT_COPY.weakNarrowing(qLabel(q.id), largest, sellable.length),
            link: { kind: "question", nodeId: q.id },
          });
        }
      }
    }
  }

  // V16 (INFO, Live-M gate 4): "The starting set covers the catalog" —
  // every sellable product should belong to at least one result set, or a
  // shopper routed there can never be shown it. Runs only when the host
  // supplies bucket memberships AND the doc actually references buckets.
  const v16: Tier1Finding[] = [];
  const bucketsWithMembers = buckets.filter((b) => Array.isArray(b.productIds));
  if (productIndex && bucketsWithMembers.length > 0) {
    const inAnySet = new Set(bucketsWithMembers.flatMap((b) => b.productIds ?? []));
    const sellable = productIndex.filter(isSellable);
    const uncovered = sellable.filter((p) => !inAnySet.has(p.product_id)).length;
    if (uncovered > 0) {
      v16.push({
        message: REPORT_COPY.outsideEverySet(uncovered, sellable.length),
      });
    }
  }

  // Logic step D3 — Rules only skips every picking-question check (V1–V4)
  // and every filter-value check (V11, V13, V15), blocks on R1–R3, and
  // downgrades a slider band gap to a warning (the rules that needed that
  // band just don't fire; the safety net catches the shopper).
  // Handoff §13 (D1/D5): while R0 fires, the screen shows Rules only but
  // the engine still runs Filter Results + Rules. Every Filter block that
  // fires beside it carries the same sentence, so the merchant is never told
  // to fix a control the screen does not draw without knowing why.
  const explain = (fs: Tier1Finding[]): Tier1Finding[] =>
    r0.length > 0
      ? fs.map((f) => ({ ...f, message: `${f.message} ${REPORT_COPY.styleNotSaved}` }))
      : fs;
  const T = REPORT_COPY.titles;
  const pickingChecks: Tier1Check[] = rulesOnly
    ? []
    : [
        check("V1", "block", T.V1, explain(v1)),
        check("V2", "block", T.V2, explain(v2)),
        check("V3", "block", T.V3, explain(v3)),
        check("V4", "block", T.V4, explain(v4)),
      ];
  const rulesOnlyChecks: Tier1Check[] = rulesOnly
    ? [
        check("R1", "block", T.R1, r1),
        check("R2", "block", T.R2, r2),
        check("R3", "block", T.R3, r3),
      ]
    : [];
  const checks: Tier1Check[] = [
    ...(r0.length > 0 ? [check("R0", "warn", T.R0, r0)] : []),
    ...pickingChecks,
    ...rulesOnlyChecks,
    check("V5", "block", T.V5, v5),
    check("V6", "block", T.V6, v6),
    check("V7", "warn", T.V7, v7),
    check("V8", "warn", T.V8, v8),
    ...(rulesOnly ? [] : [check("V9", "warn", T.V9, v9)]),
    check("R4", "warn", T.R4, r4),
    ...(recIds ? [check("R5", "warn", T.R5, r5)] : []),
    check("V10", "info", T.V10, v10),
    ...(productIndex && !rulesOnly ? [check("V11", "block", T.V11, explain(v11))] : []),
    check("V12", rulesOnly ? "warn" : "block", T.V12gap, v12),
    check("V12", "warn", T.V12overlap, v12warn),
    ...(rulesOnly ? [] : [check("V13", "warn", T.V13, v13)]),
    ...(productIndex
      ? [
          check("V14", "info", T.V14, v14),
          ...(rulesOnly ? [] : [check("V15", "warn", T.V15, v15)]),
        ]
      : []),
    ...(productIndex && bucketsWithMembers.length > 0 ? [check("V16", "info", T.V16, v16)] : []),
    check("S1", "block", T.S1, s1),
  ];

  const outcomes: Tier1OutcomeRow[] = outcomeTable(doc)
    // Rules only never reads answer mappings — only rule outcomes exist.
    .filter((row) => !(rulesOnly && row.kind === "mapping"))
    .map((row) => ({
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

// ════════════════════════════════════════════════════════════════════════════
// BLD-1 — the builder's model-agnostic health adapter. The standalone builder
// replaces its "N to fix before publishing" banner with the Step-3 health
// pill/popover, but it serves BOTH logic models: decider docs get the full
// Tier-1 report above; legacy docs (direct/weighted scoring) synthesize the
// SAME Tier1Report shape from the publish gate (validateQuiz → S1, blocking)
// plus the advisory pass (validateQuizWarnings → S2, warn) — so the pill, the
// popover and the tri-state Publish read one verdict for either model and can
// never disagree with the gate (`safe` ⇔ validateQuiz is clean in both arms).
// ════════════════════════════════════════════════════════════════════════════
export function buildBuilderHealthReport(
  doc: QuizDoc,
  buckets: Array<{ id: string; name: string; productIds?: string[]; quizId?: string | null }>,
  // Logic step — optional so existing callers are unchanged; passing it
  // runs V11/V14–V16 in the builder too (the server gate already does).
  productIndex?: readonly IndexedProduct[],
): Tier1Report {
  if (doc.logic_model === "decider") return buildTier1Report(doc, buckets, productIndex);
  const gate = validateQuiz(doc);
  const advisories = validateQuizWarnings(doc);
  // Tier1Link's "question" kind means "focus this node" to every consumer —
  // gate issues pin to intro/result nodes too, and selecting those is right.
  const toFinding = (i: { nodeId: string; message: string }): Tier1Finding => ({
    message: i.message,
    link: { kind: "question", nodeId: i.nodeId },
  });
  const checks: Tier1Check[] = [
    {
      id: "S1",
      severity: "block",
      title: "Structure — every step wired and reachable",
      status: gate.length === 0 ? "pass" : "fail",
      findings: gate.map(toFinding),
    },
    {
      id: "S2",
      severity: "warn",
      title: "Suggestions — won't block publishing",
      status: advisories.length === 0 ? "pass" : "fail",
      findings: advisories.map(toFinding),
    },
  ];
  const blocking = gate.length;
  const warnings = advisories.length;
  const safe = blocking === 0;
  return {
    checks,
    outcomes: [],
    verdict: {
      blocking,
      warnings,
      safe,
      label: `${warnings} to review · ${blocking} blocking · ${safe ? "safe" : "not safe"} to publish`,
    },
  };
}
