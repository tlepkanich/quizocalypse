import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import { redactShop } from "../lib/gdpr.server";

// X6 (§N) — mandatory Shopify compliance webhook. Full erasure of a shop's data
// (~48h after uninstall). Idempotent — the shop is often already gone (the
// app/uninstalled handler deletes it), so this is usually a no-op.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const result = await redactShop(prisma, shop);
  logFor("webhook").info({ topic, shop, shopRows: result.shop }, "shop/redact processed");
  return new Response();
};
