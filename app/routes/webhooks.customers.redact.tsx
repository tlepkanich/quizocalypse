import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import { redactCustomer, redactOrders } from "../lib/gdpr.server";

// X6 (§N) — mandatory Shopify compliance webhook. Erase a shopper's PII across
// this shop. HMAC verified by authenticate.webhook().
//
// The payload carries TWO independent erasure instructions and both are
// obligations:
//   • customer.email      → every email-keyed store (redactCustomer)
//   • orders_to_redact[]  → everything held about those orders (redactOrders)
//
// They are handled separately on purpose. `orders_to_redact` can arrive for a
// customer with NO email on file, and the previous version bailed out entirely
// in that case — so the order half was never honoured at all. Neither half may
// be conditional on the other.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const p = payload as {
    customer?: { email?: string | null };
    orders_to_redact?: Array<string | number> | null;
  };

  const email = p.customer?.email?.trim();
  const orderIds = Array.isArray(p.orders_to_redact) ? p.orders_to_redact : [];

  const customerResult = email
    ? await redactCustomer(prisma, shop, email)
    : { captures: 0, backInStock: 0, rewards: 0, referrals: 0 };
  const orderResult = await redactOrders(prisma, shop, orderIds);

  logFor("webhook").info(
    {
      topic,
      shop,
      ...customerResult,
      ...orderResult,
      // Counts only — never the email or the order ids themselves.
      hadEmail: Boolean(email),
      ordersRequested: orderIds.length,
    },
    "customers/redact processed",
  );
  return new Response();
};
