// ANALYTICS P0 — the all-quiz Analytics home (spec Screen 1). One comparison
// table replaces the old card stack: the only question this page answers is
// WHICH quiz is working, and three charts per quiz buried that.
//
// Live and draft quizzes share ONE table, filtered by status and by name. A
// draft's metrics render as an em-dash, never 0 — it has no data, which is not
// the same as having none. Its Status cell carries the worst structural
// finding ("1 result only"), so a broken quiz is visible without opening it.
//
// Shared by /studio and /app so the two homes can never disagree.

import { useMemo, useState } from "react";
import { Link } from "@remix-run/react";
import { QzCard, QzEmpty } from "../qz";
import type { ShopAnalyticsData, ShopQuizRow } from "../../lib/quizAnalytics.server";
import { formatPct, formatPctRange } from "../../lib/analyticsConfidence";
import { CountTile, GatedTile, InsightCardView } from "./QuizAnalyticsView";
import {
  AnalyticsControlBar,
  DashCell,
  MethodDrawer,
  MethodInfo,
  QuizStatePill,
  SortTh,
} from "./AnalyticsControls";

type SortKey = "name" | "status" | "starts" | "rate" | "contacts" | "orders" | "revenue" | "rpf";
type StatusFilter = "all" | "live" | "draft";

/** Sort value per column; null always sinks to the bottom (drafts have no rank). */
function sortValue(row: ShopQuizRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "status":
      return row.live ? 1 : 0;
    case "starts":
      return row.starts;
    case "rate":
      return row.completion && row.completion.state !== "suppressed" ? row.completion.rate : null;
    case "contacts":
      return row.contacts;
    case "orders":
      return row.orders;
    case "revenue":
      return row.revenueNumeric;
    case "rpf":
      return row.perFinisherNumeric;
  }
}

function completionCell(row: ShopQuizRow) {
  if (!row.completion) return null;
  const c = row.completion;
  if (c.state === "suppressed") {
    return (
      <span
        className="qz-anneeds"
        title={`A completion rate at ${c.n} session${c.n === 1 ? "" : "s"} would swing on luck. We show it at ${c.showsAt}.`}
      >
        needs {c.showsAt}
      </span>
    );
  }
  return c.state === "provisional" ? formatPctRange(c.interval) : formatPct(c.rate);
}

