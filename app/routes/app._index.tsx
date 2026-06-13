// app/routes/app._index.tsx
// Quizocalypse dashboard, redesigned in Grid Notebook style.
// Same loader/action behavior as the original — only the JSX is rebuilt.

import { useEffect, useRef } from "react";
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
  QzTooltip,
} from "../components/qz";
import {
  LATEST_RELEASES,
  type Release,
  type ReleaseFeature,
} from "../lib/releases";

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

  // Tag enrichment: separate fetcher so it doesn't interfere with the
  // resync button's state. Auto-loops while `remaining > 0` so one
  // click enriches the whole catalog without the merchant babysitting.
  const enrichFetcher = useFetcher<{
    ok: boolean;
    processed?: number;
    remaining?: number;
    shopifyErrors?: Array<{ productId: string; error: string }>;
    enrichmentErrors?: Array<{ productId: string; error: string }>;
    error?: string;
  }>();
  const isEnriching =
    enrichFetcher.state !== "idle" && enrichFetcher.formMethod === "POST";
  const enrichRunningRef = useRef(false);
  const enrichTotalRef = useRef(0);
  const enrichDoneRef = useRef(0);

  const triggerEnrichBatch = () => {
    enrichFetcher.submit(
      {},
      { method: "POST", action: "/api/products/enrich" },
    );
  };

  const startEnrichment = () => {
    if (enrichRunningRef.current) return;
    enrichRunningRef.current = true;
    enrichDoneRef.current = 0;
    enrichTotalRef.current = 0;
    triggerEnrichBatch();
  };

  // Auto-loop: when a batch finishes with `remaining > 0`, fire the next
  // one. The ref guard prevents re-entry mid-flight.
  useEffect(() => {
    if (!enrichRunningRef.current) return;
    const d = enrichFetcher.data;
    if (!d || enrichFetcher.state !== "idle") return;
    const processed = d.processed ?? 0;
    const remaining = d.remaining ?? 0;
    enrichDoneRef.current += processed;
    enrichTotalRef.current = Math.max(
      enrichTotalRef.current,
      enrichDoneRef.current + remaining,
    );
    if (remaining > 0 && d.ok) {
      triggerEnrichBatch();
    } else {
      enrichRunningRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichFetcher.data, enrichFetcher.state]);

  const enrichLabel = (() => {
    if (!isEnriching && !enrichRunningRef.current) return "Enrich tags";
    if (enrichTotalRef.current > 0) {
      return `Enriching ${enrichDoneRef.current} / ${enrichTotalRef.current}…`;
    }
    return "Enriching…";
  })();

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
            <QzButton
              onClick={startEnrichment}
              disabled={isEnriching || data.productCount === 0}
            >
              {enrichLabel}
            </QzButton>
            <Link to="/app/quizzes/new">
              <QzButton variant="ghost" disabled={data.productCount === 0}>
                Blank quiz
              </QzButton>
            </Link>
            <Link to="/app/onboarding/brand">
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
        className="qz-mt-48 qz-responsive-grid"
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
                Start with a template or let AI build one from your catalog.
              </p>
              <div className="qz-row qz-mt-16" style={{ gap: 10, flexWrap: "wrap" }}>
                <Link to="/app/onboarding/brand" style={{ display: "inline-block" }}>
                  <QzButton variant="accent">Guided setup →</QzButton>
                </Link>
                <Link to="/app/quizzes/new" style={{ display: "inline-block" }}>
                  <QzButton variant="ghost">Blank quiz</QzButton>
                </Link>
              </div>
            </QzCard>
          ) : (
            <div className="qz-col qz-gap-16">
              {data.recent.map((q) => (
                <Link
                  key={q.id}
                  to={`/app/quizzes/${q.id}/studio`}
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
          <WhatsNewCard releases={LATEST_RELEASES} />
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

      {/* Enrichment summary: shows once a run finishes with no further
          batches queued. Reports total processed + any per-product errors
          so the merchant can spot Shopify push failures vs Claude failures. */}
      {enrichFetcher.data?.ok &&
        !enrichRunningRef.current &&
        enrichDoneRef.current > 0 && (
          <div className="qz-mt-24">
            <QzBanner
              tone={
                (enrichFetcher.data.shopifyErrors?.length ?? 0) +
                  (enrichFetcher.data.enrichmentErrors?.length ?? 0) >
                0
                  ? "warn"
                  : "ok"
              }
              title={`Enriched ${enrichDoneRef.current} product${enrichDoneRef.current === 1 ? "" : "s"}`}
            >
              {(enrichFetcher.data.shopifyErrors?.length ?? 0) === 0 &&
              (enrichFetcher.data.enrichmentErrors?.length ?? 0) === 0
                ? "Tags merged into Prisma and pushed back to Shopify."
                : `${enrichFetcher.data.enrichmentErrors?.length ?? 0} enrichment failures, ${enrichFetcher.data.shopifyErrors?.length ?? 0} Shopify push failures. The local catalog still has the enriched tags.`}
            </QzBanner>
          </div>
        )}
    </QzPage>
  );
}

function shortDomain(d: string) {
  return d.replace(/\.myshopify\.com$/, "");
}

// Compact "What's new" card for the dashboard right column. Lists the
// latest N releases as compressed rows — each with a version chip, the
// release name, and a flex-wrap of feature pills. Hovering or tapping a
// pill reveals the feature description via QzTooltip.
function WhatsNewCard({ releases }: { releases: Release[] }) {
  return (
    <QzCard>
      <div
        className="qz-row qz-row-between"
        style={{ alignItems: "baseline", marginBottom: 12 }}
      >
        <div className="qz-label">What&apos;s new</div>
        <Link
          to="/app/releases"
          prefetch="intent"
          style={{
            fontSize: 11,
            fontFamily: "var(--qz-font-mono)",
            color: "var(--qz-ink-3)",
            textDecoration: "none",
          }}
        >
          View all →
        </Link>
      </div>
      <div className="qz-col qz-gap-16">
        {releases.map((r, idx) => (
          <div
            key={r.version}
            style={{
              paddingBottom: idx === releases.length - 1 ? 0 : 12,
              borderBottom:
                idx === releases.length - 1
                  ? "none"
                  : "1px solid var(--qz-rule)",
            }}
          >
            <div
              className="qz-row qz-gap-8"
              style={{ alignItems: "baseline" }}
            >
              <QzBadge tone="ok">{r.version}</QzBadge>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: "var(--qz-ink)",
                }}
              >
                {r.name}
              </span>
            </div>
            <p
              className="qz-muted"
              style={{ fontSize: 12, margin: "6px 0 8px", lineHeight: 1.4 }}
            >
              {r.summary}
            </p>
            <ReleaseFeatures features={r.features} />
          </div>
        ))}
      </div>
    </QzCard>
  );
}

// Shared pill+tooltip rendering used on both the dashboard card and the
// dedicated /app/releases page. Extracted so we don't duplicate the
// styling logic.
export function ReleaseFeatures({ features }: { features: ReleaseFeature[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
      }}
    >
      {features.map((f) => (
        <QzTooltip key={f.title} content={f.description}>
          <button
            type="button"
            style={{
              background: "var(--qz-cream-2)",
              border: "1px solid var(--qz-rule)",
              borderRadius: 999,
              padding: "4px 10px",
              fontSize: 11,
              fontFamily: "var(--qz-font-body)",
              color: "var(--qz-ink-2)",
              cursor: "help",
              lineHeight: 1.3,
            }}
          >
            {f.title}
          </button>
        </QzTooltip>
      ))}
    </div>
  );
}
