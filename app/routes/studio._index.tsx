import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzPageHeader, QzCard, QzBadge } from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id },
    select: { id: true, name: true, status: true, version: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  return json({
    shopDomain: shop.shopDomain,
    quizzes: quizzes.map((q) => ({
      id: q.id,
      name: q.name,
      status: q.status,
      version: q.version,
      updatedAt: q.updatedAt.toISOString(),
    })),
  });
};

export default function StudioIndex() {
  const { shopDomain, quizzes } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader eyebrow="Standalone builder" title="Your quizzes" subtitle={shopDomain} />
      {quizzes.length === 0 ? (
        <QzCard dashed>
          <div className="qz-label">No quizzes yet</div>
          <p className="qz-dim" style={{ marginTop: 6 }}>
            Create one from the embedded Shopify app, then it'll appear here to build full-screen.
          </p>
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
            <QzCard key={q.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{q.name}</strong>
                <QzBadge tone={q.status === "published" ? "ok" : "draft"}>{q.status}</QzBadge>
              </div>
              <div className="qz-dim" style={{ fontSize: 12 }}>
                v{q.version} · updated {new Date(q.updatedAt).toLocaleDateString()}
              </div>
              <div className="qz-row" style={{ gap: 10, marginTop: 4 }}>
                <Link to={`/studio/${q.id}`} className="qz-btn qz-btn-primary qz-btn-sm">
                  Open builder →
                </Link>
                <a
                  href={`/q/${q.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                >
                  Preview
                </a>
              </div>
            </QzCard>
          ))}
        </div>
      )}
    </QzPage>
  );
}
