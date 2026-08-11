import { useMemo } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { Tier1Link, Tier1Report } from "../../../lib/pathReport";
import { outcomeTable } from "../../../lib/pathAnalyzer";
import { straightThroughRun } from "../../../lib/quizMutations";
import { Tier1CheckList } from "../../shared/health/Tier1CheckList";
import { usePathQuality } from "../../shared/health/usePathQuality";

/* quiz-step3 v3 / QL3-P4 — the health popover body: the reused Tier-1
   check list (deep links wired to the v3 surfaces by the shell's onNavigate)
   plus the ✦ Tier-2 advisory AI review — the SAME safety semantics as
   PathReportPanel (usePathQuality: synchronous single-flight, flushSave
   BEFORE the client-computed staleness hash, sparse commit), restyled to the
   v3 tokens. Tier 2 is ADVISORY by spec mandate: nothing here feeds the
   Continue gate — a 402/502/stale review can never block advancing.
   The report arrives as a PROP (Step3Shell's single memoized instance) —
   this component never calls buildTier1Report itself. */

// QRTZ-S4 — number-word header per the states.mjs pb card ("Two things to
// fix before publishing"); numerals past nine keep the sentence honest.
const COUNT_WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

export function HealthPopover({
  report,
  doc,
  quizId,
  onCommit,
  onFlush,
  onNavigate,
  tier2 = true,
  showOutcomes = true,
  publishBlocked = false,
}: {
  report: Tier1Report;
  doc: QuizDoc;
  quizId: string;
  /** Persists the advisory result into the draft (funnel useQuizDraft autosave). */
  onCommit: (doc: QuizDoc) => void;
  /** Flush the pending autosave so the server reviews the LIVE draft, not stale. */
  onFlush: () => void;
  /** Deep-link handler — the shell closes the popover and jumps the surface. */
  onNavigate: (link: Tier1Link) => void;
  /** BLD-1 — decider-only sections, hidden when the builder hosts a LEGACY
   *  doc: the ✦ Tier-2 path review reads decision_rules, and the outcome
   *  table's empty state coaches "pick a deciding question". Both stay on
   *  (default) for every decider surface. */
  tier2?: boolean;
  showOutcomes?: boolean;
  /** QRTZ-S4 — the BUILDER's publish gate opts in: blocking findings render
   *  as the states.mjs pb card (crit-bordered, one row per issue, uppercase
   *  path labels, each row deep-links) with the foot sentence. Default off so
   *  the funnel surface (where the gate is Continue, not Publish) is
   *  byte-identical. */
  publishBlocked?: boolean;
}) {
  const {
    report: aiReport,
    busy: aiBusy,
    error: aiError,
    isStale: aiStale,
    runReview,
  } = usePathQuality({ doc, quizId, onCommit, onFlush });

  // outcome_id → deep link (the PathReportPanel recipe): a rule id → that
  // rule; else a decider answer id → the decider question.
  const linkForOutcome = useMemo(() => {
    const ruleIds = new Set((doc.decision_rules ?? []).map((r) => r.id));
    const deciderId = doc.nodes.find(
      (n) => n.type === "question" && n.data.role === "decides",
    )?.id;
    const labels = new Map(outcomeTable(doc).map((o) => [o.id, o.label]));
    return (outcomeId: string): { link: Tier1Link | null; label: string } => {
      const label = labels.get(outcomeId) ?? outcomeId;
      if (ruleIds.has(outcomeId)) return { link: { kind: "rule", ruleId: outcomeId }, label };
      if (deciderId) return { link: { kind: "question", nodeId: deciderId }, label };
      return { link: null, label };
    };
  }, [doc]);

  // QRTZ-S4 — the pb card's rows: every finding of a failing BLOCKING check,
  // with an uppercase path label derived from its deep link (Q-number for
  // questions in flow order, node kind otherwise, rule index for rules).
  const blockingFindings = useMemo(() => {
    if (!publishBlocked) return [];
    return report.checks
      .filter((c) => c.severity === "block" && c.status === "fail")
      .flatMap((c) => c.findings);
  }, [publishBlocked, report]);
  const pathLabel = useMemo(() => {
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    const qNum = new Map<string, number>();
    let q = 0;
    for (const id of straightThroughRun(doc).run) {
      if (byId.get(id)?.type === "question") qNum.set(id, ++q);
    }
    const kindNames: Record<string, string> = {
      intro: "Intro",
      email_gate: "Email",
      result: "Results",
      end: "End",
      message: "Message",
      ask_ai: "Ask AI",
      integration: "Integration",
      branch: "Branch",
      product_cards: "Products",
    };
    return (link?: Tier1Link): string => {
      if (!link) return "Quiz";
      if (link.kind === "rule") {
        const idx = (doc.decision_rules ?? []).findIndex((r) => r.id === link.ruleId);
        return idx >= 0 ? `Rule ${idx + 1}` : "Rule";
      }
      const node = link.nodeId ? byId.get(link.nodeId) : undefined;
      if (!node) return "Quiz";
      if (node.type === "question") {
        const n = qNum.get(node.id);
        return n ? `Q${n}` : "Question";
      }
      return kindNames[node.type] ?? "Step";
    };
  }, [doc]);
  // With the pb card listing the blocking findings, the checklist below keeps
  // only passes / warnings / info — the same issue never renders twice.
  const checklistReport = useMemo(
    () =>
      blockingFindings.length > 0
        ? {
            ...report,
            checks: report.checks.filter(
              (c) => !(c.severity === "block" && c.status === "fail"),
            ),
          }
        : report,
    [blockingFindings.length, report],
  );

  return (
    <div className="qz-s3-health" aria-label="Quiz health report">
      <div className="qz-s3-health-head">
        <span className="qz-s3-health-title">Test all paths</span>
        {/* §7.3 verdict — the same string the pill's tooltip carries. */}
        <span className={`qz-s3-health-verdict ${report.verdict.safe ? "is-safe" : "is-blocked"}`}>
          {report.verdict.label}
        </span>
      </div>

      {blockingFindings.length > 0 ? (
        <div className="qz-pb" role="group" aria-label="Publish blocked">
          <div className="qz-pb-top">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 8v5" />
              <circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none" />
              <path d="M10.3 3.9 2.7 17.2A2 2 0 0 0 4.4 20.2h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            {COUNT_WORDS[blockingFindings.length - 1] ?? blockingFindings.length}{" "}
            {blockingFindings.length === 1 ? "thing" : "things"} to fix before publishing
          </div>
          <ul>
            {blockingFindings.map((f, i) => (
              <li key={i}>
                {f.link ? (
                  <button
                    type="button"
                    className="qz-pb-row"
                    onClick={() => onNavigate(f.link!)}
                  >
                    <b>{pathLabel(f.link)}</b>
                    <span>{f.message}</span>
                  </button>
                ) : (
                  <span className="qz-pb-row">
                    <b>{pathLabel(f.link)}</b>
                    <span>{f.message}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="qz-pb-foot">Publishing stays disabled until these are resolved.</p>
        </div>
      ) : null}

      <Tier1CheckList report={checklistReport} onNavigate={onNavigate} showOutcomes={showOutcomes} />

      {!tier2 ? null : (
        <>
      {/* ── ✦ Tier 2 — SEPARATE by spec mandate; ADVISORY AI (L2-12c) ── */}
      <div className="qz-s3-health-tier2">
        <span className="qz-s3-health-tier2label">✦ Tier 2 · Recommendation quality</span>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={runReview}
          disabled={aiBusy}
          aria-busy={aiBusy}
        >
          {aiBusy ? "Reviewing…" : "✦ Run AI quality review"}
        </button>
      </div>
      <p className="qz-s3-health-tier2note">
        An AI pass judges whether each path's recommendation makes sense —{" "}
        <strong>advisory, it never blocks continuing or publishing</strong>.
      </p>
      <div role="status" aria-live="polite">
        {aiError !== null ? <p className="qz-s3-health-aierr">{aiError}</p> : null}
        {aiReport ? (
          <>
            {aiStale ? (
              <p className="qz-s3-health-aistale">
                ⚠ Your logic changed since this review ran — re-run for current advice.
              </p>
            ) : null}
            {aiReport.rows.length === 0 ? (
              <p className="qz-s3-health-ainone">The review returned no outcomes to flag.</p>
            ) : (
              <ul className="qz-s3-airows">
                {aiReport.rows.map((r, i) => {
                  const { link, label } = linkForOutcome(r.outcome_id);
                  const review = r.verdict === "review";
                  return (
                    <li key={i} className={`qz-s3-airow is-${review ? "review" : "ok"}`}>
                      <span className="qz-s3-airow-glyph" aria-hidden>
                        {review ? "⚠" : "✓"}
                      </span>
                      <span className="qz-s3-airow-body">
                        <span className="qz-s3-airow-path">{label}</span>
                        <span className="qz-s3-airow-note">{r.note}</span>
                      </span>
                      {review && link ? (
                        <button
                          type="button"
                          className="qz-ql-report-goto"
                          onClick={() => onNavigate(link)}
                        >
                          Go to it →
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </div>
        </>
      )}
    </div>
  );
}
