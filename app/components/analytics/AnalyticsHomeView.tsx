// ANALYTICS P0 — the all-quiz Analytics home (spec Screen 1). One comparison
// table replaces the old card stack: the only question this page answers is
// WHICH quiz is working, and three charts per quiz buried that. Drafts move
// out of the way instead of rendering empty charts. Shared by /studio and
// /app so the two homes can never disagree (no-fork rule).

import { Link } from "@remix-run/react";
import { QzCard, QzBadge, QzEmpty } from "../qz";
import type { ShopAnalyticsData } from "../../lib/quizAnalytics.server";
import { formatPct, formatPctRange } from "../../lib/analyticsConfidence";
import { CountTile, GatedTile, InsightCardView } from "./QuizAnalyticsView";

export function AnalyticsHomeView({
  data,
  quizHref,
  analyticsHref,
  createHref,
}: {
  data: ShopAnalyticsData;
  /** Builder link for a quiz id. */
  quizHref: (id: string) => string;
  /** Per-quiz analytics link for a quiz id. */
  analyticsHref: (id: string) => string;
  createHref: string;
}) {
  const { tiles, live, drafts, findings } = data;

  if (live.length === 0 && drafts.length === 0) {
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
      <div className="qz-antiles">
        <CountTile
          label="Quiz sessions"
          value={tiles.sessions}
          hero
          detail={
            tiles.sessionsDeltaPct != null
              ? `${tiles.sessionsDeltaPct >= 0 ? "▲" : "▼"} ${Math.abs(tiles.sessionsDeltaPct)}% vs previous period`
              : data.range.label.toLowerCase()
          }
        />
        <GatedTile
          label="Completion rate"
          gated={tiles.completion}
          unit="sessions"
          detail={`${tiles.finished} finished · across ${live.length} live quiz${live.length === 1 ? "" : "zes"}`}
        />
        <CountTile
          label="Contacts captured"
          value={tiles.contacts}
          detail={
            tiles.finished > 0 && tiles.captureOfFinishers.state !== "suppressed"
              ? `${tiles.captureOfFinishers.state === "provisional" ? formatPctRange(tiles.captureOfFinishers.interval) : formatPct(tiles.captureOfFinishers.rate)} of finishers`
              : undefined
          }
        />
        <CountTile
          label="Revenue influenced"
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
        <span className="qz-dim" style={{ fontSize: 12.5 }}>
          All {live.length + drafts.length} · Live {live.length} · Draft {drafts.length}
        </span>
      </div>

      {live.length === 0 ? (
        <QzCard style={{ marginBottom: 20 }}>
          <p className="qz-muted" style={{ margin: 0 }}>
            No live quizzes yet. Publish one to start comparing — drafts are listed below.
          </p>
        </QzCard>
      ) : (
        <QzCard flush style={{ marginBottom: 20 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="qz-table">
              <thead>
                <tr>
                  <th>Quiz</th>
                  <th>Starts</th>
                  <th>Completion</th>
                  <th>Contacts</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                  <th>Per finisher</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {live.map((q) => (
                  <tr key={q.id}>
                    <td className="qz-cell-name">
                      <Link to={analyticsHref(q.id)} className="qz-link">
                        {q.name}
                      </Link>
                    </td>
                    <td className="qz-mono qz-tnum">{q.starts}</td>
                    <td className={q.completion.state === "suppressed" ? "qz-dim" : "qz-mono qz-tnum"}>
                      {q.completion.state === "suppressed" ? (
                        <span title={`A completion rate at ${q.completion.n} session${q.completion.n === 1 ? "" : "s"} would swing on luck. We show it at ${q.completion.showsAt}.`}>
                          needs {q.completion.showsAt} starts
                        </span>
                      ) : q.completion.state === "provisional" ? (
                        formatPctRange(q.completion.interval)
                      ) : (
                        formatPct(q.completion.rate)
                      )}
                    </td>
                    <td className="qz-mono qz-tnum">{q.contacts}</td>
                    <td className="qz-mono qz-tnum">{q.orders}</td>
                    <td className="qz-mono qz-tnum">{q.revenue}</td>
                    <td className="qz-mono qz-tnum">{q.perFinisher ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link to={quizHref(q.id)} className="qz-btn qz-btn-ghost qz-btn-sm">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QzCard>
      )}

      {drafts.length > 0 ? (
        <QzCard flush style={{ marginBottom: 28 }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--qz-rule)" }} className="qz-label">
            Drafts — numbers start at publish
          </div>
          {drafts.map((d, i) => (
            <div
              key={d.id}
              className="qz-row qz-row-between"
              style={{ padding: "12px 20px", borderBottom: i < drafts.length - 1 ? "1px solid var(--qz-rule)" : 0, gap: 12 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div className="qz-dim" style={{ fontSize: 12 }}>
                  {d.questions} question{d.questions === 1 ? "" : "s"} · {d.outcomes} outcome{d.outcomes === 1 ? "" : "s"}
                  {d.findings > 0 ? ` · ${d.findings} structural finding${d.findings === 1 ? "" : "s"}` : ""}
                </div>
              </div>
              <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
                {d.findings > 0 ? <QzBadge tone="warn">Check logic</QzBadge> : <QzBadge tone="draft">Draft</QzBadge>}
                <Link to={quizHref(d.id)} className="qz-btn qz-btn-ghost qz-btn-sm">
                  Open
                </Link>
              </div>
            </div>
          ))}
        </QzCard>
      ) : null}

      <div className="qz-anhead">
        <h2 className="qz-h1">What to fix</h2>
        <span className="qz-dim" style={{ fontSize: 12.5 }}>
          {findings.length > 0 ? `${findings.length} finding${findings.length === 1 ? "" : "s"} · checked after every publish` : "checked after every publish"}
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
    </div>
  );
}
