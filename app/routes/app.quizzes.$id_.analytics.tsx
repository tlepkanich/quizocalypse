import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { findAbBranches, aggregateVariantFunnel } from "../lib/abAnalytics";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzBanner,
  QzBadge,
  QzStat,
  QzStatGrid,
} from "../components/qz";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, name: true, status: true, publishedJson: true, draftJson: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  const eventRows = await prisma.event.findMany({
    where: { quizId: quiz.id },
    select: { sessionId: true, eventType: true, ts: true, payload: true },
  });

  // A/B tests: segment the funnel by the variant each session was assigned at
  // an ab_split branch (payload.ab carries the assignment). Prefer the live
  // (published) doc; fall back to the draft so unpublished tests still show.
  const parsedDoc = Quiz.safeParse(quiz.publishedJson ?? quiz.draftJson);
  const abTests = parsedDoc.success
    ? findAbBranches(parsedDoc.data).map((br) => {
        const funnels = aggregateVariantFunnel(eventRows, br.id, br.data.slots);
        const totalWeight = br.data.slots.reduce((s, sl) => s + sl.weight, 0);
        return {
          id: br.id,
          label: br.data.label || "A/B test",
          slots: br.data.slots.map((sl) => ({
            id: sl.id,
            label: sl.label,
            share: totalWeight > 0 ? Math.round((sl.weight / totalWeight) * 100) : 0,
            funnel: funnels[sl.id] ?? {
              entered: 0,
              started: 0,
              answered: 0,
              completed: 0,
              viewed: 0,
              clicked: 0,
            },
          })),
        };
      })
    : [];

  const sessionsByStage = new Map<string, Set<string>>();
  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const row of eventRows) {
    const set = sessionsByStage.get(row.eventType) ?? new Set();
    set.add(row.sessionId);
    sessionsByStage.set(row.eventType, set);
    if (!earliest || row.ts < earliest) earliest = row.ts;
    if (!latest || row.ts > latest) latest = row.ts;
  }
  const count = (k: string) => sessionsByStage.get(k)?.size ?? 0;

  const started = count("quiz_started");
  const answered = count("question_answered");
  const completed = count("quiz_completed");
  const viewed = count("recommendation_viewed");
  const clicked = count("recommendation_clicked");

  const captures = await prisma.emailCapture.findMany({
    where: { quizId: quiz.id },
    orderBy: { capturedAt: "desc" },
    take: 25,
  });

  return json({
    quiz: { id: quiz.id, name: quiz.name, status: quiz.status },
    abTests,
    funnel: { started, answered, completed, viewed, clicked },
    earliest: earliest ? earliest.toISOString() : null,
    latest: latest ? latest.toISOString() : null,
    captureCount: captures.length,
    captures: captures.map((c) => ({
      ...c,
      capturedAt: c.capturedAt.toISOString(),
    })),
  });
};

