import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";
import { outcomeTable } from "../../../lib/pathAnalyzer";
import { pathReportHash, isPathReportStale } from "../../../lib/pathReportMeta";

// LOGIC v2 §7 — the "Test all paths" report overlay. Tier 1 (deterministic
// structure/validity, buildTier1Report) renders in full; Tier 2 (AI quality
// review, L2-12c) is a LABELED separate ADVISORY section — the "Run AI quality
// review" button fills doc.path_report_ai (draft-only, stripped at publish) and
// NEVER gates publish. Mountable anywhere (the owner wants the tester "in many
// places"): it needs doc + categories + quizId + onCommit + onNavigate. Tier 1
// is computed live from the current doc on every open (pure + sync — always
// fresh). Portaled to document.body (the builder-overlay-portal lesson).
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

  // ── Tier-2 advisory AI review (L2-12c) ──────────────────────────────────────
  // Race guard (the useQuizDraft beginAiEdit class): the fetch takes seconds and
  // the merchant may keep editing; compose the commit against the LATEST doc.
  const docRef = useRef(doc);
  docRef.current = doc;
  const [aiState, setAiState] = useState<
    { state: "idle" | "busy" } | { state: "error"; message: string }
  >({ state: "idle" });
  // Synchronous single-flight (a React-state check can double-fire on a rapid
  // double-click before the "busy" state commits — a wasted paid AI call).
  const inFlight = useRef(false);
  const aiReport = doc.path_report_ai;
  const currentHash = useMemo(() => pathReportHash(doc), [doc]);
  const aiStale = isPathReportStale(aiReport, currentHash);

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

  const runReview = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setAiState({ state: "busy" });
    // Flush the pending autosave so the server reviews the merchant's LIVE draft,
    // not a debounced-stale one; snapshot the reviewed structure NOW so the
    // stored staleness hash is anchored to exactly what the rows describe (a
    // during-fetch edit then correctly re-flags stale).
    onFlush();
    const reviewedHash = pathReportHash(docRef.current);
    try {
      const res = await fetch("/api/path-quality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quizId }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        review?: { outcome_id: string; verdict: string; note: string }[];
        meta?: { at: string; hash: string };
        error?: string;
      };
      if (!body.ok || !body.review || !body.meta) {
        setAiState({ state: "error", message: body.error ?? "Quality review failed — try again." });
        return;
      }
      // One sparse commit against the CURRENT doc (nothing else touched). The
      // hash is CLIENT-computed over the reviewed structure — NOT the server's
      // meta.hash, which could be a debounced-stale snapshot → a spurious "stale"
      // banner the instant the review lands.
      onCommit({
        ...docRef.current,
        path_report_ai: { at: body.meta.at, hash: reviewedHash, rows: body.review },
      });
      setAiState({ state: "idle" });
    } catch {
      setAiState({ state: "error", message: "Quality review failed — try again." });
    } finally {
      inFlight.current = false;
    }
  };

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
          {/* ── Tier 1 — structure & validity ── */}
          <div className="qz-ql-report-tier">Tier 1 · Structure &amp; validity</div>
          <ul className="qz-ql-report-checks">
            {report.checks.map((c) => (
              <li key={c.id} className={`qz-ql-check is-${c.status === "pass" ? "pass" : c.severity}`}>
                <div className="qz-ql-check-head">
                  <span className="qz-ql-check-glyph" aria-hidden>
                    {c.status === "pass" ? "✓" : c.severity === "block" ? "✕" : c.severity === "warn" ? "⚠" : "ⓘ"}
                  </span>
                  <span className="qz-ql-check-id">{c.id}</span>
                  <span className="qz-ql-check-title">{c.title}</span>
                  <span className="qz-sr-only">
                    {c.status === "pass" ? " — passed" : ` — ${c.findings.length} finding(s)`}
                  </span>
                </div>
                {c.findings.length > 0 ? (
                  <ul className="qz-ql-check-findings">
                    {c.findings.map((f, i) => (
                      <li key={i}>
                        {f.message}{" "}
                        {f.link ? (
                          <button
                            type="button"
                            className="qz-ql-report-goto"
                            onClick={() => onNavigate(f.link!)}
                          >
                            Go to it →
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>

          {/* ── Outcome table (linear: decider answers ∪ rules) ── */}
          <div className="qz-ql-report-tier">Every possible outcome</div>
          {report.outcomes.length === 0 ? (
            <p className="qz-dim" style={{ fontSize: 12.5 }}>
              No outcomes yet — pick a deciding question and map its answers.
            </p>
          ) : (
            <table className="qz-ql-report-outcomes">
              <thead>
                <tr>
                  <th>Via</th>
                  <th>When the shopper picks</th>
                  <th>They get</th>
                  <th>Reachable</th>
                </tr>
              </thead>
              <tbody>
                {report.outcomes.map((o, i) => (
                  <tr key={i}>
                    <td>{o.kind === "rule" ? "Rule" : "Answer"}</td>
                    <td>{o.label}</td>
                    <td>{o.targetName}</td>
                    <td>{o.reachable ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── Tier 2 — SEPARATE by spec mandate; ADVISORY AI (L2-12c) ── */}
          <div className="qz-ql-report-tier qz-ql-report-tier--ai">
            <span>Tier 2 · Recommendation quality (AI review)</span>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={runReview}
              disabled={aiState.state === "busy"}
              aria-busy={aiState.state === "busy"}
            >
              {aiState.state === "busy" ? "Reviewing…" : "✦ Run AI quality review"}
            </button>
          </div>
          <p className="qz-ql-report-tier2note">
            An AI pass reads each answer path and judges whether the recommendation makes sense. It
            reviews quality only — <strong>advisory, it never blocks publishing</strong>; the
            correctness checks above never depend on it.
          </p>
          <div role="status" aria-live="polite">
          {aiState.state === "error" ? (
            <p className="qz-ql-report-aierr">{aiState.message}</p>
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
