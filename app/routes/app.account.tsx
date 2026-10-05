import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadAccountForShop, runAccountIntentForShop } from "../lib/billing/account.server";
import { AccountScreen } from "../components/studio/account/AccountScreen";
import { AccountNotReady } from "../components/studio/account/AccountNotReady";
import { APP_ACCOUNT_PATHS } from "../components/studio/account/paths";
import { QzToastProvider } from "../components/qz-toast";

// The embedded (Shopify admin) Account: the same page as the standalone
// /studio/account (docs/design/settings/billing/BILLING-HANDOFF.md) through
// the shared <AccountScreen> + loadAccountForShop. The shop comes from the
// Shopify session, never from the request. The action runs the bill-email
// intents only; plan and credit changes live on /app/account/plan.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  // Null only before the first catalog sync creates the Shop row (app._index).
  return json({ account: shop ? await loadAccountForShop(shop) : null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) {
    return json({ ok: false as const, status: 404 as const, message: "This store isn't set up yet." }, { status: 404 });
  }
  const result = await runAccountIntentForShop(shop, await request.formData());
  return json(result, { status: result.ok ? 200 : result.status });
};

export default function AppAccount() {
  const { account } = useLoaderData<typeof loader>();
  return (
    // The /app layout has no toast host; Account says its results in toasts.
    <QzToastProvider>
      <TitleBar title="Account" />
      {account ? <AccountScreen data={account} paths={APP_ACCOUNT_PATHS} /> : <AccountNotReady title="Account" />}
    </QzToastProvider>
  );
}
