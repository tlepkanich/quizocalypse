import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";
import { outcomeTable } from "../../../lib/pathAnalyzer";
import { Tier1CheckList } from "./Tier1CheckList";
import { usePathQuality } from "./usePathQuality";

// LOGIC v2 §7 — the "Test all paths" report overlay. Tier 1 (deterministic
// structure/validity, buildTier1Report) renders in full; Tier 2 (AI quality
// review, L2-12c) is a LABELED separate ADVISORY section — the "Run AI quality
// review" button fills doc.path_report_ai (draft-only, stripped at publish) and
// NEVER gates publish. Mountable anywhere (the owner wants the tester "in many
// places"): it needs doc + categories + quizId + onCommit + onNavigate. Tier 1
// is computed live from the current doc on every open (pure + sync — always
// fresh). Portaled to document.body (the builder-overlay-portal lesson).
// Composition (QL3-P0b): Tier1CheckList renders the Tier-1 section, the
// usePathQuality hook owns the Tier-2 review flow — this file is the shell.
export function PathReportPanel({
  doc,
  categories,
  quizId,
  onCommit,
  onFlush,
  onClose,
  onNavigate,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  quizId: string;
  /** Persists the advisory result into the draft (funnel useQuizDraft autosave). */
  onCommit: (doc: QuizDoc) => void;
  /** Flush the pending autosave so the server reviews the LIVE draft, not stale. */
  onFlush: () => void;
  onClose: () => void;
  /** Deep-link handler — the host closes the overlay and focuses the
   *  question card / switches to the Rules tab. */
  onNavigate: (link: Tier1Link) => void;
}) {
  const report = useMemo(() => buildTier1Report(doc, categories), [doc, categories]);

  // ── Tier-2 advisory AI review (L2-12c) — extracted to usePathQuality ──────
  const {
    report: aiReport,
    busy: aiBusy,
    error: aiError,
    isStale: aiStale,
    runReview,
  } = usePathQuality({ doc, quizId, onCommit, onFlush });

  // outcome_id → deep link: a rule id → Rules tab; else a decider answer id →
  // the decider question card.
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

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="qz-ql-report-scrim" onMouseDown={onClose}>
      <div
        className="qz-ql-report"
        role="dialog"
        aria-modal="true"
        aria-label="Test all paths report"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="qz-ql-report-head">
          <div>
            <div className="qz-ql-report-title">Test all paths</div>
            <div className="qz-ql-report-sub">
              Computed live from the current draft — every check below is deterministic graph
              analysis, no AI.
            </div>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="qz-ql-report-close"
            aria-label="Close the report"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="qz-ql-report-body">
          <Tier1CheckList report={report} onNavigate={onNavigate} />

          {/* ── Tier 2 — SEPARATE by spec mandate; ADVISORY AI (L2-12c) ── */}
          <div className="qz-ql-report-tier qz-ql-report-tier--ai">
            <span>Tier 2 · Recommendation quality (AI review)</span>
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
          <p className="qz-ql-report-tier2note">
            An AI pass reads each answer path and judges whether the recommendation makes sense. It
            reviews quality only — <strong>advisory, it never blocks publishing</strong>; the
            correctness checks above never depend on it.
          </p>
          <div role="status" aria-live="polite">
          {aiError !== null ? (
            <p className="qz-ql-report-aierr">{aiError}</p>
          ) : null}
          {aiReport ? (
            <>
              {aiStale ? (
                <p className="qz-ql-report-aistale">
                  ⚠ Your logic changed since this review ran — re-run for current advice.
                </p>
              ) : null}
              {aiReport.rows.length === 0 ? (
                <p className="qz-dim" style={{ fontSize: 12.5 }}>
                  The review returned no outcomes to flag.
                </p>
              ) : (
                <ul className="qz-ql-report-airows">
                  {aiReport.rows.map((r, i) => {
                    const { link, label } = linkForOutcome(r.outcome_id);
                    const review = r.verdict === "review";
                    return (
                      <li key={i} className={`qz-ql-airow is-${review ? "review" : "ok"}`}>
                        <span className="qz-ql-airow-glyph" aria-hidden>
                          {review ? "⚠" : "✓"}
                        </span>
                        <span className="qz-ql-airow-body">
                          <span className="qz-ql-airow-path">{label}</span>
                          <span className="qz-ql-airow-note">{r.note}</span>
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
        </div>

        {/* §7.3 footer verdict */}
        <footer className={`qz-ql-report-verdict ${report.verdict.safe ? "is-safe" : "is-blocked"}`}>
          {report.verdict.label}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
