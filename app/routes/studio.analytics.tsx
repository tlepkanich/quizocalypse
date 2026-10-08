import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { shopAnalyticsForShop, handleInsightDismissForm } from "../lib/quizAnalytics.server";
import { QzPage } from "../components/qz";
import { AnalyticsHomeView } from "../components/analytics/AnalyticsHomeView";
import analyticsStyles from "../styles/analytics.css?url";

// ANALYTICS P0 (spec Screen 1) — the all-quiz Analytics home. The per-quiz
// card stack (three charts per quiz, drawn even for drafts) is replaced by one
// comparison table over the shared server seam. All metric math lives in
// quizAnalyticsForShop/shopAnalyticsForShop — never here (no-fork rule).
// The analytics page's own stylesheet (generated from the mock), loaded here
// rather than on every admin page.
export const links: LinksFunction = () => [{ rel: "stylesheet", href: analyticsStyles }];

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
      {/* The Crest surface (.qz-crest, owner 2026-10-05): print ground, one
          centred column, every block a card — the same as Integrations and
          Settings, but wide: the eight-column table needs 1108px. The
          embedded /app renders this view without the wrapper. */}
      <div className="qz-crest is-wide">
        <AnalyticsHomeView
          data={data}
          quizHref={(id) => `/studio/${id}`}
          analyticsHref={(id) => `/studio/${id}/analytics`}
          createHref="/studio/onboarding"
          exportBase="/studio/customers/export"
        />
      </div>
    </QzPage>
  );
}
