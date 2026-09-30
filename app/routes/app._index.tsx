// app/routes/app._index.tsx
// The embedded (Shopify admin) Home. HOME-3 (first-run handoff §12): the same
// Home as the standalone /studio — screen 2 (no quiz: the two-panel create
// card) and screen 3 (with a quiz: reminder, two-row create module, Also
// waiting + Last 30 days, Your quizzes) via the shared <HomeScreens> +
// loadHomeForShop. NEVER screen 1: no modal on page load (Built for Shopify
// 4.3.3), so allowDialog is false here in both the loader and the action.
// Owner 2026-09-29: the embedded-only catalog features stay — sync banners
// above the Home screens; Resync, tag enrichment and What's new below them.

import { useEffect, useRef, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, Link } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatDate } from "../lib/formatDate";
import { syncCatalog } from "../jobs/catalogSync";
import { HOME_INTENTS, loadHomeForShop, runHomeIntentForShop } from "../lib/home.server";
import { APP_HOME_LINKS } from "../lib/homeFeed";
import { HomeScreens } from "../components/studio/HomeScreens";
import { QzButton, QzCard, QzBadge, QzBanner, QzTooltip } from "../components/qz";
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
    include: { _count: { select: { products: true, collections: true } } },
  });

  return json({
    // Null only before the first catalog sync creates the Shop row; the
    // mount-time auto-resync below creates it and revalidates.
    home: shop ? await loadHomeForShop(shop, { links: APP_HOME_LINKS, allowDialog: false }) : null,
    lastSyncAt: shop?.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: shop?.lastSyncStatus ?? null,
    lastSyncError: shop?.lastSyncError ?? null,
    productCount: shop?._count.products ?? 0,
    collectionCount: shop?._count.collections ?? 0,
  });
};

const isHomeIntent = (v: FormDataEntryValue | null) =>
  (HOME_INTENTS as readonly string[]).includes(String(v ?? ""));

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  // Home's own writes (dismiss-reminder) carry an intent; the Resync button
  // posts nothing.
  if (isHomeIntent(form.get("intent"))) {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) return json({ ok: false as const }, { status: 404 });
    const ok = await runHomeIntentForShop(shop, form, { allowDialog: false });
    return ok ? json({ ok: true as const }) : json({ ok: false as const }, { status: 400 });
  }
  const result = await syncCatalog(admin, session.shop);
  return json({ ok: true as const, result });
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  // The Resync fetcher only ever hits the sync branch of the action.
  const fetcher = useFetcher<{ ok: boolean; result?: { productCount: number; collectionCount: number } }>();
  const isResyncing =
    fetcher.state !== "idle" && fetcher.formMethod === "POST";
  const synced = fetcher.data?.result ?? null;

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
    ? formatDate(data.lastSyncAt)
    : "never";

  useEffect(() => {
    if (lastSyncMs > AUTO_RESYNC_THRESHOLD_MS && fetcher.state === "idle") {
      fetcher.submit({}, { method: "POST" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const banners: ReactNode[] = [];
  if (data.lastSyncStatus === "error") {
    banners.push(
      <QzBanner key="error" tone="crit" title="Last catalog sync failed">
        {data.lastSyncError ?? "Unknown error"}
      </QzBanner>,
    );
  }
  if (data.lastSyncStatus === "partial") {
    banners.push(
      <QzBanner key="partial" tone="warn" title="Catalog synced with skipped rows">
        {data.lastSyncError ??
          "Some products or collections were skipped during the last sync. Resync to retry."}
      </QzBanner>,
    );
  }
  if (isStale) {
    banners.push(
      <QzBanner key="stale" tone="warn" title="Catalog data is stale">
        The last successful sync was more than 48 hours ago. Resync to pull
        the latest products before generating a quiz.
      </QzBanner>,
    );
  }
  const top = banners.length > 0 ? <>{banners}</> : null;

  const bottom = (
    <>
      <section className="hm3-card hm3-sync" aria-labelledby="app-sec-catalog">
        <div className="hm3-sechead">
          <p className="hm3-lbl" id="app-sec-catalog">
            Catalog
          </p>
          <Link className="hm3-link" to="/app/categories">
            Categories
          </Link>
        </div>
        <p className="hm3-sync-line">
          {data.productCount} products · {data.collectionCount} collections · Synced{" "}
          {lastSyncRelative}
        </p>
        <div className="hm3-sync-acts">
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
        </div>
      </section>

      {synced && (
        <QzBanner tone="ok" title="Catalog synced">
          Synced {synced.productCount} products and {synced.collectionCount} collections.
        </QzBanner>
      )}

      {/* Enrichment summary: shows once a run finishes with no further
          batches queued. Reports total processed + any per-product errors
          so the merchant can spot Shopify push failures vs Claude failures. */}
      {enrichFetcher.data?.ok &&
        !enrichRunningRef.current &&
        enrichDoneRef.current > 0 && (
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
        )}

      <WhatsNewCard releases={LATEST_RELEASES} />
    </>
  );

  return (
    <>
      <TitleBar title="Wiskr" />
      {data.home ? (
        <HomeScreens
          data={data.home}
          links={APP_HOME_LINKS}
          goalAction="/app/goal"
          top={top}
          bottom={bottom}
        />
      ) : (
        <div className="hm3 is-first">
          <div className="hm3-col hm3-stack">
            {top}
            {bottom}
          </div>
        </div>
      )}
    </>
  );
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
        {/* QRTZ-S2 mono triage — a see-all link is the mock's .link role
            (Figtree 13/600, accent-ink), not a typewriter label. */}
        <Link
          to="/app/releases"
          prefetch="intent"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--qz-accent-ink)",
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
              borderRadius: "var(--qz-radius-pill)",
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
