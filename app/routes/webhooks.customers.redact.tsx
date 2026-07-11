import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import { redactCustomer } from "../lib/gdpr.server";

// X6 (§N) — mandatory Shopify compliance webhook. Erase a shopper's PII across
// this shop. HMAC verified by authenticate.webhook().
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const p = payload as { customer?: { email?: string | null } };
  const email = p.customer?.email?.trim();
  const result = email ? await redactCustomer(prisma, shop, email) : { captures: 0, backInStock: 0 };
  logFor("webhook").info({ topic, shop, ...result }, "customers/redact processed");
  return new Response();
};