export function AnalyticsHomeView({
  data,
  quizHref,
  analyticsHref,
  createHref,
  exportBase,
}: {
  data: ShopAnalyticsData;
  /** Builder link for a quiz id. */
  quizHref: (id: string) => string;
  /** Per-quiz analytics link for a quiz id. */
  analyticsHref: (id: string) => string;
  createHref: string;
  /** Contacts-CSV resource route (null hides Export on this surface). */
  exportBase: string | null;
}) {
  const { tiles, rows, counts, findings } = data;
  const [methodOpen, setMethodOpen] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "revenue", dir: -1 });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (status === "live" && !r.live) return false;
      if (status === "draft" && r.live) return false;
      return !q || r.name.toLowerCase().includes(q);
    });
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const x = sortValue(a, key);
      const y = sortValue(b, key);
      // A draft has no number to rank — keep them together at the bottom
      // whichever way the column is sorted.
      if (x == null && y == null) return a.name.localeCompare(b.name);
      if (x == null) return 1;
      if (y == null) return -1;
      if (x < y) return -dir;
      if (x > y) return dir;
      return a.name.localeCompare(b.name);
    });
  }, [rows, status, search, sort]);

  const onSort = (k: string) => {
    const key = k as SortKey;
    setSort((prev) =>
      prev.key === key ? { key, dir: (prev.dir * -1) as 1 | -1 } : { key, dir: key === "name" ? 1 : -1 },
    );
  };

  if (rows.length === 0) {
    return (
      <QzEmpty
        title={
          <>
            Analytics start with your first quiz.
            <br />
            <span className="qz-dim" style={{ fontSize: 13, fontWeight: 400 }}>
              Once a quiz is live, this page compares every one you run — starts, completion, contacts and
              the revenue each one influenced.
            </span>
          </>
        }
        action={
          <Link to={createHref} className="qz-btn qz-btn-primary">
            Create a quiz
          </Link>
        }
      />
    );
  }

  return (
    <div className="qz-anwrap">
      <AnalyticsControlBar
        rangeLabel={data.range.label}
        from={data.range.from}
        to={data.range.to}
        widened={false}
        exports={exportBase ? [{ label: "Contacts .csv (all quizzes)", href: `${exportBase}?segment=all` }] : []}
        onMethod={() => setMethodOpen(true)}
      />

      <div className="qz-antiles">
        <CountTile
          label="Quiz sessions"
          value={tiles.sessions.toLocaleString()}
          hero
          detail={
            tiles.sessionsDeltaPct != null ? (
              <span className={tiles.sessionsDeltaPct >= 0 ? "qz-anup" : "qz-andown"}>
                {tiles.sessionsDeltaPct >= 0 ? "▲" : "▼"} {Math.abs(tiles.sessionsDeltaPct)}% vs previous period
              </span>
            ) : (
              data.range.label.toLowerCase()
            )
          }
        />
        <GatedTile
          label="Completion rate"
          gated={tiles.completion}
          unit="sessions"
          detail={`${tiles.finished.toLocaleString()} finished · across ${counts.live} live quiz${counts.live === 1 ? "" : "zes"}`}
        />
        <CountTile
          label="Contacts captured"
          value={tiles.contacts.toLocaleString()}
          detail={
            tiles.finished > 0 && tiles.captureOfFinishers.state !== "suppressed"
              ? `${tiles.captureOfFinishers.state === "provisional" ? formatPctRange(tiles.captureOfFinishers.interval) : formatPct(tiles.captureOfFinishers.rate)} of finishers`
              : undefined
          }
        />
        <CountTile
          label={
            <>
              Revenue influenced <MethodInfo onClick={() => setMethodOpen(true)} />
            </>
          }
          value={tiles.revenue}
          detail={
            tiles.orders > 0
              ? `${tiles.orders} orders${tiles.perFinisher ? ` · ${tiles.perFinisher} per finisher` : ""}`
              : "no attributed orders yet"
          }
        />
      </div>

      <div className="qz-anhead">
        <h2 className="qz-h1">Quizzes</h2>
        <div className="qz-anseg" role="group" aria-label="Filter by status">
          {(
            [
              ["all", "All", counts.all],
              ["live", "Live", counts.live],
              ["draft", "Draft", counts.draft],
            ] as const
          ).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              className={status === key ? "is-on" : ""}
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
            >
              {label} <span className="qz-anseg-n">{n}</span>
            </button>
          ))}
        </div>
        <label className="qz-ansearch">
          <span aria-hidden>⌕</span>
          <input
            type="search"
            value={search}
            placeholder="Search quizzes"
            aria-label="Search quizzes"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <QzCard flush style={{ marginBottom: 28 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="qz-table qz-antable">
            <thead>
              <tr>
                <SortTh label="Quiz" sortKey="name" active={sort.key === "name"} dir={sort.dir} onSort={onSort} />
                <SortTh label="Status" sortKey="status" active={sort.key === "status"} dir={sort.dir} onSort={onSort} />
                <SortTh label="Starts" sortKey="starts" active={sort.key === "starts"} dir={sort.dir} onSort={onSort} numeric />
                <SortTh label="Completion" sortKey="rate" active={sort.key === "rate"} dir={sort.dir} onSort={onSort} numeric />
                <SortTh label="Contacts" sortKey="contacts" active={sort.key === "contacts"} dir={sort.dir} onSort={onSort} numeric />
                <SortTh label="Orders" sortKey="orders" active={sort.key === "orders"} dir={sort.dir} onSort={onSort} numeric />
                <SortTh label="Revenue" sortKey="revenue" active={sort.key === "revenue"} dir={sort.dir} onSort={onSort} numeric />
                <SortTh label="Per finisher" sortKey="rpf" active={sort.key === "rpf"} dir={sort.dir} onSort={onSort} numeric />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="qz-dim" style={{ textAlign: "center", padding: 26 }}>
                    No quizzes match.
                  </td>
                </tr>
              ) : (
                visible.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link to={q.live ? analyticsHref(q.id) : quizHref(q.id)} className="qz-anqlink">
                        {q.name}
                      </Link>
                    </td>
                    <td>
                      <QuizStatePill live={q.live} flag={q.flag} />
                    </td>
                    <DashCell>{q.starts?.toLocaleString() ?? null}</DashCell>
                    <DashCell>{completionCell(q)}</DashCell>
                    <DashCell>{q.contacts?.toLocaleString() ?? null}</DashCell>
                    <DashCell>{q.orders ?? null}</DashCell>
                    <DashCell>{q.revenue}</DashCell>
                    <DashCell>{q.perFinisher}</DashCell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </QzCard>

      <div className="qz-anhead">
        <h2 className="qz-h1">What to fix</h2>
        <span className="qz-dim" style={{ fontSize: 12.5 }}>
          {findings.length > 0
            ? `${findings.length} finding${findings.length === 1 ? "" : "s"} · checked after every publish`
            : "checked after every publish"}
        </span>
      </div>
      {findings.length === 0 ? (
        <div className="qz-anclean">
          <span className="qz-anclean-ic" aria-hidden>✓</span>
          <div>
            <div style={{ fontWeight: 600 }}>Nothing needs attention</div>
            <div className="qz-dim" style={{ fontSize: 13 }}>
              Your quiz logic and the {data.range.label.toLowerCase()} of activity both came back clean.
            </div>
          </div>
        </div>
      ) : (
        <div className="qz-col qz-gap-16">
          {findings.map((f, i) => (
            <InsightCardView
              key={`${f.quizId}-${i}`}
              severity={f.severity}
              headline={`${f.quizName}: ${f.headline}`}
              body={f.body}
              evidence={f.evidence}
              basis={f.basis}
              action={{ label: "Open the quiz", href: quizHref(f.quizId) }}
            />
          ))}
        </div>
      )}

      <MethodDrawer open={methodOpen} onClose={() => setMethodOpen(false)} />
    </div>
  );
}
