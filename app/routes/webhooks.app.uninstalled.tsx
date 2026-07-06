import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  logFor("webhook").info({ topic, shop }, "received");

  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }
  // Cascade deletes products/collections/quizzes via Shop relation.
  await prisma.shop.deleteMany({ where: { shopDomain: shop } });

  return new Response();
};
