import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { loadCustomerContacts, contactsToCsv } from "../lib/customerHub.server";

// §R-8 — CSV export for a Customers segment. A resource route (no component) so
// returning a raw CSV Response never tries to render a UI (which crashed when
// the hub route did it inline).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const segment = new URL(request.url).searchParams.get("segment") ?? "all";
  const contacts = await loadCustomerContacts(shop.id);
  const csv = contactsToCsv(contacts, segment);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${segment}.csv"`,
    },
  });
};
