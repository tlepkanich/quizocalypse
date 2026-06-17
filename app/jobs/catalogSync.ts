import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";

// Shopify bulk operation runner: kicks off a bulk products query, polls until
// done, streams the JSONL result, normalizes into our DB. Spec §3.1.

// Strip HTML tags and decode common entities to give Claude clean text
// input for tag enrichment. Hoisted to the top so it's unambiguously
// available to ingestJsonl below — function declarations hoist either
// way, but Vite HMR occasionally fails to re-bind freshly-added
// declarations that sit after their first call site.
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?(p|br|li|ul|ol|h[1-6]|div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const BULK_QUERY = `#graphql
{
  products {
    edges {
      node {
        id
        title
        handle
        vendor
        productType
        status
        tags
        descriptionHtml
        updatedAt
        featuredImage { url }
        priceRangeV2 {
          minVariantPrice { amount }
          maxVariantPrice { amount }
        }
        collections {
          edges { node { id } }
        }
        variants {
          edges {
            node {
              id
              title
              sku
              price
              inventoryQuantity
              selectedOptions { name value }
            }
          }
        }
        metafields {
          edges {
            node { id namespace key value type }
          }
        }
      }
    }
  }
}`;

const COLLECTIONS_QUERY = `#graphql
{
  collections(first: 250) {
    edges {
      node {
        id
        title
        handle
        updatedAt
      }
    }
  }
}`;

interface BulkRecord {
  id: string;
  __parentId?: string;
  // product fields (when no __parentId)
  title?: string;
  handle?: string;
  vendor?: string;
  productType?: string;
  status?: string;
  tags?: string[];
  descriptionHtml?: string;
  featuredImage?: { url: string } | null;
  priceRangeV2?: {
    minVariantPrice?: { amount: string };
    maxVariantPrice?: { amount: string };
  };
  // variant or collection or metafield fields (when __parentId present)
  price?: string;
  inventoryQuantity?: number;
  sku?: string;
  selectedOptions?: { name: string; value: string }[];
  namespace?: string;
  key?: string;
  value?: string;
  type?: string;
}

interface NormalizedProduct {
  productId: string;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  tags: string[];
  collectionIds: string[];
  variants: unknown[];
  metafields: Record<string, unknown>;
  imageUrl: string | null;
  priceMin: string | null;
  priceMax: string | null;
  descriptionHtml: string | null;
  descriptionText: string | null;
}

interface SyncResult {
  productCount: number;
  collectionCount: number;
  startedAt: Date;
  finishedAt: Date;
}

export async function syncCatalog(
  admin: AdminApiContext,
  shopDomain: string,
): Promise<SyncResult> {
  const shop = await ensureShop(shopDomain);
  return syncCatalogForShopId(admin, shop.id);
}

// Sync a Shopify catalog into a SPECIFIC shop row (by id), independent of that
// shop's own domain. The embedded install path (syncCatalog) ensures a
// domain-keyed shop then delegates here; the standalone Shopify connector
// (app/lib/shopifyConnect.server.ts) calls this directly with a token-backed
// admin client to pull a connected store's catalog into the studio.local shop.
// `storefrontDomain` (set by the connector) writes each product's storefront URL
// so the standalone "Shop now" click-through resolves to the real store.
export async function syncCatalogForShopId(
  admin: AdminApiContext,
  shopId: string,
  opts?: { storefrontDomain?: string },
): Promise<SyncResult> {
  const startedAt = new Date();
  try {
    const collectionCount = await syncCollections(admin, shopId);
    const productCount = await syncProducts(admin, shopId, opts?.storefrontDomain);

    await prisma.shop.update({
      where: { id: shopId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncError: null },
    });

    return { productCount, collectionCount, startedAt, finishedAt: new Date() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.shop.update({
      where: { id: shopId },
      data: { lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: message.slice(0, 500) },
    });
    throw err;
  }
}

export async function ensureShop(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    update: {},
    create: { shopDomain },
  });
}

async function syncCollections(
  admin: AdminApiContext,
  shopId: string,
): Promise<number> {
  const res = await admin.graphql(COLLECTIONS_QUERY);
  const body = (await res.json()) as {
    data?: {
      collections?: { edges?: { node: { id: string; title: string; handle?: string } }[] };
    };
  };
  const edges = body.data?.collections?.edges ?? [];
  let count = 0;
  for (const edge of edges) {
    const node = edge.node;
    await prisma.collection.upsert({
      where: { collectionId: node.id },
      update: {
        title: node.title,
        handle: node.handle ?? null,
        shopId,
      },
      create: {
        collectionId: node.id,
        shopId,
        title: node.title,
        handle: node.handle ?? null,
        productIds: [],
      },
    });
    count++;
  }
  return count;
}

async function syncProducts(
  admin: AdminApiContext,
  shopId: string,
  storefrontDomain?: string,
): Promise<number> {
  const bulkOp = await startBulk(admin, BULK_QUERY);
  const url = await waitForBulk(admin, bulkOp.id);
  if (!url) {
    // Empty catalog — Shopify returns null url when no data was produced.
    return 0;
  }
  return ingestJsonl(url, shopId, storefrontDomain);
}

