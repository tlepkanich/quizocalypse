import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { loadAccountForShop } from "../lib/billing/account.server";
import { ChangePlanScreen } from "../components/studio/account/ChangePlanScreen";

// Account → Change plan: the three plans, more credits, cancel
// (docs/design/settings/billing/BILLING-HANDOFF.md). The trailing underscore
// keeps this page out of studio.account's route nesting; the URL is
// /studio/account/plan. No action: Shopify billing is not connected yet, so
// no plan or credit change can be made (see account.server.ts).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return json(await loadAccountForShop(shop));
};

export default function StudioAccountPlan() {
  const data = useLoaderData<typeof loader>();
  return <ChangePlanScreen data={data} />;
}
