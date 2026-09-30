import type { ReactNode } from "react";
import type { Tier1Check, Tier1Link, Tier1Report } from "../../../../lib/pathReport";
import { CHECK_COPY } from "../../../studio/logicTab/logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the check popover (mock checkPop; handoff "Checks,
// the Fix-N gate, the check popover and Continue", D3/D4). Anchored under
// the funnel bar's CTA ("Fix N issues to continue"), 360px, right-aligned —
// Step1Funnel owns the QzPopover (FunnelContinueSpec.popover); this file is
// the CONTENT only.
//
// Fed by the SAME Tier-1 report instance as the CTA's count, so the two can
// never disagree. Rows: blocking findings first, then warnings (R0, the
// unsaved-style note, first among them), then notes. V10 and V16 are
// computed but not listed here (they stay in the builder's Tier1CheckList).
// A row with a target is a real button that jumps (the host closes the
// popover and sends a focus request); a row without one is plain text.
// The footer slot stays empty: diagnostics hang off it later (D4, parked).
// Render from the LIVE report, never a snapshot (B28).
// ════════════════════════════════════════════════════════════════════════════

export type CheckSeverity = "crit" | "warn" | "note";

export type CheckRow = {
  key: string;
  checkId: Tier1Check["id"];
  severity: CheckSeverity;
  message: string;
  link?: Tier1Link;
};

const UNLISTED = new Set<Tier1Check["id"]>(["V10", "V16"]);

/** The popover's rows, in the handoff's order. Pure (exported for tests). */
export function checkRows(report: Tier1Report): CheckRow[] {
  const rows: CheckRow[] = [];
  const sev = (c: Tier1Check): CheckSeverity =>
    c.severity === "block" ? "crit" : c.severity === "warn" ? "warn" : "note";
  for (const c of report.checks) {
    if (c.status !== "fail" || UNLISTED.has(c.id)) continue;
    c.findings.forEach((f, i) => {
      rows.push({
        key: `${c.id}:${i}`,
        checkId: c.id,
        severity: sev(c),
        message: f.message,
        ...(f.link ? { link: f.link } : {}),
      });
    });
  }
  const rank = (r: CheckRow) =>
    r.severity === "crit" ? 0 : r.severity === "warn" ? (r.checkId === "R0" ? 1 : 2) : 3;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** The popover title (mock checkPop). */
export function checkTitle(rows: readonly CheckRow[]): string {
  const crit = rows.filter((r) => r.severity === "crit").length;
  const warn = rows.filter((r) => r.severity === "warn").length;
  return crit ? CHECK_COPY.fix(crit) : warn ? CHECK_COPY.review(warn) : CHECK_COPY.clean;
}

export function CheckPopover({
  report,
  onJump,
  footer,
}: {
  report: Tier1Report;
  /** A row was chosen: the host closes the popover and shows the target. */
  onJump: (row: CheckRow) => void;
  /** Diagnostics (D4, parked). Nothing renders until a host passes one. */
  footer?: ReactNode;
}) {
  const rows = checkRows(report);
  return (
    <div className="qz-lg-check" data-testid="logic-check-popover">
      <div className="qz-lg-pt" tabIndex={-1}>
        {checkTitle(rows)}
      </div>
      {rows.length ? (
        <ul className="qz-lg-findlist" data-qz-pop-list aria-label={CHECK_COPY.label}>
          {rows.map((r) => {
            const body = (
              <>
                <span className={`qz-lg-sv is-${r.severity}`} aria-hidden />
                <span className="qz-lg-sr">{CHECK_COPY.severity[r.severity]}: </span>
                <span className="qz-lg-find-t">{r.message}</span>
              </>
            );
            return (
              <li key={r.key}>
                {r.link || r.checkId === "V1" ? (
                  <button type="button" className="qz-lg-find" onClick={() => onJump(r)}>
                    {body}
                  </button>
                ) : (
                  <div className="qz-lg-find">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {footer ? <div className="qz-lg-checkfoot">{footer}</div> : null}
    </div>
  );
}
