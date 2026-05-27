import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzStat,
  QzStatGrid,
  QzBadge,
} from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({
      totals: { started: 0, completed: 0, viewed: 0, clicked: 0, captures: 0 },
      perQuiz: [],
    });
  }

  const events = await prisma.event.findMany({
    where: { shopId: shop.id },
    select: { sessionId: true, eventType: true, quizId: true },
  });
  const captures = await prisma.emailCapture.count({
    where: { quiz: { shopId: shop.id } },
  });

  // Aggregate distinct-session counts across all quizzes.
  const byStage = new Map<string, Set<string>>();
  const perQuizMap = new Map<
    string,
    { started: Set<string>; completed: Set<string>; clicked: Set<string> }
  >();
  for (const row of events) {
    const set = byStage.get(row.eventType) ?? new Set();
    set.add(row.sessionId);
    byStage.set(row.eventType, set);
    const q = perQuizMap.get(row.quizId) ?? {
      started: new Set(),
      completed: new Set(),
      clicked: new Set(),
    };
    if (row.eventType === "quiz_started") q.started.add(row.sessionId);
    if (row.eventType === "quiz_completed") q.completed.add(row.sessionId);
    if (row.eventType === "recommendation_clicked") q.clicked.add(row.sessionId);
    perQuizMap.set(row.quizId, q);
  }

  const quizIds = [...perQuizMap.keys()];
  const quizzes =
    quizIds.length > 0
      ? await prisma.quiz.findMany({
          where: { id: { in: quizIds } },
          select: { id: true, name: true, status: true },
        })
      : [];
  const nameById = new Map(quizzes.map((q) => [q.id, q]));

  const perQuiz = [...perQuizMap.entries()]
    .map(([quizId, agg]) => ({
      quizId,
      name: nameById.get(quizId)?.name ?? "(deleted)",
      status: nameById.get(quizId)?.status ?? "draft",
      started: agg.started.size,
      completed: agg.completed.size,
      clicked: agg.clicked.size,
    }))
    .sort((a, b) => b.started - a.started);

  return json({
    totals: {
      started: byStage.get("quiz_started")?.size ?? 0,
      completed: byStage.get("quiz_completed")?.size ?? 0,
      viewed: byStage.get("recommendation_viewed")?.size ?? 0,
      clicked: byStage.get("recommendation_clicked")?.size ?? 0,
      captures,
    },
    perQuiz,
  });
};

export default function AggregateAnalytics() {
  const { totals, perQuiz } = useLoaderData<typeof loader>();
  const completionRate =
    totals.started > 0 ? (totals.completed / totals.started) * 100 : 0;
  const clickThroughRate =
    totals.viewed > 0 ? (totals.clicked / totals.viewed) * 100 : 0;

  return (
    <QzPage>
      <TitleBar title="Analytics" />

      <QzPageHeader
        eyebrow="All quizzes"
        title="Analytics"
        subtitle="Aggregate funnel across every quiz on this shop. Click into a row to see per-quiz detail."
      />

      <QzStatGrid>
        <QzStat
          label="Sessions started"
          value={totals.started}
          delta={`${totals.completed} completed`}
        />
        <QzStat
          label="Completion rate"
          value={`${completionRate.toFixed(1)}%`}
          delta={`${totals.completed} / ${totals.started}`}
        />
        <QzStat
          label="Click-through"
          value={`${clickThroughRate.toFixed(1)}%`}
          delta={`${totals.clicked} / ${totals.viewed} viewed`}
        />
      </QzStatGrid>

      <section className="qz-mt-48">
        <div className="qz-section-head">
          <div>
            <div className="qz-label">Breakdown</div>
            <h2 className="qz-h1 qz-mt-8">Per quiz</h2>
          </div>
        </div>
        {perQuiz.length === 0 ? (
          <QzCard dashed>
            <div className="qz-label">No data yet</div>
            <p className="qz-muted qz-mt-8">
              Once shoppers take any quiz, distinct-session counts appear here.
            </p>
          </QzCard>
        ) : (
          <QzCard flush>
            <table className="qz-table">
              <thead>
                <tr>
                  <th style={{ width: "55%" }}>Quiz</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Clicked</th>
                </tr>
              </thead>
              <tbody>
                {perQuiz.map((q) => (
                  <tr key={q.quizId}>
                    <td>
                      <Link
                        to={`/app/quizzes/${q.quizId}/analytics`}
                        prefetch="intent"
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <div className="qz-cell-name">{q.name}</div>
                        <div className="qz-cell-sub">
                          <QzBadge tone={q.status === "published" ? "ok" : "draft"}>
                            {q.status}
                          </QzBadge>
                        </div>
                      </Link>
                    </td>
                    <td className="qz-mono qz-tnum">{q.started}</td>
                    <td className="qz-mono qz-tnum">{q.completed}</td>
                    <td className="qz-mono qz-tnum">{q.clicked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QzCard>
        )}
      </section>
    </QzPage>
  );
}
