import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { quizAnalyticsForShop } from "../lib/quizAnalytics.server";
import { QzPage } from "../components/qz";
import { QuizAnalyticsView } from "../components/analytics/QuizAnalyticsView";

// ANALYTICS P0 — the embedded twin of /studio/:id/analytics. Both surfaces
// call the SAME server seam and mount the SAME view, so they can never drift
// again (the previous hand-copied loaders already had — W12: two capture
// counts for one quiz). No contacts export here yet: the studio resource route
// is studio-authed, and an embedded twin lands with the P1 export work.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, source: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const url = new URL(request.url);
  return json({ data: await quizAnalyticsForShop(shop, id, url.searchParams) });
};

export default function QuizAnalytics() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <QzPage width="wide">
      <TitleBar title="Analytics" />
      <QuizAnalyticsView data={data} surface="app" exportBase={null} />
    </QzPage>
  );
}
