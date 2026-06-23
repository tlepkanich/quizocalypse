import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatDate } from "../lib/formatDate";
import { QzPage, QzPageHeader, QzCard } from "../components/qz";

const PAGE_SIZE = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const skip = (page - 1) * PAGE_SIZE;

  if (!shop) {
    return json({ captures: [], total: 0, page, pages: 1 });
  }

  const [captures, total] = await Promise.all([
    prisma.emailCapture.findMany({
      where: { quiz: { shopId: shop.id } },
      orderBy: { capturedAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: {
        quiz: { select: { id: true, name: true } },
      },
    }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id } } }),
  ]);

  return json({
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    captures: captures.map((c) => ({
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      phone: c.phone,
      capturedAt: c.capturedAt.toISOString(),
      quizId: c.quiz.id,
      quizName: c.quiz.name,
    })),
  });
};

export default function AllCaptures() {
  const { captures, total, page, pages } = useLoaderData<typeof loader>();

  return (
    <QzPage>
      <TitleBar title="Captures" />

      <QzPageHeader
        eyebrow={`${total} total`}
        title="Email captures"
        subtitle="Every email a shopper has submitted across all of your quizzes, newest first. Webhook delivery to Klaviyo lands in a follow-up — captures are stored locally for now."
      />

      {captures.length === 0 ? (
        <QzCard dashed>
          <div className="qz-label">No captures yet</div>
          <p className="qz-muted qz-mt-8" style={{ maxWidth: "44ch" }}>
            Add an email-gate node to any published quiz. Captures arrive here
            within seconds of a shopper submitting.
          </p>
        </QzCard>
      ) : (
        <>
          <QzCard flush>
            <table className="qz-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Quiz</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {captures.map((c) => (
                  <tr key={c.id}>
                    <td className="qz-cell-name">{c.email}</td>
                    <td className="qz-muted">{c.firstName ?? "—"}</td>
                    <td className="qz-muted">{c.phone ?? "—"}</td>
                    <td>
                      <Link
                        to={`/app/quizzes/${c.quizId}/studio`}
                        prefetch="intent"
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        {c.quizName}
                      </Link>
                    </td>
                    <td className="qz-mono qz-dim" style={{ fontSize: 12 }}>
                      {formatDate(c.capturedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QzCard>
          {pages > 1 && (
            <div
              className="qz-row qz-row-between qz-mt-16"
              style={{ fontSize: 13 }}
            >
              <span className="qz-mono qz-dim">
                Page {page} of {pages}
              </span>
              <div className="qz-row qz-gap-8">
                {page > 1 && (
                  <Link to={`?page=${page - 1}`} prefetch="intent">
                    ← Previous
                  </Link>
                )}
                {page < pages && (
                  <Link to={`?page=${page + 1}`} prefetch="intent">
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </QzPage>
  );
}