interface BulkOperationStatus {
  id: string;
  status: string;
  errorCode?: string | null;
  url?: string | null;
}

async function startBulk(
  admin: AdminApiContext,
  query: string,
): Promise<BulkOperationStatus> {
  const mutation = `#graphql
    mutation Run($q: String!) {
      bulkOperationRunQuery(query: $q) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`;
  const res = await admin.graphql(mutation, { variables: { q: query } });
  const body = (await res.json()) as {
    data?: {
      bulkOperationRunQuery?: {
        bulkOperation?: BulkOperationStatus;
        userErrors?: { field: string[]; message: string }[];
      };
    };
  };
  const errors = body.data?.bulkOperationRunQuery?.userErrors ?? [];
  if (errors.length) {
    throw new Error(
      `Bulk op user errors: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
  const op = body.data?.bulkOperationRunQuery?.bulkOperation;
  if (!op) throw new Error("Bulk op did not return a bulkOperation");
  return op;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function waitForBulk(
  admin: AdminApiContext,
  _bulkId: string,
): Promise<string | null> {
  const query = `#graphql
    { currentBulkOperation { id status errorCode url objectCount } }`;
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await admin.graphql(query);
    const body = (await res.json()) as {
      data?: { currentBulkOperation?: BulkOperationStatus };
    };
    const op = body.data?.currentBulkOperation;
    if (!op) throw new Error("currentBulkOperation returned null");
    if (op.status === "COMPLETED") return op.url ?? null;
    if (op.status === "FAILED" || op.status === "CANCELED") {
      throw new Error(`Bulk op ${op.status}: ${op.errorCode ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Bulk op timed out after 5 minutes.");
}

async function ingestJsonl(
  url: string,
  shopId: string,
  storefrontDomain?: string,
): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch JSONL: ${res.status}`);
  const text = await res.text();

  // Accumulate records keyed by product GID; child records (variants, metafields,
  // collection edges) carry __parentId pointing at the product.
  const products = new Map<string, NormalizedProduct>();

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as BulkRecord;

    if (!rec.__parentId) {
      // top-level product
      const descHtml = rec.descriptionHtml ?? null;
      products.set(rec.id, {
        productId: rec.id,
        title: rec.title ?? "",
        handle: rec.handle ?? "",
        vendor: rec.vendor ?? null,
        productType: rec.productType ?? null,
        status: rec.status ?? null,
        tags: rec.tags ?? [],
        collectionIds: [],
        variants: [],
        metafields: {},
        imageUrl: rec.featuredImage?.url ?? null,
        priceMin: rec.priceRangeV2?.minVariantPrice?.amount ?? null,
        priceMax: rec.priceRangeV2?.maxVariantPrice?.amount ?? null,
        descriptionHtml: descHtml,
        descriptionText: descHtml ? stripHtml(descHtml) : null,
      });
      continue;
    }

    const parent = products.get(rec.__parentId);
    if (!parent) continue;
    if (!rec.id) continue;

    if (rec.id.startsWith("gid://shopify/Collection/")) {
      parent.collectionIds.push(rec.id);
    } else if (rec.id.startsWith("gid://shopify/ProductVariant/")) {
      parent.variants.push({
        id: rec.id,
        title: rec.title ?? null,
        sku: rec.sku ?? null,
        price: rec.price ?? null,
        inventoryQuantity: rec.inventoryQuantity ?? null,
        options: rec.selectedOptions ?? [],
      });
    } else if (rec.id.startsWith("gid://shopify/Metafield/")) {
      const ns = rec.namespace ?? "default";
      const key = rec.key ?? "";
      parent.metafields[`${ns}.${key}`] = {
        value: rec.value,
        type: rec.type,
      };
    }
  }

  for (const p of products.values()) {
    // Standalone connector: write the real storefront URL so the "Shop now"
    // click-through resolves (the standalone runtime has no Shopify cart
    // permalink). Embedded sync passes no domain → url stays null (embedded
    // products build a cart permalink from the variant GID instead).
    const storefrontUrl =
      storefrontDomain && p.handle ? `https://${storefrontDomain}/products/${p.handle}` : null;
    await prisma.product.upsert({
      where: { productId: p.productId },
      update: {
        shopId,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        status: p.status,
        tags: p.tags,
        collectionIds: p.collectionIds,
        variants: p.variants as never,
        metafields: p.metafields as never,
        imageUrl: p.imageUrl,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        descriptionHtml: p.descriptionHtml,
        descriptionText: p.descriptionText,
        url: storefrontUrl,
      },
      create: {
        productId: p.productId,
        shopId,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        status: p.status,
        tags: p.tags,
        collectionIds: p.collectionIds,
        variants: p.variants as never,
        metafields: p.metafields as never,
        imageUrl: p.imageUrl,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        descriptionHtml: p.descriptionHtml,
        descriptionText: p.descriptionText,
        url: storefrontUrl,
      },
    });
  }

  return products.size;
}
