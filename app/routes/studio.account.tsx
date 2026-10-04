import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { loadAccountForShop, runAccountIntentForShop } from "../lib/billing/account.server";
import { AccountScreen } from "../components/studio/account/AccountScreen";

// Account — the rail's footer item: your plan and next bill, credits, bill
// emails, past bills (docs/design/settings/billing/BILLING-HANDOFF.md).
// The action runs the bill-email intents only; plan and credit changes live
// on /studio/account/plan.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return json(await loadAccountForShop(shop));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const result = await runAccountIntentForShop(shop, await request.formData());
  return json(result, { status: result.ok ? 200 : result.status });
};

export default function StudioAccount() {
  const data = useLoaderData<typeof loader>();
  return <AccountScreen data={data} />;
}
