import type { Tier1Link, Tier1Report } from "../../../lib/pathReport";

// LOGIC v2 §7 — the Tier-1 (deterministic structure/validity) section of the
// path report: the ✓/✕/⚠/ⓘ checks list with "Go to it →" deep links, plus the
// outcome table (linear: decider answers ∪ rules). Presentational only —
// extracted verbatim from PathReportPanel so the Step-3 health popover can
// render it without the overlay shell.
export function Tier1CheckList({
  report,
  onNavigate,
}: {
  report: Tier1Report;
  /** Deep-link handler — the host closes its surface and focuses the
   *  question card / switches to the Rules tab. */
  onNavigate: (link: Tier1Link) => void;
}) {
  return (
    <>
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
    </>
  );
}
