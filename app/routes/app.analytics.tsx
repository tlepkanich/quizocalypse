import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopAnalyticsForShop } from "../lib/quizAnalytics.server";
import { QzPage, QzPageHeader } from "../components/qz";
import { AnalyticsHomeView } from "../components/analytics/AnalyticsHomeView";

// ANALYTICS P0 — the embedded twin of /studio/analytics: same seam, same home
// view (no-fork rule). Also retires the old whole-table Event scan on the
// unindexed shopId (W15) — the seam queries by quizId.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, source: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const url = new URL(request.url);
  return json({ data: await shopAnalyticsForShop(shop, url.searchParams) });
};

export default function AggregateAnalytics() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <QzPage width="wide">
      <TitleBar title="Analytics" />
      <QzPageHeader title="Analytics" subtitle="Every number reconciles: the tiles are the sum of the table." />
      <AnalyticsHomeView
        data={data}
        quizHref={(id) => `/app/quizzes/${id}/studio`}
        analyticsHref={(id) => `/app/quizzes/${id}/analytics`}
        createHref="/app/quizzes"
      />
    </QzPage>
  );
}
