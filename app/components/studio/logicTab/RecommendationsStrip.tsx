import { useEffect, useMemo, useRef, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { BuilderCategory } from "../../builder/stepProps";
import type { RuleStatus } from "../../../lib/ruleStatus";
import { recommendationCoverage } from "../../../lib/recommendationCoverage";
import { ruleTargets } from "../../../lib/recommendDecider";
import { QzPopover } from "../../qz-overlays";
import { STRIP_COPY, YOUR_RECOMMENDATIONS } from "./logicCopy";
import { useRowFit } from "./useRowFit";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — "Your recommendations" (mock vizRecs / fitRow /
// stripMoreHTML; handoff "Rules only · Edit" §3, D14).
//
//   YOUR RECOMMENDATIONS  n/N have a rule
//   [● a + Create a rule] [● b] [● c] … [+N more] [+ Add recommendations]
//
// The pool is THIS quiz's recommendations (Category rows with quizId set,
// the same pool the tray and the rule window use), in the host's order.
// "Has a rule" comes from the ONE style-aware coverage helper
// (recommendationCoverage), so the fraction, the dots, the "+N more" list
// and the "never recommended" finding can never disagree (B10).
//   • Order: uncovered first, then covered, each half stable.
//   • Uncovered pill = a dashed amber BUTTON: "Create a rule for <name>"
//     (onCreateFor, the rule window opens with it picked).
//   • Covered pill = a focusable span: "<name> · used by rules 1 and 3".
//   • Hover / focus on any pill lights the rules that LIST it, whatever
//     their verb (B49): reported through onLitChange, derived from state.
//   • One row, never more (useRowFit "one"): trailing pills collapse into
//     "+N more"; "+ Add recommendations" is never collapsed.
// ════════════════════════════════════════════════════════════════════════════

export type RecommendationsStripProps = {
  doc: Quiz;
  /** The SCREEN style (coverage is style-aware). */
  style: LogicStyle;
  /** This quiz's recommendations (quizId != null), in display order. */
  recommendations: readonly BuilderCategory[];
  /** ruleStatuses(doc, knownIds) — the host's one instance. */
  statuses: ReadonlyMap<string, RuleStatus>;
  /** Uncovered pill → open "Create a rule" with this recommendation picked.
   *  Absent = read-only (no create affordance). */
  onCreateFor?: (categoryId: string) => void;
  /** "+ Add recommendations" → the host opens its window. Absent = hidden. */
  onAddRecommendations?: () => void;
  /** The recommendation under the pointer / keyboard focus, or null. */
  onLitChange?: (categoryId: string | null) => void;
};

export function RecommendationsStrip({
  doc,
  style,
  recommendations,
  statuses,
  onCreateFor,
  onAddRecommendations,
  onLitChange,
}: RecommendationsStripProps) {
  const ids = useMemo(() => recommendations.map((r) => r.id), [recommendations]);
  const coverage = useMemo(
    () => recommendationCoverage(doc, style, ids, statuses),
    [doc, style, ids, statuses],
  );
  // Rules that LIST each recommendation (any verb) — the pill's text says
  // the same thing the lit rows show.
  const listing = useMemo(() => {
    const m = new Map<string, number[]>();
    (doc.decision_rules ?? []).forEach((r, i) => {
      for (const t of new Set(ruleTargets(r))) {
        const l = m.get(t) ?? [];
        l.push(i + 1);
        m.set(t, l);
      }
    });
    return m;
  }, [doc.decision_rules]);
  const covered = (id: string) => (coverage.get(id)?.rulesShowing.length ?? 0) > 0;
  const sorted = useMemo(
    () => [...recommendations].sort((a, b) => Number(covered(a.id)) - Number(covered(b.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- covered reads coverage
    [recommendations, coverage],
  );
  const done = recommendations.filter((r) => covered(r.id)).length;

  const rowRef = useRef<HTMLDivElement>(null);
  const fit = useRowFit(rowRef, {
    mode: "one",
    deps: [sorted.map((r) => `${r.id}:${r.name}:${covered(r.id) ? 1 : 0}`).join("|"), !!onCreateFor],
  });

  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!moreOpen) setQuery("");
  }, [moreOpen]);

  // The pointer leaving the window clears the light (B49: never stale).
  const litRef = useRef(onLitChange);
  litRef.current = onLitChange;
  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) litRef.current?.(null);
    };
    document.addEventListener("mouseout", onOut);
    return () => document.removeEventListener("mouseout", onOut);
  }, []);
  const lightProps = (id: string) => ({
    onMouseEnter: () => onLitChange?.(id),
    onMouseLeave: () => onLitChange?.(null),
    onFocus: () => onLitChange?.(id),
    onBlur: () => onLitChange?.(null),
  });

  const q = query.trim().toLowerCase();
  const moreList = sorted.filter((r) => !q || r.name.toLowerCase().includes(q));

  return (
    <div className="qz-lg-viz" data-testid="logic-recs-strip">
      <div className="qz-lg-viz-h">
        <h3>{YOUR_RECOMMENDATIONS}</h3>
        {recommendations.length > 0 ? (
          <span className="qz-lg-viz-sub">
            <b>
              {done}/{recommendations.length}
            </b>{" "}
            {STRIP_COPY.haveARule}
          </span>
        ) : null}
      </div>
      <div className="qz-lg-recrow" ref={rowRef}>
        {sorted.map((r) => {
          const hidden = fit.hidden.has(r.id);
          if (covered(r.id) || !onCreateFor) {
            return (
              <span
                key={r.id}
                className={`qz-lg-rpill${covered(r.id) ? "" : " is-none"}`}
                data-fit-id={r.id}
                data-rec-id={r.id}
                hidden={hidden}
                tabIndex={0}
                title={r.name}
                aria-label={STRIP_COPY.usedBy(r.name, listing.get(r.id) ?? [])}
                {...lightProps(r.id)}
              >
                <span className={`qz-lg-sd${covered(r.id) ? " is-on" : ""}`} aria-hidden />
                <span className="qz-lg-rpill-n">{r.name}</span>
              </span>
            );
          }
          return (
            <button
              key={r.id}
              type="button"
              className="qz-lg-rpill is-none"
              data-fit-id={r.id}
              data-rec-id={r.id}
              hidden={hidden}
              title={r.name}
              aria-label={STRIP_COPY.createFor(r.name)}
              onClick={() => onCreateFor(r.id)}
              {...lightProps(r.id)}
            >
              <span className="qz-lg-sd" aria-hidden />
              <span className="qz-lg-rpill-n">{r.name}</span>
              <span className="qz-lg-rpill-add">{STRIP_COPY.createARule}</span>
            </button>
          );
        })}
        <QzPopover
          open={moreOpen}
          onOpenChange={setMoreOpen}
          width={300}
          maxWidth={300}
          manageFocus
          ariaLabel={STRIP_COPY.all(recommendations.length)}
          className="qz-lg-pop"
          trigger={
            <button
              type="button"
              className="qz-lg-rpill is-add"
              data-fit-more
              hidden={!fit.showMore}
              aria-label={STRIP_COPY.moreLabel(fit.moreCount)}
            >
              {fit.moreLabel}
            </button>
          }
          content={
            <>
              <div className="qz-lg-pt">{STRIP_COPY.all(recommendations.length)}</div>
              <div className="qz-lg-vptools">
                <input
                  type="search"
                  className="qz-lg-vpsearch"
                  placeholder={STRIP_COPY.search}
                  aria-label={STRIP_COPY.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="qz-lg-vplist" data-qz-pop-list>
                {moreList.length === 0 ? (
                  <div className="qz-lg-vpnone">{STRIP_COPY.nothingMatches}</div>
                ) : (
                  moreList.map((r) =>
                    covered(r.id) || !onCreateFor ? (
                      <div key={r.id} className="qz-lg-mi is-static">
                        <span className={`qz-lg-sd${covered(r.id) ? " is-on" : ""}`} aria-hidden />
                        <span className="qz-lg-mi-n">{r.name}</span>
                        {covered(r.id) ? <span className="qz-lg-mi-h">{STRIP_COPY.hasARule}</span> : null}
                      </div>
                    ) : (
                      <button
                        key={r.id}
                        type="button"
                        className="qz-lg-mi"
                        aria-label={STRIP_COPY.createFor(r.name)}
                        onClick={() => {
                          setMoreOpen(false);
                          onCreateFor(r.id);
                        }}
                      >
                        <span className="qz-lg-sd" aria-hidden />
                        <span className="qz-lg-mi-n">{r.name}</span>
                        <span className="qz-lg-mi-h">{STRIP_COPY.createARule}</span>
                      </button>
                    ),
                  )
                )}
              </div>
            </>
          }
        />
        {onAddRecommendations ? (
          <button type="button" className="qz-lg-rpill is-add" onClick={onAddRecommendations}>
            {STRIP_COPY.addRecommendations}
          </button>
        ) : null}
      </div>
    </div>
  );
}
