// ANALYTICS P0 — the control bar and method disclosure, shared by the
// Analytics home and the per-quiz view (spec Band 0). Both pages carry the
// SAME range picker and Export menu; building it twice is how the two admin
// surfaces drifted in the first place.

import { useState, type ReactNode } from "react";
import { useSearchParams } from "@remix-run/react";
import { QzDrawer, QzMenu } from "../qz-overlays";
import { formatDate } from "../../lib/formatDate";
import type { RangePreset } from "../../lib/quizAnalytics.server";

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "Since published" },
];

/** Replace the range while keeping every other param (section, embedded host). */
export function rangeSearch(searchParams: URLSearchParams, r: RangePreset): string {
  const next = new URLSearchParams(searchParams);
  next.set("r", r);
  next.delete("from");
  next.delete("to");
  return `?${next.toString()}`;
}

export interface ExportItem {
  label: string;
  href: string;
}

/** The calendar glyph on the range control (spec bar-1). */
function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5.5 2v2M10.5 2v2" />
    </svg>
  );
}

/**
 * Bar 1 (spec): ONE 56px row — page identity on the left, the range control
 * carrying accent weight beside it, and Export pushed right. Two bars maximum,
 * a hairline under each, no boxed container and no shadow.
 */
export function AnalyticsControlBar({
  title,
  rangeLabel,
  from,
  to,
  widened,
  exports,
  extra,
}: {
  /** Page identity — "Analytics", or "← Quiz name" on a single quiz. */
  title: ReactNode;
  rangeLabel: string;
  from: string | null;
  to: string;
  widened: boolean;
  exports: ExportItem[];
  /** Optional right-side slot (e.g. the Live/Draft badge). */
  extra?: ReactNode;
}) {
  const [searchParams] = useSearchParams();
  const [customOpen, setCustomOpen] = useState(searchParams.get("r") === "custom");

  return (
    <>
      <div className="qz-anbar-row">
        <div className="qz-anbar-title">{title}</div>
        {/* The range is the page's controlling input, so it carries accent
            weight; Export stays a plain action. */}
        <QzMenu
          trigger={
            <button type="button" className="qz-anbtn is-primary">
              <CalendarIcon />
              {rangeLabel}
              <span className="qz-anbtn-car" aria-hidden>▾</span>
            </button>
          }
          items={[
            ...RANGE_PRESETS.map((p) => ({
              label: p.label,
              onSelect: () => {
                window.location.search = rangeSearch(searchParams, p.value);
              },
            })),
            { label: "Custom range…", onSelect: () => setCustomOpen((v) => !v) },
          ]}
        />
        <span className="qz-anresolved">
          {from ? `${formatDate(from)} – ${formatDate(to)}` : "All activity"}
        </span>
        {widened ? (
          <span className="qz-anwiden">widened — too little data in the last 90 days</span>
        ) : null}
        <span className="qz-anbar-push">
          {extra}
          {/* No "How we count this" button up here — the spec reaches the
              method drawer from the "i" beside the contested figures and from
              the disclosure line under the revenue chart. */}
          {exports.length > 0 ? (
            <QzMenu
              trigger={
                <button type="button" className="qz-anbtn">
                  Export<span className="qz-anbtn-car" aria-hidden>▾</span>
                </button>
              }
              items={exports.map((e) => ({
                label: e.label,
                onSelect: () => {
                  window.location.href = e.href;
                },
              }))}
            />
          ) : null}
        </span>
      </div>
      {customOpen ? (
        <form method="get" className="qz-ancustom">
          <input type="hidden" name="r" value="custom" />
          {[...searchParams.entries()]
            .filter(([k]) => k !== "r" && k !== "from" && k !== "to")
            .map(([k, v], i) => (
              <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
            ))}
          <span className="qz-dim">From</span>
          <input type="date" name="from" defaultValue={from ? from.slice(0, 10) : ""} className="qz-andate" />
          <span className="qz-dim">to</span>
          <input type="date" name="to" defaultValue={to.slice(0, 10)} className="qz-andate" />
          <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm">Apply this range</button>
        </form>
      ) : null}
    </>
  );
}

