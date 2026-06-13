import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadStep1FunnelData, runStep1FunnelAction } from "../lib/step1Funnel.server";
import { Step1Funnel } from "../components/onboarding/Step1Funnel";

// Builder Re-work Step 1 — the EMBEDDED (Shopify-admin) funnel twin. Same shared
// shop-scoped loader/action as the studio funnel; only the auth + the pick
// hand-off URL differ (embedded → /app/quizzes/:id/studio). Renders the same
// server-free <Step1Funnel> component verbatim.

async function embeddedShop(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, shopDomain: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  return shop;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const shop = await embeddedShop(request);
  return json(await loadStep1FunnelData(shop, params.quizId));
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const shop = await embeddedShop(request);
  return runStep1FunnelAction(shop, params.quizId, request, {
    builderPath: (quizId) => `/app/quizzes/${quizId}/studio?mode=ai`,
  });
};

export default function AppOnboardingFunnel() {
  const data = useLoaderData<typeof loader>();
  return (
    <>
      <TitleBar title="Set up your quiz" />
      <Step1Funnel data={data} />
    </>
  );
}
