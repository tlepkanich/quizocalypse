import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";

// LOGIC v2 §7 — the "Test all paths" report overlay. Tier 1 (deterministic
// structure/validity, buildTier1Report) renders in full; Tier 2 (AI quality
// review) is a LABELED separate section per the spec's hard line — a
// placeholder until L2-12's owner-gated AI pass. Mountable anywhere (the owner
// wants the tester "in many places"): it needs only doc + categories + an
// onNavigate for deep links. Computed live from the current doc on every open
// (pure + sync — always fresh, no stale re-run state). Portaled to
// document.body (the builder-overlay-portal lesson).
export function PathReportPanel({
  doc,
  categories,
  onClose,
  onNavigate,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  onClose: () => void;
  /** Deep-link handler — the host closes the overlay and focuses the
   *  question card / switches to the Rules tab. */
  onNavigate: (link: Tier1Link) => void;
}) {
  const report = useMemo(() => buildTier1Report(doc, categories), [doc, categories]);

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

          {/* ── Tier 2 — SEPARATE by spec mandate; placeholder until L2-12 ── */}
          <div className="qz-ql-report-tier">Tier 2 · Recommendation quality (AI review)</div>
          <p className="qz-ql-report-tier2ph">
            An AI pass that reads each answer path and judges whether the recommendation makes
            sense arrives in a later update. It reviews quality only — the correctness checks
            above never depend on it.
          </p>
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
