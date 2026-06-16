import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { computeBenchmarks } from "../lib/quizBenchmarks";
import { totalRevenue, formatRevenue } from "../lib/funnelAggregation";
import { QzPage, QzPageHeader, QzCard, QzStat, QzStatGrid } from "../components/qz";

// QD-8 — Analytics: the account-wide rollup across every quiz (the per-quiz
// funnel lives at /studio/$id/analytics). Reuses computeBenchmarks (completion
// rates) + totalRevenue (order_attributed), all from the shared aggregation libs.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    select: { id: true, name: true, status: true },
    orderBy: { updatedAt: "desc" },
  });
  const quizIds = quizzes.map((q) => q.id);

  const [funnelRows, revenueRows, contacts] = await Promise.all([
    prisma.event.findMany({
      where: { quizId: { in: quizIds }, eventType: { in: ["quiz_engaged", "quiz_completed"] } },
      select: { quizId: true, eventType: true, sessionId: true },
      distinct: ["quizId", "eventType", "sessionId"],
    }),
    prisma.event.findMany({
      where: { quizId: { in: quizIds }, eventType: "order_attributed" },
      select: { sessionId: true, eventType: true, payload: true },
    }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id } } }),
  ]);

  const benchmarks = computeBenchmarks(funnelRows);
  const revenue = totalRevenue(
    revenueRows.map((r) => ({ sessionId: r.sessionId, eventType: r.eventType, payload: r.payload })),
  );

  // Account totals: sum the distinct engaged/completed sessions across quizzes.
  let started = 0;
  let completed = 0;
  for (const id of quizIds) {
    const b = benchmarks.byQuiz[id];
    if (b) {
      started += b.started;
      completed += b.completed;
    }
  }

  return json({
    publishedCount: quizzes.filter((q) => q.status === "published").length,
    totalCount: quizzes.length,
    started,
    completed,
    averageRate: benchmarks.averageRate, // 0–100 integer, or null
    contacts,
    revenue: formatRevenue(revenue),
    rows: quizzes.map((q) => ({
      id: q.id,
      name: q.name,
      status: q.status,
      bench: benchmarks.byQuiz[q.id] ?? null,
    })),
  });
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--qz-rule-2)",
  fontSize: 14,
};

export default function StudioAnalytics() {
  const data = useLoaderData<typeof loader>();
  const rate = data.averageRate != null ? `${data.averageRate}%` : "—";
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Analytics"
        title="How your quizzes perform"
        subtitle="The whole account at a glance. Open any quiz for its step-by-step funnel and drop-off."
      />

      <QzStatGrid>
        <QzStat label="Published quizzes" value={`${data.publishedCount} / ${data.totalCount}`} />
        <QzStat label="Quizzes started" value={String(data.started)} />
        <QzStat label="Completed" value={String(data.completed)} />
        <QzStat label="Avg. completion" value={rate} />
        <QzStat label="Contacts captured" value={String(data.contacts)} />
        <QzStat label="Attributed revenue" value={data.revenue} />
      </QzStatGrid>

      {data.rows.length === 0 ? (
        <QzCard>
          <p className="qz-muted" style={{ margin: 0 }}>
            No quizzes yet. <Link to="/studio/new" className="qz-link">Create one</Link> to start
            collecting data.
          </p>
        </QzCard>
      ) : (
        <QzCard>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Quiz", "Status", "Completion", ""].map((h) => (
                    <th
                      key={h || "actions"}
                      style={{
                        textAlign: "left",
                        padding: "8px 12px",
                        borderBottom: "1px solid var(--qz-rule)",
                        fontSize: 12,
                        color: "var(--qz-ink-3)",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...cellStyle, fontWeight: 500 }}>{r.name}</td>
                    <td style={cellStyle}>
                      <span className="qz-dim" style={{ fontSize: 12 }}>{r.status}</span>
                    </td>
                    <td style={cellStyle}>
                      {r.bench && r.bench.rate != null ? (
                        `${r.bench.rate}% (${r.bench.completed}/${r.bench.started})`
                      ) : (
                        <span className="qz-dim">no data yet</span>
                      )}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: "nowrap", textAlign: "right" }}>
                      <Link to={`/studio/${r.id}/analytics`} className="qz-link">
                        View funnel →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QzCard>
      )}
    </QzPage>
  );
}
