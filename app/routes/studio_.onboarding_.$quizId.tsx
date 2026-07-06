import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { adminStyleLinks } from "../styles/adminLinks";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { loadStep1FunnelData, runStep1FunnelAction } from "../lib/step1Funnel.server";
import { Step1Funnel } from "../components/onboarding/Step1Funnel";
import { QzToastProvider } from "../components/qz-toast";

// BIC-2 B1 — de-nested route (studio_ prefix escapes the studio.tsx layout),
// so it must link the admin sheet itself.
export const links: LinksFunction = () => adminStyleLinks;

// Builder Re-work Step 1 — the studio (cookie-auth) funnel. A thin wrapper over
// the shared shop-scoped loader/action in step1Funnel.server.ts; the embedded
// twin (app.onboarding_.$quizId) wraps the same logic with Shopify admin auth.
// DS-3 (design-system-V2 §7.7): the leading `studio_` in the route id escapes
// the sidebar shell — the nav rail is ABSENT inside the creation flow; the
// sticky top bar's step pills own navigation there.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return json(await loadStep1FunnelData(shop, params.quizId));
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return runStep1FunnelAction(shop, params.quizId, request, {
    builderPath: (quizId) => `/studio/${quizId}?mode=ai`,
  });
};

export default function StudioOnboardingFunnel() {
  const data = useLoaderData<typeof loader>();
  return (
    <QzToastProvider>
      <Step1Funnel data={data} />
    </QzToastProvider>
  );
}
