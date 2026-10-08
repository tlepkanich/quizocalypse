import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, type ShouldRevalidateFunction } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { quizAnalyticsForShop, handleInsightDismissForm } from "../lib/quizAnalytics.server";
import { QzPage } from "../components/qz";
import { QuizAnalyticsView } from "../components/analytics/QuizAnalyticsView";
import analyticsStyles from "../styles/analytics.css?url";
import { onlyViewParamsChanged } from "../components/analytics/an/chrome";

// ANALYTICS P0 — the embedded twin of /studio/:id/analytics. Both surfaces
// call the SAME server seam and mount the SAME view, so they can never drift
// again (the previous hand-copied loaders already had — W12: two capture
// counts for one quiz). Contacts, exports and Klaviyo segments go through the
// embedded twin of the contacts route (app.quizzes.$id_.analytics_.contacts).
// The analytics page's own stylesheet (generated from the mock), loaded here
// rather than on every admin page.
export const links: LinksFunction = () => [{ rel: "stylesheet", href: analyticsStyles }];

// Switching tabs (?s=) or an insight's filter (?pf=, ?cohort=) only changes
// what is on screen: don't recount. A range or Compare change does.
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }) =>
  !formMethod && onlyViewParamsChanged(currentUrl, nextUrl) ? false : defaultShouldRevalidate;

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

// Dismiss / restore a "What to fix" card (14-day snooze) — the embedded twin
// of the studio action, over the same shared writer.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, select: { id: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const result = await handleInsightDismissForm(shop.id, await request.formData());
  return json(result ?? { ok: false }, { status: result?.ok ? 200 : 400 });
};

export default function QuizAnalytics() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <QzPage width="wide">
      <TitleBar title="Analytics" />
      {/* The Crest surface (.qz-crest, owner 2026-10-05) — the same wrapper
          as /studio/:id/analytics. */}
      <div className="qz-crest is-wide">
        <QuizAnalyticsView data={data} surface="app" exportBase={null} />
      </div>
    </QzPage>
  );
}
