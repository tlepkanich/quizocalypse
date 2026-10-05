import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadAccountForShop } from "../lib/billing/account.server";
import { ChangePlanScreen } from "../components/studio/account/ChangePlanScreen";
import { AccountNotReady } from "../components/studio/account/AccountNotReady";
import { APP_ACCOUNT_PATHS } from "../components/studio/account/paths";
import { QzToastProvider } from "../components/qz-toast";

// The embedded (Shopify admin) Change plan: the same page as the standalone
// /studio/account/plan through the shared <ChangePlanScreen>. The trailing
// underscore keeps it out of app.account's route nesting; the URL is
// /app/account/plan. No action: Shopify billing is not connected yet, so no
// plan or credit change can be made (see account.server.ts).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  // Null only before the first catalog sync creates the Shop row (app._index).
  return json({ account: shop ? await loadAccountForShop(shop) : null });
};

export default function AppAccountPlan() {
  const { account } = useLoaderData<typeof loader>();
  return (
    // The /app layout has no toast host; Change plan says its results in toasts.
    <QzToastProvider>
      <TitleBar title="Change plan" />
      {account ? (
        <ChangePlanScreen data={account} paths={APP_ACCOUNT_PATHS} />
      ) : (
        <AccountNotReady title="Change plan" />
      )}
    </QzToastProvider>
  );
}
