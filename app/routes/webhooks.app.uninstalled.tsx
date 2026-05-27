import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }
  // Cascade deletes products/collections/quizzes via Shop relation.
  await prisma.shop.deleteMany({ where: { shopDomain: shop } });

  return new Response();
};
