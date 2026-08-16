import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { shopAnalyticsForShop, handleInsightDismissForm } from "../lib/quizAnalytics.server";
import { QzPage } from "../components/qz";
import { AnalyticsHomeView } from "../components/analytics/AnalyticsHomeView";

// ANALYTICS P0 (spec Screen 1) — the all-quiz Analytics home. The per-quiz
// card stack (three charts per quiz, drawn even for drafts) is replaced by one
// comparison table over the shared server seam. All metric math lives in
// quizAnalyticsForShop/shopAnalyticsForShop — never here (no-fork rule).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const url = new URL(request.url);
  return json({ data: await shopAnalyticsForShop(shop, url.searchParams) });
};

// Dismiss / restore a "What to fix" card (14-day snooze). Auth first, then the
// SHARED writer — the ownership re-check lives there, so neither surface can
// grow its own version of it.
export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const result = await handleInsightDismissForm(shop.id, await request.formData());
  return json(result ?? { ok: false }, { status: result?.ok ? 200 : 400 });
};

export default function StudioAnalytics() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <QzPage width="wide">
      <AnalyticsHomeView
        data={data}
        quizHref={(id) => `/studio/${id}`}
        analyticsHref={(id) => `/studio/${id}/analytics`}
        createHref="/studio/onboarding"
        exportBase="/studio/customers/export"
      />
    </QzPage>
  );
}
