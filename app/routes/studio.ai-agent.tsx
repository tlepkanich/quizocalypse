import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzPageHeader, QzCard } from "../components/qz";

// QD-8 — AI Agent: the front door to building/refining quizzes with AI. "Create
// with AI" runs the identity-first funnel; each existing quiz opens in the
// builder where the AI chat panel is docked. No new AI surface — a launcher
// over what already exists.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    select: { id: true, name: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });
  return json({
    quizzes: quizzes.map((q) => ({
      id: q.id,
      name: q.name,
      status: q.status,
      updatedAt: q.updatedAt.toISOString(),
    })),
  });
};

export default function StudioAiAgent() {
  const data = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="AI Agent"
        title="Build and refine with AI"
        subtitle="Describe what you want and the AI assembles the quiz — questions, logic, recommendations, and copy in your brand voice."
        actions={
          <Link to="/studio/onboarding" className="qz-btn qz-btn-accent">
            ✨ Create with AI
          </Link>
        }
      />

      <QzCard>
        <h2 className="qz-h2" style={{ marginTop: 0 }}>
          Refine an existing quiz
        </h2>
        <p className="qz-muted" style={{ marginTop: 4 }}>
          Open any quiz — the AI chat lives right in the builder. Ask it to add a question,
          rewrite answers, switch the theme, or re-balance recommendations.
        </p>
        {data.quizzes.length === 0 ? (
          <p className="qz-dim" style={{ marginTop: 16 }}>
            No quizzes yet — start with <strong>Create with AI</strong> above.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {data.quizzes.map((q) => (
              <Link
                key={q.id}
                to={`/studio/${q.id}`}
                className="qz-row qz-row-between"
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  padding: "12px 14px",
                  borderRadius: "var(--qz-radius)",
                  border: "1px solid var(--qz-rule)",
                  background: "var(--qz-paper)",
                }}
              >
                <span>
                  <span style={{ fontWeight: 500 }}>{q.name}</span>
                  <span className="qz-dim" style={{ fontSize: 12, marginLeft: 8 }}>
                    {q.status}
                  </span>
                </span>
                <span className="qz-link">Open in builder →</span>
              </Link>
            ))}
          </div>
        )}
      </QzCard>
    </QzPage>
  );
}
