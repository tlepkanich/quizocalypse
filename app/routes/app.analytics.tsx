import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopAnalyticsForShop, handleInsightDismissForm } from "../lib/quizAnalytics.server";
import { QzPage } from "../components/qz";
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

// Dismiss / restore a "What to fix" card (14-day snooze) — the embedded twin
// of the studio action, over the same shared writer.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, select: { id: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const result = await handleInsightDismissForm(shop.id, await request.formData());
  return json(result ?? { ok: false }, { status: result?.ok ? 200 : 400 });
};

export default function AggregateAnalytics() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <QzPage width="wide">
      <TitleBar title="Analytics" />
      <AnalyticsHomeView
        data={data}
        quizHref={(id) => `/app/quizzes/${id}/studio`}
        analyticsHref={(id) => `/app/quizzes/${id}/analytics`}
        createHref="/app/quizzes"
        exportBase={null}
      />
    </QzPage>
  );
}