export default function QuizAnalytics() {
  const data = useLoaderData<typeof loader>();
  const { funnel } = data;
  const completionRate =
    funnel.started > 0 ? funnel.completed / funnel.started : 0;
  const clickThroughRate =
    funnel.viewed > 0 ? funnel.clicked / funnel.viewed : 0;

  return (
    <QzPage>
      <TitleBar title="Analytics" />

      <QzPageHeader
        eyebrow={
          <Link
            to={`/app/quizzes/${data.quiz.id}/studio`}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            ← {data.quiz.name}
          </Link>
        }
        title="Analytics"
        subtitle={
          data.earliest
            ? `Distinct shopper sessions reaching each stage. Earliest event ${new Date(data.earliest).toLocaleString()}.`
            : "Distinct shopper sessions reaching each stage. No events yet — counts will populate as shoppers take the quiz."
        }
        actions={
          <QzBadge tone={data.quiz.status === "published" ? "ok" : "draft"}>
            {data.quiz.status}
          </QzBadge>
        }
      />

      {funnel.started === 0 && (
        <div style={{ marginBottom: 24 }}>
          <QzBanner tone="default" title="No events yet">
            Once shoppers take this quiz on the storefront, the funnel counts
            will populate here.
          </QzBanner>
        </div>
      )}

      <QzStatGrid>
        <QzStat
          label="Completion rate"
          value={`${(completionRate * 100).toFixed(1)}%`}
          delta={`${funnel.completed} of ${funnel.started} started`}
        />
        <QzStat
          label="Click-through"
          value={`${(clickThroughRate * 100).toFixed(1)}%`}
          delta={`${funnel.clicked} of ${funnel.viewed} viewed`}
        />
        <QzStat
          label="Email captures"
          value={data.captureCount}
          delta={
            data.latest
              ? `Latest event ${new Date(data.latest).toLocaleString()}`
              : "—"
          }
        />
      </QzStatGrid>

      <section
        className="qz-mt-48"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: 32,
        }}
      >
        <div className="qz-col qz-gap-16">
          <div className="qz-section-head">
            <div>
              <div className="qz-label">Funnel</div>
              <h2 className="qz-h1 qz-mt-8">Stage-by-stage drop-off</h2>
            </div>
          </div>
          <QzCard flush>
            <FunnelRow label="Started" value={funnel.started} />
            <FunnelRow label="Answered ≥1 question" value={funnel.answered} />
            <FunnelRow label="Completed" value={funnel.completed} />
            <FunnelRow label="Saw recommendations" value={funnel.viewed} />
            <FunnelRow label="Clicked a product" value={funnel.clicked} last />
          </QzCard>
        </div>

        <div className="qz-col qz-gap-16">
          <div className="qz-section-head">
            <div>
              <div className="qz-label">Captures</div>
              <h2 className="qz-h1 qz-mt-8">Email list</h2>
            </div>
          </div>
          <QzCard flush>
            {data.captures.length === 0 ? (
              <div style={{ padding: 22 }}>
                <p className="qz-muted" style={{ margin: 0 }}>
                  No captures yet. Add an email-gate node to capture leads.
                </p>
              </div>
            ) : (
              <table className="qz-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.captures.map((c) => (
                    <tr key={c.id}>
                      <td className="qz-cell-name">{c.email}</td>
                      <td className="qz-muted">{c.firstName ?? "—"}</td>
                      <td className="qz-mono qz-dim" style={{ fontSize: 12 }}>
                        {new Date(c.capturedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </QzCard>
          <p className="qz-mono qz-dim" style={{ fontSize: 11.5 }}>
            Webhook delivery to external endpoints (Klaviyo, etc.) lands in a
            follow-up. Captures are stored locally for now.
          </p>
        </div>
      </section>

      {data.abTests.length > 0 ? (
        <section className="qz-mt-48 qz-col qz-gap-16">
          <div className="qz-section-head">
            <div>
              <div className="qz-label">A/B tests</div>
              <h2 className="qz-h1 qz-mt-8">Variant performance</h2>
            </div>
          </div>
          {data.abTests.map((t) => (
            <QzCard key={t.id} flush>
              <div
                style={{
                  padding: "14px 22px",
                  borderBottom: "1px solid var(--qz-rule)",
                  fontWeight: 600,
                }}
              >
                {t.label}
              </div>
              <table className="qz-table">
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Split</th>
                    <th>Entered</th>
                    <th>Completed</th>
                    <th>Clicked</th>
                  </tr>
                </thead>
                <tbody>
                  {t.slots.map((s) => (
                    <tr key={s.id}>
                      <td className="qz-cell-name">{s.label}</td>
                      <td className="qz-mono qz-dim">{s.share}%</td>
                      <td className="qz-mono qz-tnum">{s.funnel.entered}</td>
                      <td className="qz-mono qz-tnum">
                        {s.funnel.completed}
                        {s.funnel.entered > 0
                          ? ` · ${Math.round((s.funnel.completed / s.funnel.entered) * 100)}%`
                          : ""}
                      </td>
                      <td className="qz-mono qz-tnum">{s.funnel.clicked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </QzCard>
          ))}
        </section>
      ) : null}
    </QzPage>
  );
}

function FunnelRow({
  label,
  value,
  last,
}: {
  label: string;
  value: number;
  last?: boolean;
}) {
  return (
    <div
      className="qz-row qz-row-between"
      style={{
        padding: "16px 22px",
        borderBottom: last ? 0 : "1px solid var(--qz-rule)",
      }}
    >
      <span>{label}</span>
      <span className="qz-mono qz-tnum" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
