import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { contactsResource } from "../lib/contactsRoute.server";

// The embedded twin of /studio/:id/analytics/contacts — same shared handler.
// Called with App Bridge's authenticated fetch (session token), so the
// download is fetched and saved by the page rather than opened as a link.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!params.id) throw new Response("Missing quiz id", { status: 400 });
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop }, select: { id: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  return contactsResource(shop, params.id, request);
};
