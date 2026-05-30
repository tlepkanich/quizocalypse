// app/routes/app.categories.tsx
// Admin page for auto-discovered shopper-archetype categories. Pure
// presentation; all the work happens in /api/categories/discover.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzBanner,
  QzTooltip,
} from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({
      categories: [],
      productCount: 0,
      shopDomain: session.shop,
    });
  }
  const [categories, productCount] = await Promise.all([
    prisma.category.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.count({ where: { shopId: shop.id } }),
  ]);
  return json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      tags: c.tags,
      productCount: c.productIds.length,
      rationale: c.rationale,
      createdAt: c.createdAt.toISOString(),
    })),
    productCount,
    shopDomain: session.shop,
  });
};

interface DiscoverResponse {
  ok: boolean;
  error?: string;
  runId?: string;
  categories?: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    productCount: number;
    rationale?: string | null;
  }>;
}

export default function CategoriesPage() {
  const { categories, productCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<DiscoverResponse>();
  const isDiscovering =
    fetcher.state !== "idle" && fetcher.formMethod === "POST";

  // Show the freshly-discovered set when present (e.g. immediately after
  // a click), otherwise fall back to the loader's persisted list.
  const liveCategories = fetcher.data?.ok && fetcher.data.categories
    ? fetcher.data.categories.map((c) => ({
        ...c,
        createdAt: new Date().toISOString(),
      }))
    : categories;

  const hasCategories = liveCategories.length > 0;

  const discover = () => {
    fetcher.submit(
      {},
      { method: "POST", action: "/api/categories/discover" },
    );
  };

  return (
    <QzPage>
      <TitleBar title="Categories" />
      <QzPageHeader
        eyebrow="Categories"
        title={
          <>
            Auto-discovered{" "}
            <span className="qz-serif-italic">archetypes</span>.
          </>
        }
        subtitle="We read your catalog and group it into 5–9 shopper archetypes. Wire them into a quiz so each result page returns a curated bucket instead of scored individuals."
        actions={
          <QzButton
            variant="accent"
            onClick={discover}
            disabled={isDiscovering || productCount < 5}
          >
            {isDiscovering
              ? "Discovering…"
              : hasCategories
                ? "Re-discover"
                : "Discover categories"}
          </QzButton>
        }
      />

      {productCount < 5 && (
        <div className="qz-mt-16">
          <QzBanner tone="warn" title="Sync products first">
            We need at least 5 synced products to discover meaningful
            archetypes. Run a catalog sync from the dashboard, then come back.
          </QzBanner>
        </div>
      )}

      {fetcher.data?.ok === false && (
        <div className="qz-mt-16">
          <QzBanner tone="crit" title="Discovery failed">
            {fetcher.data.error ?? "Unknown error"}
          </QzBanner>
        </div>
      )}

      {!hasCategories ? (
        <div className="qz-mt-32">
          <QzCard dashed>
            <div className="qz-label">No categories yet</div>
            <p
              className="qz-h3 qz-mt-8"
              style={{ lineHeight: 1.4, maxWidth: "52ch" }}
            >
              Click <strong>Discover categories</strong> and Claude will
              cluster your catalog into archetypal shopper buckets. Each
              quiz can then point its result pages at the right archetype.
            </p>
          </QzCard>
        </div>
      ) : (
        <section
          className="qz-mt-24"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {liveCategories.map((c) => (
            <QzCard key={c.id}>
              <div className="qz-col qz-gap-12">
                <div
                  className="qz-row qz-row-between"
                  style={{ alignItems: "baseline" }}
                >
                  <h2 className="qz-h2" style={{ margin: 0, fontSize: 18 }}>
                    {c.name}
                  </h2>
                  {c.rationale && (
                    <QzTooltip content={c.rationale}>
                      <span
                        className="qz-mono qz-dim"
                        style={{ fontSize: 11, cursor: "help" }}
                      >
                        why?
                      </span>
                    </QzTooltip>
                  )}
                </div>
                <p
                  className="qz-muted"
                  style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}
                >
                  {c.description}
                </p>
                <div className="qz-row" style={{ flexWrap: "wrap", gap: 4 }}>
                  {c.tags.slice(0, 6).map((t) => (
                    <span
                      key={t}
                      style={{
                        background: "var(--qz-cream-2)",
                        border: "1px solid var(--qz-rule)",
                        borderRadius: 999,
                        padding: "2px 8px",
                        fontSize: 11,
                        color: "var(--qz-ink-2)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                  {c.tags.length > 6 && (
                    <span
                      className="qz-mono qz-dim"
                      style={{ fontSize: 11, padding: "2px 4px" }}
                    >
                      +{c.tags.length - 6}
                    </span>
                  )}
                </div>
                <div
                  className="qz-mono qz-dim"
                  style={{
                    fontSize: 11,
                    paddingTop: 4,
                    borderTop: "1px solid var(--qz-rule)",
                  }}
                >
                  {c.productCount} product
                  {c.productCount === 1 ? "" : "s"} assigned
                </div>
              </div>
            </QzCard>
          ))}
        </section>
      )}
    </QzPage>
  );
}
