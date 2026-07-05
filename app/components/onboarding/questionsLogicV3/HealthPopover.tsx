import { useMemo } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { Tier1Link, Tier1Report } from "../../../lib/pathReport";
import { outcomeTable } from "../../../lib/pathAnalyzer";
import { Tier1CheckList } from "../questionsLogic/Tier1CheckList";
import { usePathQuality } from "../questionsLogic/usePathQuality";

/* quiz-step3 v3 / QL3-P4 — the health popover body: the reused Tier-1
   check list (deep links wired to the v3 surfaces by the shell's onNavigate)
   plus the ✦ Tier-2 advisory AI review — the SAME safety semantics as
   PathReportPanel (usePathQuality: synchronous single-flight, flushSave
   BEFORE the client-computed staleness hash, sparse commit), restyled to the
   v3 tokens. Tier 2 is ADVISORY by spec mandate: nothing here feeds the
   Continue gate — a 402/502/stale review can never block advancing.
   The report arrives as a PROP (Step3Shell's single memoized instance) —
   this component never calls buildTier1Report itself. */

export function HealthPopover({
  report,
  doc,
  quizId,
  onCommit,
  onFlush,
  onNavigate,
  tier2 = true,
  showOutcomes = true,
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

  return (
    <div className="qz-s3-health" aria-label="Quiz health report">
      <div className="qz-s3-health-head">
        <span className="qz-s3-health-title">Test all paths</span>
        {/* §7.3 verdict — the same string the pill's tooltip carries. */}
        <span className={`qz-s3-health-verdict ${report.verdict.safe ? "is-safe" : "is-blocked"}`}>
          {report.verdict.label}
        </span>
      </div>

      <Tier1CheckList report={report} onNavigate={onNavigate} showOutcomes={showOutcomes} />

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
