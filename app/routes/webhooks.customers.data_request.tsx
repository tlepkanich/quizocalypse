import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import { collectCustomerData } from "../lib/gdpr.server";

// X6 (§N) — mandatory Shopify compliance webhook. Gather everything held for a
// shopper email so the merchant can fulfil the data-export request (the data
// also lives in the Customers surface). We acknowledge + log the collected
// record; delivery to the store owner is the merchant's fulfilment step.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const p = payload as { customer?: { email?: string | null } };
  const email = p.customer?.email?.trim();
  const data = email ? await collectCustomerData(prisma, shop, email) : { captures: [], backInStock: [] };
  logFor("webhook").info(
    { topic, shop, captures: data.captures.length, backInStock: data.backInStock.length },
    "customers/data_request collected",
  );
  return new Response();
};
