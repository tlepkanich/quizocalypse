import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { QzPage, QzPageHeader } from "../components/qz";
import { KlaviyoConnectionCard } from "../components/KlaviyoConnectionCard";
import { handleKlaviyoForm, klaviyoStatus } from "../lib/klaviyo.server";

// Analytics handoff §8 — the embedded twin of /studio/integrations' Klaviyo
// connection (one per shop). "Connect Klaviyo" in the analytics contacts panel
// lands here. Same shared card and form handler as the standalone page.
async function shopFor(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, select: { id: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  return shop;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await shopFor(request);
  const result = await handleKlaviyoForm(shop.id, await request.formData());
  if (!result) return json({ ok: false, error: "unknown intent" }, { status: 400 });
  return json(result, { status: result.ok ? 200 : 400 });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await shopFor(request);
  return json({ klaviyo: await klaviyoStatus(shop.id) });
};

export default function AppIntegrations() {
  const { klaviyo } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <TitleBar title="Integrations" />
      <div className="qz-crest">
        <QzPageHeader title="Integrations" />
        <KlaviyoConnectionCard status={klaviyo} />
      </div>
    </QzPage>
  );
}
