// app/routes/app._index.tsx
// Quizocalypse dashboard, redesigned in Grid Notebook style.
// Same loader/action behavior as the original — only the JSX is rebuilt.

import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, Link } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncCatalog } from "../jobs/catalogSync";
import {
  QzPage,
  QzPageHeader,
  QzButton,
  QzCard,
  QzBadge,
  QzBanner,
  QzStat,
  QzStatGrid,
} from "../components/qz";

const AUTO_RESYNC_THRESHOLD_MS = 5 * 60 * 1000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: {
      _count: { select: { products: true, collections: true, quizzes: true } },
    },
  });

  // Pull a couple of recent quizzes for the dashboard preview.
  const recent = shop
    ? await prisma.quiz.findMany({
        where: { shopId: shop.id },
        select: {
          id: true,
          name: true,
          status: true,
          version: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 3,
      })
    : [];

  return json({
    shopDomain: session.shop,
    lastSyncAt: shop?.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: shop?.lastSyncStatus ?? null,
    lastSyncError: shop?.lastSyncError ?? null,
    productCount: shop?._count.products ?? 0,
    collectionCount: shop?._count.collections ?? 0,
    quizCount: shop?._count.quizzes ?? 0,
    recent: recent.map((q) => ({ ...q, updatedAt: q.updatedAt.toISOString() })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const result = await syncCatalog(admin, session.shop);
  return json({ ok: true, result });
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isResyncing =
    fetcher.state !== "idle" && fetcher.formMethod === "POST";

  const lastSyncMs = data.lastSyncAt
    ? Date.now() - new Date(data.lastSyncAt).getTime()
    : Infinity;
  const isStale = lastSyncMs > 48 * 60 * 60 * 1000;
  const lastSyncRelative = data.lastSyncAt
    ? new Date(data.lastSyncAt).toLocaleString()
    : "never";

  useEffect(() => {
    if (lastSyncMs > AUTO_RESYNC_THRESHOLD_MS && fetcher.state === "idle") {
      fetcher.submit({}, { method: "POST" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QzPage>
      <TitleBar title="Quizocalypse" />

      {data.lastSyncStatus === "error" && (
        <QzBanner tone="crit" title="Last catalog sync failed">
          {data.lastSyncError ?? "Unknown error"}
        </QzBanner>
      )}
      {isStale && (
        <QzBanner tone="warn" title="Catalog data is stale">
          The last successful sync was more than 48 hours ago. Resync to pull
          the latest products before generating a quiz.
        </QzBanner>
      )}

      <QzPageHeader
        eyebrow="Welcome back"
        title={
          <>
            Good morning,{" "}
            <span className="qz-serif-italic">{shortDomain(data.shopDomain)}.</span>
          </>
        }
        subtitle={
          <>
            Your catalog is fresh and{" "}
            <strong style={{ color: "var(--qz-ink)", fontWeight: 600 }}>
              {data.quizCount} quizzes
            </strong>{" "}
            are configured. Pick up where you left off, or generate a new one
            from your catalog.
          </>
        }
        actions={
          <>
            <QzButton
              onClick={() => fetcher.submit({}, { method: "POST" })}
              disabled={isResyncing}
            >
              {isResyncing ? "Syncing…" : "Resync catalog"}
            </QzButton>
            <Link to="/app/quizzes/new">
              <QzButton variant="accent" disabled={data.productCount === 0}>
                New AI quiz
              </QzButton>
            </Link>
          </>
        }
      />

      <QzStatGrid>
        <QzStat
          label="Products in catalog"
          value={data.productCount}
          delta={`Synced ${lastSyncRelative}`}
        />
        <QzStat
          label="Collections"
          value={data.collectionCount}
          delta={`From ${data.shopDomain}`}
        />
        <QzStat
          label="Quizzes"
          value={data.quizCount}
          delta={data.quizCount === 0 ? "Generate your first" : "Tap a quiz to edit"}
        />
      </QzStatGrid>

      <section
        className="qz-mt-48"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
          gap: 32,
        }}
      >
        <div className="qz-col qz-gap-24">
          <div className="qz-section-head">
            <div>
              <div className="qz-label">Recent</div>
              <h2 className="qz-h1 qz-mt-8">Quizzes you've been working on</h2>
            </div>
            <Link to="/app/quizzes">
              <QzButton variant="ghost" size="sm">View all →</QzButton>
            </Link>
          </div>

          {data.recent.length === 0 ? (
            <QzCard dashed>
              <div className="qz-label">No quizzes yet</div>
              <p className="qz-h2 qz-mt-8">
                Generate one from a goal prompt to get started.
              </p>
              <Link to="/app/quizzes/new" className="qz-mt-16" style={{ display: "inline-block" }}>
                <QzButton variant="accent">New AI quiz</QzButton>
              </Link>
            </QzCard>
          ) : (
            <div className="qz-col qz-gap-16">
              {data.recent.map((q) => (
                <Link
                  key={q.id}
                  to={`/app/quizzes/${q.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <QzCard style={{ cursor: "pointer" }}>
                    <div
                      className="qz-row qz-row-between"
                      style={{ alignItems: "flex-start" }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="qz-row qz-gap-8" style={{ alignItems: "center" }}>
                          <QzBadge tone={q.status === "published" ? "ok" : "draft"}>
                            {q.status}
                          </QzBadge>
                          <span className="qz-mono qz-dim">v{q.version}</span>
                        </div>
                        <h3 className="qz-h2 qz-mt-8">{q.name}</h3>
                        <p className="qz-mono qz-dim qz-mt-8" style={{ margin: 0 }}>
                          Updated {new Date(q.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <QzButton variant="ghost" size="sm">Open →</QzButton>
                    </div>
                  </QzCard>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="qz-col qz-gap-24">
          <div className="qz-section-head">
            <div>
              <div className="qz-label">Activity</div>
              <h2 className="qz-h1 qz-mt-8">What changed</h2>
            </div>
          </div>

          <QzCard flush>
            <ActivityRow
              when={lastSyncRelative}
              who="Catalog sync"
              what={`${data.productCount} products / ${data.collectionCount} collections`}
            />
            <ActivityRow
              when="—"
              who="Webhooks"
              what="Listening for product / collection / inventory deltas"
              last
            />
          </QzCard>

          <QzCard dashed>
            <div className="qz-label">Tip</div>
            <p className="qz-h3 qz-mt-8" style={{ lineHeight: 1.4 }}>
              Quizzes with an <span className="qz-serif-italic">email step</span>{" "}
              capture ~3× more leads — and the AI will skip it if you ask.
            </p>
          </QzCard>
        </div>
      </section>

      {fetcher.data?.ok && (
        <div className="qz-mt-24">
          <QzBanner tone="ok" title="Catalog synced">
            Synced {fetcher.data.result.productCount} products and{" "}
            {fetcher.data.result.collectionCount} collections.
          </QzBanner>
        </div>
      )}
    </QzPage>
  );
}

function ActivityRow({
  when,
  who,
  what,
  last,
}: {
  when: string;
  who: string;
  what: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "16px 22px",
        borderBottom: last ? 0 : "1px solid var(--qz-rule)",
      }}
    >
      <div className="qz-label" style={{ color: "var(--qz-ink-4)" }}>
        {when}
      </div>
      <div style={{ marginTop: 4, color: "var(--qz-ink-2)" }}>
        <span style={{ fontWeight: 500, color: "var(--qz-ink)" }}>{who}</span>
        {" — "}
        {what}
      </div>
    </div>
  );
}

function shortDomain(d: string) {
  return d.replace(/\.myshopify\.com$/, "");
}
