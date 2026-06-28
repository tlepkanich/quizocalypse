import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz, experienceTypeOf } from "../lib/quizSchema";
import {
  perQuestionDropoff,
  conversionSummary,
  totalRevenue,
  formatRevenue,
} from "../lib/funnelAggregation";
import { productPerformance } from "../lib/productPerformance";
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

  const [eventRows, sessionRows, captureCount, productMeta] = await Promise.all([
    prisma.event.findMany({
      where: { quizId: quiz.id, ...(hasRange ? { ts: tsRange } : {}) },
      select: { sessionId: true, eventType: true, payload: true },
    }),
    prisma.quizSession.findMany({
      where: { quizId: quiz.id, ...(hasRange ? { startedAt: tsRange } : {}) },
      select: { converted: true },
    }),
    prisma.emailCapture.count({
      where: { quizId: quiz.id, ...(hasRange ? { capturedAt: tsRange } : {}) },
    }),
    // PP2 — product metadata for the per-product leaderboard (title/image join).
    prisma.product.findMany({
      where: { shopId: shop.id },
      select: { productId: true, title: true, imageUrl: true, handle: true },
    }),
  ]);

  // PP2 — per-product impressions / clicks / ATC from the same event rows.
  const topProducts = productPerformance(eventRows, productMeta);

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

  // Experiences E1 — the headline KPI depends on what this quiz is FOR.
  const xtype = parsed.success ? experienceTypeOf(parsed.data) : "product_match";
  // Personality: which persona shoppers land on (outcome distribution).
  let outcomes: Array<{ label: string; count: number }> = [];
  if (xtype === "personality" && parsed.success) {
    const grouped = await prisma.quizSession.groupBy({
      by: ["outcomeId"],
      where: { quizId: quiz.id, completedAt: { not: null } },
      _count: { _all: true },
    });
    const headlineOf = (nid: string | null) => {
      const n = nid ? parsed.data.nodes.find((x) => x.id === nid) : undefined;
      return n && n.type === "result" ? n.data.headline || nid! : (nid ?? "unknown");
    };
    outcomes = grouped
      .map((g) => ({ label: headlineOf(g.outcomeId), count: g._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  return json({
    quiz: { id: quiz.id, name: quiz.name, status: quiz.status },
    funnel,
    dropoff: perQuestionDropoff(eventRows, questions, funnel.started),
    conversion: conversionSummary(sessionRows, funnel.completed),
    captureCount,
    revenue: { formatted: formatRevenue(revenue), orders: revenue.orders },
    range: { from: fromParam ?? "", to: toParam ?? "" },
    xtype,
    outcomes,
    topProducts,
  });
};

export default function StudioAnalytics() {
  const data = useLoaderData<typeof loader>();
  const { funnel, conversion } = data;
  const completionRate = funnel.started > 0 ? funnel.completed / funnel.started : 0;
  const ctr = funnel.viewed > 0 ? funnel.clicked / funnel.viewed : 0;
  const hasProducts = data.xtype === "product_match" || data.xtype === "personality";

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
        {data.xtype === "lead_capture" ? (
          <QzStat
            label="Capture rate"
            value={`${funnel.started > 0 ? ((data.captureCount / funnel.started) * 100).toFixed(1) : "0.0"}%`}
            delta={`${data.captureCount} captured of ${funnel.started} started`}
          />
        ) : (
          <QzStat
            label="Completion rate"
            value={`${(completionRate * 100).toFixed(1)}%`}
            delta={`${funnel.completed} of ${funnel.started} started`}
          />
        )}
        {hasProducts ? (
          <QzStat
            label="Click-through"
            value={`${(ctr * 100).toFixed(1)}%`}
            delta={`${funnel.clicked} of ${funnel.viewed} viewed`}
          />
        ) : null}
        <QzStat label="Email captures" value={data.captureCount} delta="" />
        {hasProducts ? (
          <QzStat
            label="Conversion rate"
            value={`${(conversion.rate * 100).toFixed(1)}%`}
            delta={`${conversion.converted} of ${conversion.completed} completed → bought`}
          />
        ) : null}
        {hasProducts ? (
          <QzStat
            label="Revenue"
            value={data.revenue.formatted}
            delta={data.revenue.orders > 0 ? `${data.revenue.orders} attributed order(s)` : "no attributed orders yet"}
          />
        ) : null}
        {data.xtype === "survey" ? (
          <QzStat label="Completions" value={funnel.completed} delta="responses collected" />
        ) : null}
      </QzStatGrid>

      {data.xtype === "personality" && data.outcomes.length > 0 ? (
        <div className="qz-col qz-gap-16" style={{ marginTop: 24 }}>
          <h2 className="qz-h1">Outcome distribution</h2>
          <QzCard flush>
            {data.outcomes.map((o, i) => {
              const total = data.outcomes.reduce((acc, x) => acc + x.count, 0);
              const pct = total > 0 ? Math.round((o.count / total) * 100) : 0;
              return (
                <div key={o.label} style={{ padding: "12px 20px", borderBottom: i < data.outcomes.length - 1 ? "1px solid var(--qz-rule, #eee)" : 0 }}>
                  <div className="qz-row qz-row-between" style={{ fontSize: 13, marginBottom: 6 }}>
                    <span>{o.label}</span>
                    <span className="qz-mono qz-tnum">{o.count} · {pct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--qz-cream-2, #f3efe6)" }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: "var(--qz-accent, #2a6df4)" }} />
                  </div>
                </div>
              );
            })}
          </QzCard>
        </div>
      ) : null}

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
          <Row label="Completed" value={funnel.completed} last={!hasProducts} />
          {hasProducts ? <Row label="Saw recommendations" value={funnel.viewed} /> : null}
          {hasProducts ? <Row label="Added to cart" value={funnel.addToCart} /> : null}
          {hasProducts ? <Row label="Clicked a product" value={funnel.clicked} last /> : null}
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

      {hasProducts && data.topProducts.length > 0 ? (
        <div className="qz-col qz-gap-16" style={{ marginTop: 32 }}>
          <h2 className="qz-h1">Top products</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            How each recommended product performs — distinct sessions shown, clicked, and added to
            cart. CTR = clicks ÷ shown; Add rate = adds ÷ clicks.
          </p>
          <QzCard flush>
            <ProductLeaderboard rows={data.topProducts} />
          </QzCard>
        </div>
      ) : null}
    </QzPage>
  );
}

function ProductLeaderboard({
  rows,
}: {
  rows: Array<{
    productId: string;
    title: string;
    imageUrl: string | null;
    impressions: number;
    clicks: number;
    addToCart: number;
    ctr: number;
    atcRate: number;
  }>;
}) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--qz-ink-2, #666)" }}>
            <th style={{ padding: "10px 20px", fontWeight: 600 }}>Product</th>
            <th style={thNum}>Shown</th>
            <th style={thNum}>Clicks</th>
            <th style={thNum}>CTR</th>
            <th style={thNum}>Added</th>
            <th style={thNum}>Add rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.productId} style={{ borderTop: i === 0 ? "1px solid var(--qz-rule, #eee)" : 0 }}>
              <td style={{ padding: "10px 20px", borderTop: "1px solid var(--qz-rule, #eee)" }}>
                <span className="qz-row qz-gap-8" style={{ alignItems: "center" }}>
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt={r.title}
                      width={36}
                      height={36}
                      loading="lazy"
                      style={{ borderRadius: 6, objectFit: "cover", border: "1px solid var(--qz-rule, #eee)", flexShrink: 0 }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      style={{ width: 36, height: 36, borderRadius: 6, background: "var(--qz-cream-2, #f3efe6)", flexShrink: 0 }}
                    />
                  )}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
                    {r.title}
                  </span>
                </span>
              </td>
              <td style={tdNum}>{r.impressions}</td>
              <td style={tdNum}>{r.clicks}</td>
              <td style={tdNum}>{pct(r.ctr)}</td>
              <td style={tdNum}>{r.addToCart}</td>
              <td style={tdNum}>{pct(r.atcRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thNum: CSSProperties = { padding: "10px 20px", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" };
const tdNum: CSSProperties = {
  padding: "10px 20px",
  textAlign: "right",
  borderTop: "1px solid var(--qz-rule, #eee)",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
};

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
