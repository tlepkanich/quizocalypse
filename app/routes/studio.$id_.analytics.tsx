import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import {
  perQuestionDropoff,
  conversionSummary,
  totalRevenue,
  formatRevenue,
} from "../lib/funnelAggregation";
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

  // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD window (BIC P2). Invalid dates are
  // ignored; `to` is inclusive (end of that day).
  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : null;
  const tsRange = {
    ...(from && !Number.isNaN(+from) ? { gte: from } : {}),
    ...(to && !Number.isNaN(+to) ? { lte: to } : {}),
  };
  const hasRange = Object.keys(tsRange).length > 0;

  const [eventRows, sessionRows, captureCount] = await Promise.all([
    prisma.event.findMany({
      where: { quizId: quiz.id, ...(hasRange ? { ts: tsRange } : {}) },
      select: { sessionId: true, eventType: true, payload: true },
    }),
    prisma.quizSession.findMany({
      where: { quizId: quiz.id, ...(hasRange ? { startedAt: tsRange } : {}) },
      select: { completedAt: true, converted: true },
    }),
    prisma.emailCapture.count({
      where: { quizId: quiz.id, ...(hasRange ? { capturedAt: tsRange } : {}) },
    }),
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
    engaged: count("quiz_engaged"),
    answered: count("question_answered"),
    completed: count("quiz_completed"),
    viewed: count("recommendation_viewed"),
    addToCart: count("add_to_cart"),
    clicked: count("recommendation_clicked"),
  };
  const revenue = totalRevenue(eventRows);

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
    revenue: { formatted: formatRevenue(revenue), orders: revenue.orders },
    range: { from: fromParam ?? "", to: toParam ?? "" },
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
        <QzStat
          label="Revenue"
          value={data.revenue.formatted}
          delta={data.revenue.orders > 0 ? `${data.revenue.orders} attributed order(s)` : "no attributed orders yet"}
        />
      </QzStatGrid>

      <form
        method="get"
        className="qz-row"
        style={{ gap: 8, alignItems: "center", marginTop: 16, fontSize: 12 }}
      >
        <span className="qz-dim">From</span>
        <input type="date" name="from" defaultValue={data.range.from} style={{ font: "inherit", padding: "4px 6px", borderRadius: 6, border: "1px solid #00000022" }} />
        <span className="qz-dim">to</span>
        <input type="date" name="to" defaultValue={data.range.to} style={{ font: "inherit", padding: "4px 6px", borderRadius: 6, border: "1px solid #00000022" }} />
        <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm">Apply</button>
        {data.range.from || data.range.to ? (
          <Link to="?" className="qz-btn qz-btn-ghost qz-btn-sm">Clear</Link>
        ) : null}
      </form>

      <div className="qz-col qz-gap-16" style={{ marginTop: 32 }}>
        <h2 className="qz-h1">Stage-by-stage</h2>
        <QzCard flush>
          <Row label="Viewed (loaded the quiz)" value={funnel.started} />
          <Row label="Started (clicked Start)" value={funnel.engaged} />
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
