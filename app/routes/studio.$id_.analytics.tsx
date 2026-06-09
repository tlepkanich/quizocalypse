import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { perQuestionDropoff, conversionSummary } from "../lib/funnelAggregation";
import { QzPage, QzPageHeader, QzCard, QzStat, QzStatGrid, QzBanner } from "../components/qz";

// Standalone funnel dashboard for the /studio surface (Fly-reachable; the
// embedded admin has its own at /app/quizzes/$id/analytics). Reuses the same
// pure aggregation libs. `$id_` de-nests it from the editor route.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, name: true, status: true, publishedJson: true, draftJson: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  const [eventRows, sessionRows, captureCount] = await Promise.all([
    prisma.event.findMany({
      where: { quizId: quiz.id },
      select: { sessionId: true, eventType: true, payload: true },
    }),
    prisma.quizSession.findMany({
      where: { quizId: quiz.id },
      select: { completedAt: true, converted: true },
    }),
    prisma.emailCapture.count({ where: { quizId: quiz.id } }),
  ]);

  const byStage = new Map<string, Set<string>>();
  for (const r of eventRows) {
    let s = byStage.get(r.eventType);
    if (!s) {
      s = new Set();
      byStage.set(r.eventType, s);
    }
    s.add(r.sessionId);
  }
  const count = (k: string) => byStage.get(k)?.size ?? 0;
  const funnel = {
    started: count("quiz_started"),
    answered: count("question_answered"),
    completed: count("quiz_completed"),
    viewed: count("recommendation_viewed"),
    addToCart: count("add_to_cart"),
    clicked: count("recommendation_clicked"),
  };

  const parsed = Quiz.safeParse(quiz.publishedJson ?? quiz.draftJson);
  const questions = parsed.success
    ? parsed.data.nodes.flatMap((n) => (n.type === "question" ? [{ id: n.id, text: n.data.text }] : []))
    : [];

  return json({
    quiz: { id: quiz.id, name: quiz.name, status: quiz.status },
    funnel,
    dropoff: perQuestionDropoff(eventRows, questions, funnel.started),
    conversion: conversionSummary(sessionRows),
    captureCount,
  });
};

export default function StudioAnalytics() {
  const data = useLoaderData<typeof loader>();
  const { funnel, conversion } = data;
  const completionRate = funnel.started > 0 ? funnel.completed / funnel.started : 0;
  const ctr = funnel.viewed > 0 ? funnel.clicked / funnel.viewed : 0;

  return (
    <QzPage>
      <QzPageHeader
        eyebrow={
          <Link to={`/studio/${data.quiz.id}`} className="qz-link">
            ← {data.quiz.name}
          </Link>
        }
        title="Analytics"
        subtitle="Distinct shopper sessions reaching each stage of the funnel."
      />

      {funnel.started === 0 ? (
        <QzBanner tone="default" title="No events yet">
          Take the quiz on its storefront link — the funnel populates as shoppers move through it.
        </QzBanner>
      ) : null}

      <QzStatGrid>
        <QzStat
          label="Completion rate"
          value={`${(completionRate * 100).toFixed(1)}%`}
          delta={`${funnel.completed} of ${funnel.started} started`}
        />
        <QzStat
          label="Click-through"
          value={`${(ctr * 100).toFixed(1)}%`}
          delta={`${funnel.clicked} of ${funnel.viewed} viewed`}
        />
        <QzStat label="Email captures" value={data.captureCount} delta="" />
        <QzStat
          label="Conversion rate"
          value={`${(conversion.rate * 100).toFixed(1)}%`}
          delta={`${conversion.converted} of ${conversion.completed} completed → bought`}
        />
      </QzStatGrid>

      <div className="qz-col qz-gap-16" style={{ marginTop: 32 }}>
        <h2 className="qz-h1">Stage-by-stage</h2>
        <QzCard flush>
          <Row label="Started" value={funnel.started} />
          <Row label="Answered ≥1 question" value={funnel.answered} />
          <Row label="Completed" value={funnel.completed} />
          <Row label="Saw recommendations" value={funnel.viewed} />
          <Row label="Added to cart" value={funnel.addToCart} />
          <Row label="Clicked a product" value={funnel.clicked} last />
        </QzCard>

        {data.dropoff.length > 0 ? (
          <>
            <h2 className="qz-h1" style={{ marginTop: 16 }}>Drop-off by question</h2>
            <QzCard flush>
              {data.dropoff.map((q, i) => (
                <Row
                  key={q.questionId}
                  label={`${i + 1}. ${q.text.length > 44 ? `${q.text.slice(0, 43)}…` : q.text} · ${Math.round(q.pctOfStarted * 100)}%`}
                  value={q.answered}
                  last={i === data.dropoff.length - 1}
                />
              ))}
            </QzCard>
          </>
        ) : null}
      </div>
    </QzPage>
  );
}

function Row({ label, value, last }: { label: string; value: number; last?: boolean }) {
  return (
    <div
      className="qz-row qz-row-between"
      style={{ padding: "14px 20px", borderBottom: last ? 0 : "1px solid var(--qz-rule, #eee)" }}
    >
      <span>{label}</span>
      <span className="qz-mono qz-tnum" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
