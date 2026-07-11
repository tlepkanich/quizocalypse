import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useLocation } from "@remix-run/react";
import { useEffect, useState, type CSSProperties } from "react";
import { Crown, MessageSquare } from "lucide-react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { computeBenchmarks } from "../lib/quizBenchmarks";
import { quizCardFacts } from "../lib/quizLibraryCard";
import { totalRevenue, formatRevenue } from "../lib/funnelAggregation";
import { ANALYTICS_EVENT_WINDOW } from "../lib/analyticsWindow";
import { QzPage, QzPageHeader, QzEmpty } from "../components/qz";

// Gentle placeholder shape for KPIs with no daily series yet — rendered greyed
// so it reads as "no data yet", not fabricated numbers.
const SPARK_PLACEHOLDER = [3, 5, 4, 6, 5, 7, 6];

function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="qz-spark" aria-hidden>
      {data.map((v, j) => (
        <span key={j} style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%`, animationDelay: `${j * 45}ms` }} />
      ))}
    </div>
  );
}

// P3 Edit 1 (Version B) — per-quiz analytics MODULES: one card per quiz, accent
// rotates, tinted header + hero revenue KPI + week-over-week Δ + a mini-trend
// (bars grow in), a clean neutral body (Started/Completion/Contacts), and a
// "View full analytics →" footer. Reuses computeBenchmarks + totalRevenue.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    // draftJson → per-module facts (questions · personas), like the library card.
    select: { id: true, name: true, status: true, draftJson: true },
    orderBy: { updatedAt: "desc" },
  });
  const quizIds = quizzes.map((q) => q.id);
  const dayMs = 86_400_000;
  const since14 = new Date(Date.now() - 13 * dayMs);
  since14.setHours(0, 0, 0, 0);
  const start14 = since14.getTime();

  const [funnelRows, revenueRows, captureRows, trendRows, feedbackRows, outcomeRows, cats] = await Promise.all([
    prisma.event.findMany({
      where: { quizId: { in: quizIds }, eventType: { in: ["quiz_engaged", "quiz_completed"] } },
      select: { quizId: true, eventType: true, sessionId: true },
      distinct: ["quizId", "eventType", "sessionId"],
    }),
    prisma.event.findMany({
      where: { quizId: { in: quizIds }, eventType: "order_attributed" },
      select: { quizId: true, sessionId: true, eventType: true, payload: true },
      orderBy: { ts: "desc" },
      take: ANALYTICS_EVENT_WINDOW,
    }),
    prisma.emailCapture.groupBy({
      by: ["quizId"],
      where: { quiz: { shopId: shop.id } },
      _count: true,
    }),
    prisma.event.findMany({
      where: { quizId: { in: quizIds }, eventType: "quiz_engaged", ts: { gte: since14 } },
      select: { quizId: true, ts: true },
    }),
    // §L2 — post-result feedback (thumbs 0/1 or stars 1–5), aggregated per quiz.
    prisma.quizFeedback.groupBy({
      by: ["quizId"],
      where: { quiz: { shopId: shop.id } },
      _count: { _all: true },
      _avg: { rating: true },
      _max: { rating: true },
    }),
    // Top persona per quiz — the most common completed outcome.
    prisma.quizSession.groupBy({
      by: ["quizId", "outcomeId"],
      where: { quizId: { in: quizIds }, completedAt: { not: null }, outcomeId: { not: null } },
      _count: { _all: true },
    }),
    prisma.category.findMany({ where: { shopId: shop.id }, select: { id: true, name: true } }),
  ]);

  // Resolve each quiz's dominant persona (name + share of completions).
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const outcomeByQuiz = new Map<string, { name: string; share: number }>();
  const totalsByQuiz = new Map<string, number>();
  for (const r of outcomeRows) totalsByQuiz.set(r.quizId, (totalsByQuiz.get(r.quizId) ?? 0) + r._count._all);
  const bestByQuiz = new Map<string, { outcomeId: string; n: number }>();
  for (const r of outcomeRows) {
    if (!r.outcomeId) continue;
    const cur = bestByQuiz.get(r.quizId);
    if (!cur || r._count._all > cur.n) bestByQuiz.set(r.quizId, { outcomeId: r.outcomeId, n: r._count._all });
  }
  for (const [qid, best] of bestByQuiz) {
    const total = totalsByQuiz.get(qid) ?? 0;
    const name = catName.get(best.outcomeId);
    if (name && total > 0) outcomeByQuiz.set(qid, { name, share: Math.round((best.n / total) * 100) });
  }

  const benchmarks = computeBenchmarks(funnelRows);

  const revByQuiz = new Map<string, typeof revenueRows>();
  for (const r of revenueRows) {
    const arr = revByQuiz.get(r.quizId) ?? [];
    arr.push(r);
    revByQuiz.set(r.quizId, arr);
  }
  const contactsByQuiz = new Map(captureRows.map((r) => [r.quizId, r._count]));
  // §L2 — helpfulness per quiz. max ≤ 1 ⇒ thumbs (avg = fraction 👍); else stars.
  const feedbackByQuiz = new Map(
    feedbackRows.map((r) => [
      r.quizId,
      { count: r._count._all, avg: r._avg.rating ?? 0, max: r._max.rating ?? 0 },
    ]),
  );

  // 14-day daily "starts" per quiz → last-7 trend + week-over-week delta.
  const daysByQuiz = new Map<string, number[]>();
  for (const id of quizIds) daysByQuiz.set(id, new Array(14).fill(0));
  for (const e of trendRows) {
    const idx = Math.floor((new Date(e.ts).getTime() - start14) / dayMs);
    const arr = daysByQuiz.get(e.quizId);
    if (arr && idx >= 0 && idx < 14) arr[idx] = (arr[idx] ?? 0) + 1;
  }

  return json({
    quizzes: quizzes.map((q) => {
      const b = benchmarks.byQuiz[q.id];
      const days = daysByQuiz.get(q.id) ?? new Array(14).fill(0);
      const prior = days.slice(0, 7).reduce((a, c) => a + c, 0);
      const recent = days.slice(7).reduce((a, c) => a + c, 0);
      const rev = revByQuiz.get(q.id);
      const fb = feedbackByQuiz.get(q.id);
      const facts = quizCardFacts(q.draftJson);
      return {
        id: q.id,
        name: q.name,
        status: q.status,
        questions: facts.questions,
        personas: facts.personas,
        topPersona: outcomeByQuiz.get(q.id) ?? null,
        started: b?.started ?? 0,
        rate: b?.rate ?? null,
        contacts: contactsByQuiz.get(q.id) ?? 0,
        feedback: fb && fb.count > 0
          ? {
              count: fb.count,
              // thumbs → "% helpful"; stars → "avg ★"
              label: fb.max <= 1 ? `${Math.round(fb.avg * 100)}% 👍` : `${fb.avg.toFixed(1)}★`,
            }
          : null,
        revenue: rev
          ? formatRevenue(
              totalRevenue(rev.map((r) => ({ sessionId: r.sessionId, eventType: r.eventType, payload: r.payload }))),
            )
          : null,
        trend: days.slice(7), // last 7 days
        delta: prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null,
      };
    }),
  });
};

// Rotating per-quiz identity accent (§15.7): violet · pink · mint · amber.
const ACCENTS = [
  { wash: "var(--qz-pastel-violet)", ink: "var(--qz-pastel-violet-ink)" },
  { wash: "var(--qz-pastel-rose)", ink: "var(--qz-pastel-rose-ink)" },
  { wash: "var(--qz-pastel-mint)", ink: "var(--qz-pastel-mint-ink)" },
  { wash: "var(--qz-pastel-amber)", ink: "var(--qz-pastel-amber-ink)" },
];

export default function StudioAnalytics() {
  const { quizzes } = useLoaderData<typeof loader>();
  const location = useLocation();
  // §R-7 deep-link — the Quizzes library's "Analytics" action lands on
  // /studio/analytics#quiz-<id>. Scroll that module into view and pulse it,
  // whether arrived via a full load or a client transition (React Router
  // doesn't reliably hash-scroll on client nav).
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    const m = location.hash.match(/^#quiz-(.+)$/);
    if (!m) return;
    const id = m[1]!;
    const el = document.getElementById(`quiz-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(id);
    const t = setTimeout(() => setHighlighted(null), 2200);
    return () => clearTimeout(t);
  }, [location.hash, location.key]);
  return (
    <QzPage width="wide">
      <QzPageHeader title="Analytics" />
      {quizzes.length === 0 ? (
        <QzEmpty
          title="No quizzes yet — create one to start collecting data."
          action={
            <Link to="/studio/onboarding" className="qz-btn qz-btn-primary">
              Create a quiz
            </Link>
          }
        />
      ) : (
        <div className="qz-qmod-list">
          {quizzes.map((q, i) => {
            const a = ACCENTS[i % ACCENTS.length]!;
            const live = q.status === "published";
            return (
              <div
                key={q.id}
                id={`quiz-${q.id}`}
                className={`qz-qmod${highlighted === q.id ? " is-deeplinked" : ""}`}
                style={{ "--mod-wash": a.wash, "--mod-ink": a.ink } as CSSProperties}
              >
                <div className="qz-qmod-head">
                  <span className="qz-qmod-ic" aria-hidden>{q.name.charAt(0).toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="qz-qmod-name">{q.name}</div>
                    <div className="qz-qmod-facts">
                      {q.questions} question{q.questions === 1 ? "" : "s"} · {q.personas} persona{q.personas === 1 ? "" : "s"} · {live ? "published" : "draft"}
                    </div>
                  </div>
                  <span className={`qz-badge ${live ? "qz-ok" : "qz-draft"}`}>{live ? "Live" : "Draft"}</span>
                  <Link to={`/studio/${q.id}`} className="qz-btn qz-btn-ghost qz-btn-sm">Open</Link>
                </div>

                {/* Graphs always show — greyed + animated; for a draft (or a
                    metric with no series yet) the KPI reads "—" over a muted
                    placeholder sparkline, so nothing looks fabricated. */}
                <div className={`qz-kpis${live ? "" : " is-muted"}`}>
                  <div className="qz-kpi">
                    <div className="n">{live ? q.started : "—"}</div>
                    <div className="l">Starts</div>
                    {live && q.delta != null ? (
                      <div className={`d ${q.delta >= 0 ? "up" : "down"}`}>{q.delta >= 0 ? "▲" : "▼"} {Math.abs(q.delta)}%</div>
                    ) : null}
                    <Spark data={live && q.trend.some((v) => v > 0) ? q.trend : SPARK_PLACEHOLDER} />
                  </div>
                  <div className="qz-kpi">
                    <div className="n">{live && q.rate != null ? `${q.rate}%` : "—"}</div>
                    <div className="l">Completion</div>
                    <Spark data={SPARK_PLACEHOLDER} />
                  </div>
                  <div className="qz-kpi">
                    <div className="n">{live ? q.contacts : "—"}</div>
                    <div className="l">Emails captured</div>
                    <Spark data={SPARK_PLACEHOLDER} />
                  </div>
                </div>

                <div className="qz-qmod-foot">
                  {!live ? (
                    <span className="qz-dim" style={{ fontSize: 12 }}>Finish and publish to start collecting data.</span>
                  ) : null}
                  {q.topPersona ? (
                    <span className="qz-modpill is-br"><Crown size={13} aria-hidden /> Top persona: {q.topPersona.name} ({q.topPersona.share}%)</span>
                  ) : null}
                  {q.feedback ? (
                    <span className="qz-modpill"><MessageSquare size={13} aria-hidden /> {q.feedback.label} · {q.feedback.count} response{q.feedback.count === 1 ? "" : "s"}</span>
                  ) : null}
                  <Link to={`/studio/${q.id}/analytics`} className="qz-link" style={{ marginLeft: "auto", fontSize: 12.5 }}>
                    View full analytics →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </QzPage>
  );
}
