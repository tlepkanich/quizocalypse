import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { StudioBuilder } from "../components/studio/StudioBuilder";
import { AiEditWorkspace } from "../components/studio/AiEditWorkspace";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import {
  loadQuizEditorDataForShop,
  handleQuizEditorActionForShop,
} from "../lib/quizEditorIO.server";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { aggregateAllAbFunnels, type FunnelCounts } from "../lib/abAnalytics";

// Standalone builder route — the SAME StudioBuilder the embedded route renders,
// but resolved from the configured dev shop (DEV_SHOP_DOMAIN) behind the shared
// access token, with NO App Bridge. loadQuizEditorDataForShop is shop-scoped
// (where: { id, shopId: shop.id }), so a quiz from any other shop 404s — no
// cross-shop access. The action uses an OFFLINE admin client only for the one
// publish-time Shopify call (discount creation, which degrades gracefully).

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const data = await loadQuizEditorDataForShop(shop, id, new URL(request.url).origin);

  let abAnalytics: Record<string, Record<string, FunnelCounts>> = {};
  if (data.valid && data.doc) {
    const events = await prisma.event.findMany({
      where: { quizId: id },
      select: { sessionId: true, eventType: true, payload: true },
    });
    abAnalytics = aggregateAllAbFunnels(data.doc, events);
  }
  return json({ ...data, abAnalytics });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return handleQuizEditorActionForShop(shop, id, request, async () => {
    const { admin } = await unauthenticated.admin(shop.shopDomain);
    return admin;
  });
};

export default function StandaloneStudio() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  // AI-first is the default surface; ?mode=advanced opens the full builder.
  return params.get("mode") === "advanced" ? (
    <StudioBuilder data={data} chrome="standalone" />
  ) : (
    <AiEditWorkspace data={data} chrome="standalone" />
  );
}
