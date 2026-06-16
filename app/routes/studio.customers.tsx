import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzPageHeader, QzCard, QzStat, QzStatGrid } from "../components/qz";

// QD-8 — Customers: every email/phone a quiz captured, newest first. The
// standalone twin of the embedded /app/captures, reusing the EmailCapture
// model (quiz-scoped → shop-scoped via the relation).
const PAGE_SIZE = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const skip = (page - 1) * PAGE_SIZE;

  const [captures, total, withPhone] = await Promise.all([
    prisma.emailCapture.findMany({
      where: { quiz: { shopId: shop.id } },
      orderBy: { capturedAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: { quiz: { select: { id: true, name: true } } },
    }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id } } }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id }, phone: { not: null } } }),
  ]);

  return json({
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    withPhone,
    rows: captures.map((c) => ({
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      phone: c.phone,
      capturedAt: c.capturedAt,
      quizId: c.quiz.id,
      quizName: c.quiz.name,
    })),
  });
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--qz-rule-2)",
  fontSize: 14,
};

export default function StudioCustomers() {
  const data = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Customers"
        title="Captured contacts"
        subtitle="Everyone who shared their details through one of your quizzes — newest first."
      />

      <QzStatGrid>
        <QzStat label="Total contacts" value={String(data.total)} />
        <QzStat label="With a phone number" value={String(data.withPhone)} />
      </QzStatGrid>

      {data.rows.length === 0 ? (
        <QzCard>
          <p className="qz-muted" style={{ margin: 0 }}>
            No contacts yet. Add an email step to a quiz — captures land here the moment a
            shopper submits.
          </p>
        </QzCard>
      ) : (
        <QzCard>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Email", "Name", "Phone", "Quiz", "Captured"].map((h) => (
                    <th
                      key={h}
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
                    <td style={cellStyle}>{r.email}</td>
                    <td style={cellStyle}>{r.firstName || <span className="qz-dim">—</span>}</td>
                    <td style={cellStyle}>{r.phone || <span className="qz-dim">—</span>}</td>
                    <td style={cellStyle}>
                      <Link to={`/studio/${r.quizId}/analytics`} className="qz-link">
                        {r.quizName}
                      </Link>
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: "nowrap", color: "var(--qz-ink-3)" }}>
                      {new Date(r.capturedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.pages > 1 && (
            <div className="qz-row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              {data.page > 1 && (
                <Link to={`?page=${data.page - 1}`} className="qz-btn qz-btn-ghost qz-btn-sm">
                  ← Newer
                </Link>
              )}
              <span className="qz-dim" style={{ fontSize: 13, alignSelf: "center" }}>
                Page {data.page} of {data.pages}
              </span>
              {data.page < data.pages && (
                <Link to={`?page=${data.page + 1}`} className="qz-btn qz-btn-ghost qz-btn-sm">
                  Older →
                </Link>
              )}
            </div>
          )}
        </QzCard>
      )}
    </QzPage>
  );
}
