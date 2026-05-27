import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Handles products/create, products/update, products/delete. Webhook payloads
// from the Shopify REST format are slim; we map the most useful fields into our
// normalized Product row. For a delete topic, we remove the row.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: shop },
  });
  if (!shopRecord) return new Response();

  const productGid = `gid://shopify/Product/${(payload as { id: number | string }).id}`;

  if (topic === "PRODUCTS_DELETE") {
    await prisma.product.deleteMany({ where: { productId: productGid } });
    return new Response();
  }

  // Shape per https://shopify.dev/docs/api/admin-rest/2024-10/resources/product
  const p = payload as {
    id: number | string;
    title?: string;
    handle?: string;
    vendor?: string;
    product_type?: string;
    status?: string;
    tags?: string;
    image?: { src?: string };
    variants?: Array<{
      id: number | string;
      title?: string;
      price?: string;
      sku?: string;
      inventory_quantity?: number;
    }>;
  };
  const tags =
    typeof p.tags === "string"
      ? p.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
  const variants = (p.variants ?? []).map((v) => ({
    id: `gid://shopify/ProductVariant/${v.id}`,
    title: v.title ?? null,
    sku: v.sku ?? null,
    price: v.price ?? null,
    inventoryQuantity: v.inventory_quantity ?? null,
  }));
  const prices = (p.variants ?? [])
    .map((v) => (v.price ? Number(v.price) : null))
    .filter((x): x is number => x !== null);
  const priceMin = prices.length ? Math.min(...prices).toString() : null;
  const priceMax = prices.length ? Math.max(...prices).toString() : null;

  await prisma.product.upsert({
    where: { productId: productGid },
    update: {
      shopId: shopRecord.id,
      title: p.title ?? "",
      handle: p.handle ?? "",
      vendor: p.vendor ?? null,
      productType: p.product_type ?? null,
      status: p.status ?? null,
      tags,
      variants: variants as never,
      imageUrl: p.image?.src ?? null,
      priceMin,
      priceMax,
    },
    create: {
      productId: productGid,
      shopId: shopRecord.id,
      title: p.title ?? "",
      handle: p.handle ?? "",
      vendor: p.vendor ?? null,
      productType: p.product_type ?? null,
      status: p.status ?? null,
      tags,
      collectionIds: [],
      variants: variants as never,
      metafields: {},
      imageUrl: p.image?.src ?? null,
      priceMin,
      priceMax,
    },
  });

  return new Response();
};
