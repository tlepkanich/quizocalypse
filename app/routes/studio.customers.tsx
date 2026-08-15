import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStudioAccess } from "../lib/studioAccess.server";

// ANALYTICS P0 (owner decision 2026-08-14) — the Customer Engagement tab is
// retired; its pieces moved into Analytics. Contacts, cohort chips and the CSV
// export now live in the per-quiz Customers section (/studio/:id/analytics
// ?s=customers); the CSV resource route (studio.customers.export.tsx) stays.
// Old bookmarks land on the Analytics home rather than a 404.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  return redirect("/studio/analytics");
};