/** The small "i" affordance beside a figure whose counting is contested. */
export function MethodInfo({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="qz-aninfo" onClick={onClick} aria-label="How we count this">
      i
    </button>
  );
}

export function MethodDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <QzDrawer open={open} onClose={onClose} title="How we count this">
      <div className="qz-col qz-gap-16" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        <p style={{ margin: 0 }}>
          Every number here comes from shoppers who actually used your quiz. Nothing is modelled or adjusted.
        </p>
        <div>
          <h3 className="qz-h2" style={{ marginBottom: 6 }}>Why this won&rsquo;t match Shopify</h3>
          <p style={{ margin: 0 }}>
            Shopify credits the last marketing click a shopper made, looking back 30 days. We credit a completed
            quiz, looking back 7. Both are right — they answer different questions. Klaviyo, Meta and Google each
            use their own model too, so adding them together counts the same order several times.
          </p>
        </div>
        <div>
          <h3 className="qz-h2" style={{ marginBottom: 6 }}>What &ldquo;reached&rdquo; means</h3>
          <p style={{ margin: 0 }}>
            We know a shopper reached a question because they answered it. So someone who saw a question and left
            without answering isn&rsquo;t counted as having reached it — which makes drop-off a worst-case figure,
            not an exact one. We say so rather than round it away.
          </p>
        </div>
        <div>
          <h3 className="qz-h2" style={{ marginBottom: 6 }}>What we can&rsquo;t see</h3>
          <p style={{ margin: 0 }}>
            Purchases on another device or in a private window. Orders placed after the window closes. Orders
            awaiting payment aren&rsquo;t counted.
          </p>
        </div>
      </div>
    </QzDrawer>
  );
}

/**
 * Low-confidence marker (owner decision 2026-08-15, supersedes the research
 * doc's hard gates). The rate is ALWAYS shown; an asterisk marks that it rests
 * on a thin sample and the hover says how thin. Disclose, don't withhold.
 */
export function LowConfidence({ n, showsAt, confidentAt, unit, lo, hi }: {
  n: number;
  showsAt: number;
  confidentAt: number;
  unit: string;
  /** Wilson bounds, so the hover can state the real swing. */
  lo: number;
  hi: number;
}) {
  const band = `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
  const title =
    n < showsAt
      ? `Based on just ${n} ${unit}. At this volume the true figure could sit anywhere between ${band}, so read it as a hint rather than a measurement — it settles around ${confidentAt}.`
      : `Based on ${n} ${unit}. The true figure is likely between ${band}; it firms up at ${confidentAt}.`;
  return (
    <abbr className="qz-anlow" title={title} aria-label={title}>
      *
    </abbr>
  );
}

/** True when a rate rests on a thin sample and should carry the asterisk. */
export function isLowConfidence(state: "confident" | "provisional" | "suppressed"): boolean {
  return state !== "confident";
}

/** Colour-coded status pill for a quiz row (spec Screen 1 `.state`). */
export function QuizStatePill({ live, flag }: { live: boolean; flag: string | null }) {
  if (live) return <span className="qz-anstate is-ok">Live</span>;
  // A draft carrying a structural finding says WHAT is wrong, in amber — the
  // point of the column is to spot a broken quiz without opening it.
  if (flag) return <span className="qz-anstate is-warn">{flag}</span>;
  return <span className="qz-anstate is-dim">Draft</span>;
}

/** Sortable table header cell. */
export function SortTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: string;
  active: boolean;
  dir: 1 | -1;
  onSort: (key: string) => void;
  numeric?: boolean;
}) {
  return (
    <th
      className={`qz-ansrt${active ? (dir === 1 ? " is-asc" : " is-desc") : ""}${numeric ? " is-num" : ""}`}
      aria-sort={active ? (dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
      </button>
    </th>
  );
}

/** An em-dash cell: no data is not the same as zero. */
export function DashCell({ children }: { children: ReactNode }) {
  return children == null ? <td className="qz-andash">—</td> : <td className="qz-mono qz-tnum">{children}</td>;
}
