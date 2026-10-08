import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { contactsResource } from "../lib/contactsRoute.server";

// Contacts panel + exports for one quiz (resource route: no component). The
// `analytics_` segment de-nests it from the analytics page; all logic lives in
// the shared handler.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  if (!params.id) throw new Response("Missing quiz id", { status: 400 });
  return contactsResource(shop, params.id, request);
};
