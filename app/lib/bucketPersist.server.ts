// BIC-2 C3b — bucket persistence helpers: the catalog→bucket-resolution input
// loader shared by the loader payload and the continuous-save bucket intents
// (membership is always re-resolved server-side; the client never sends
// product ids). Split out of step1Funnel.server.ts as a pure move.
import prisma from "../db.server";
import {
  hydrateCollectionProducts,
  type GroupingProduct,
  type GroupingCollection,
} from "./categoryGrouping";

export const toGroupingProduct = (p: {
  productId: string;
  title: string;
  tags: string[];
  productType: string | null;
  collectionIds: string[];
}): GroupingProduct => ({
  productId: p.productId,
  title: p.title,
  tags: p.tags,
  productType: p.productType,
  collectionIds: p.collectionIds,
});

// Load the catalog as bucket-resolution inputs (products + hydrated collections
// + title lookups). Used by the continuous-save bucket intents to re-resolve
// membership server-side — the client never sends product ids.
export async function loadBucketInputs(shopId: string): Promise<{
  products: GroupingProduct[];
  collections: GroupingCollection[];
  productTitleById: Map<string, string>;
  collectionTitleById: Map<string, string>;
}> {
  const [productRows, collectionRows] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId }, select: { collectionId: true, title: true } }),
  ]);
  const products = productRows.map(toGroupingProduct);
  return {
    products,
    collections: hydrateCollectionProducts(collectionRows, products),
    productTitleById: new Map(productRows.map((p) => [p.productId, p.title])),
    collectionTitleById: new Map(collectionRows.map((c) => [c.collectionId, c.title])),
  };
}
