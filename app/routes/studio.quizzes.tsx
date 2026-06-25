import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzPageHeader, QzCard, QzBadge } from "../components/qz";
import {
  computeBenchmarks,
  MIN_SESSIONS_FOR_COMPARE,
  type QuizBenchmark,
} from "../lib/quizBenchmarks";
import { formatDate } from "../lib/formatDate";
import { SHOW_OTHER_BUILD_PATHS } from "../lib/studioFlags";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quizzes = await prisma.quiz.findMany({
    // Hide in-flight Step-1 funnel drafts (buildState:"step1") — they aren't real
    // quizzes yet. `not` includes NULL rows in Prisma, but the OR makes that
    // explicit so a normal quiz can never drop off the gallery.
    where: {
      shopId: shop.id,
      OR: [{ buildState: null }, { buildState: { not: "step1" } }],
    },
    select: { id: true, name: true, status: true, version: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const eventRows = await prisma.event.findMany({
    where: {
      quizId: { in: quizzes.map((q) => q.id) },
      eventType: { in: ["quiz_engaged", "quiz_completed"] },
    },
    select: { quizId: true, eventType: true, sessionId: true },
    distinct: ["quizId", "eventType", "sessionId"],
  });
  const benchmarks = computeBenchmarks(eventRows);
  return json({
    averageRate: benchmarks.averageRate,
    quizzes: quizzes.map((q) => ({
      id: q.id,
      name: q.name,
      status: q.status,
      version: q.version,
      updatedAt: q.updatedAt.toISOString(),
      bench: benchmarks.byQuiz[q.id] ?? null,
    })),
  });
};

// One dim line of truth per card: the quiz's completion rate, with a
// vs-account-average comparison once the sample clears the floor.
function BenchLine({
  bench,
  averageRate,
}: {
  bench: QuizBenchmark | null;
  averageRate: number | null;
}) {
  if (!bench || bench.rate === null) return null;
  const compare =
    averageRate !== null && bench.started >= MIN_SESSIONS_FOR_COMPARE
      ? bench.rate > averageRate
        ? ` · ▲ above your ${averageRate}% avg`
        : bench.rate < averageRate
          ? ` · ▼ below your ${averageRate}% avg`
          : ` · ≈ your ${averageRate}% avg`
      : "";
  return (
    <div className="qz-dim" style={{ fontSize: 12 }}>
      {bench.rate}% completion ({bench.completed}/{bench.started}){compare}
    </div>
  );
}

export default function StudioQuizzes() {
  const { quizzes, averageRate } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Library"
        title="Quizzes"
        actions={
          <div className="qz-row" style={{ gap: 8 }}>
            {SHOW_OTHER_BUILD_PATHS && (
              <Link to="/studio/new" className="qz-btn qz-btn-ghost qz-btn-sm">
                New quiz
              </Link>
            )}
            <Link to="/studio/onboarding" className="qz-btn qz-btn-accent">
              ✨ Build with AI →
            </Link>
          </div>
        }
      />
      {quizzes.length === 0 ? (
        <QzCard dashed style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          <div className="qz-label">No quizzes yet</div>
          <p className="qz-dim" style={{ margin: 0 }}>
            Create your first quiz — our AI builds it for you from your products.
          </p>
          <div className="qz-row" style={{ gap: 8 }}>
            <Link to="/studio/onboarding" className="qz-btn qz-btn-accent qz-btn-sm">
              ✨ Build with AI →
            </Link>
            {SHOW_OTHER_BUILD_PATHS && (
              <Link to="/studio/new" className="qz-btn qz-btn-ghost qz-btn-sm">
                Start blank / template
              </Link>
            )}
          </div>
        </QzCard>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {quizzes.map((q) => (
            <QzCard
              key={q.id}
              className="qz-interactive"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div className="qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                <span
                  style={{
                    fontFamily: "var(--qz-font-display)",
                    fontWeight: 600,
                    fontSize: 18,
                    lineHeight: 1.2,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {q.name}
                </span>
                <QzBadge tone={q.status === "published" ? "ok" : "draft"}>{q.status}</QzBadge>
              </div>
              <div className="qz-dim" style={{ fontSize: 12 }}>
                v{q.version} · updated {formatDate(q.updatedAt)}
              </div>
              <BenchLine bench={q.bench} averageRate={averageRate} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
                <Link
                  to={`/studio/${q.id}`}
                  className="qz-btn qz-btn-primary qz-btn-sm"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Open builder →
                </Link>
                <div className="qz-row" style={{ gap: 8 }}>
                  <Link
                    to={`/studio/${q.id}/analytics`}
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Analytics
                  </Link>
                  <Link
                    to={`/studio/${q.id}/embed`}
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Share
                  </Link>
                  <a
                    href={`/q/${q.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Preview
                  </a>
                </div>
              </div>
            </QzCard>
          ))}
        </div>
      )}
    </QzPage>
  );
}
