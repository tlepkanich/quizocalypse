import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncCatalog } from "../jobs/catalogSync";

const AUTO_RESYNC_THRESHOLD_MS = 5 * 60 * 1000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    include: {
      _count: { select: { products: true, collections: true, quizzes: true } },
    },
  });

  return json({
    shopDomain: session.shop,
    installedAt: shop?.installedAt?.toISOString() ?? null,
    lastSyncAt: shop?.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: shop?.lastSyncStatus ?? null,
    lastSyncError: shop?.lastSyncError ?? null,
    productCount: shop?._count.products ?? 0,
    collectionCount: shop?._count.collections ?? 0,
    quizCount: shop?._count.quizzes ?? 0,
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

  const lastSyncRelative = data.lastSyncAt
    ? new Date(data.lastSyncAt).toLocaleString()
    : "never";
  const lastSyncMs = data.lastSyncAt
    ? Date.now() - new Date(data.lastSyncAt).getTime()
    : Infinity;
  const isStale = lastSyncMs > 48 * 60 * 60 * 1000;

  // Auto-resync on dashboard load when data is stale (>5 min) or has never
  // synced. Cheap on Shopify side (bulk op is rate-limited & deduplicated).
  useEffect(() => {
    if (lastSyncMs > AUTO_RESYNC_THRESHOLD_MS && fetcher.state === "idle") {
      fetcher.submit({}, { method: "POST" });
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Page>
      <TitleBar title="Quizocalypse" />
      <BlockStack gap="500">
        {data.lastSyncStatus === "error" && (
          <Banner tone="critical" title="Last catalog sync failed">
            <p>{data.lastSyncError ?? "Unknown error"}</p>
          </Banner>
        )}
        {isStale && (
          <Banner tone="warning" title="Catalog data is stale">
            <p>
              The last successful sync was more than 48 hours ago. Resync to
              pull the latest products before generating a quiz.
            </p>
          </Banner>
        )}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Catalog
                </Text>
                <InlineStack gap="600" wrap={false}>
                  <Stat label="Products" value={data.productCount} />
                  <Stat label="Collections" value={data.collectionCount} />
                  <Stat label="Quizzes" value={data.quizCount} />
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Last sync: {lastSyncRelative}
                </Text>
                <InlineStack gap="300">
                  <Button
                    onClick={() => fetcher.submit({}, { method: "POST" })}
                    loading={isResyncing}
                  >
                    Resync catalog
                  </Button>
                  <Link to="/app/design">
                    <Button>Brand design</Button>
                  </Link>
                  <Link to="/app/quizzes">
                    <Button>{`Manage quizzes (${data.quizCount})`}</Button>
                  </Link>
                  <Link to="/app/quizzes/new">
                    <Button variant="primary" disabled={data.productCount === 0}>
                      New AI quiz
                    </Button>
                  </Link>
                </InlineStack>
                {fetcher.data?.ok && (
                  <Banner tone="success" title="Catalog synced">
                    <p>
                      Synced {fetcher.data.result.productCount} products and{" "}
                      {fetcher.data.result.collectionCount} collections.
                    </p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Box>
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="heading2xl">
        {value}
      </Text>
    </Box>
  );
}
