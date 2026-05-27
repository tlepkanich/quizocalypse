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

  return new Response();
};
