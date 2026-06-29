import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: shop },
  });
  if (!shopRecord) return new Response();

  const c = payload as {
    id: number | string;
    title?: string;
    handle?: string;
  };
  const collectionGid = `gid://shopify/Collection/${c.id}`;

  // HII-2 — guard the upsert: a failed write 500s so Shopify REDELIVERS the
  // (idempotent) upsert rather than acking 200 with a stale collection row.
  // authenticate.webhook above already validated HMAC, so we never 500 an
  // unauthenticated request.
  try {
    await prisma.collection.upsert({
      where: { collectionId: collectionGid },
      update: {
        title: c.title ?? "",
        handle: c.handle ?? null,
        shopId: shopRecord.id,
      },
      create: {
        collectionId: collectionGid,
        shopId: shopRecord.id,
        title: c.title ?? "",
        handle: c.handle ?? null,
        productIds: [],
      },
    });
  } catch (err) {
    console.error(`[webhook] ${topic} upsert failed:`, err instanceof Error ? err.message : err);
    return new Response(null, { status: 500 });
  }

  return new Response();
};
