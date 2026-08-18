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
import { curatedBucketRows, computeBucketMembershipRefresh } from "./bucketPersist";
import { reportError } from "./log.server";

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

// The ONE read every generation-facing consumer uses for a quiz's buckets
// (confirm intents, type/template prompts, the question build's scope, the
// speculative chain). Applies curatedBucketRows so invisible ai-discovery
// leftovers can never widen the scope once the merchant has curated their own
// rows. The superset select stays cheap (rows are few) and type-compatible
// with every caller's narrower need.
export interface GenerationBucketRow {
  id: string;
  name: string;
  tags: string[];
  productIds: string[];
  source: string;
}

export async function loadGenerationBuckets(
  shopId: string,
  quizId: string,
): Promise<GenerationBucketRow[]> {
  const rows = await prisma.category.findMany({
    where: { shopId, quizId },
    select: { id: true, name: true, tags: true, productIds: true, source: true },
    orderBy: { createdAt: "asc" },
  });
  return curatedBucketRows(rows);
}

// Build-time membership refresh: re-resolve this quiz's collection/tag-sourced
// rows against the live catalog and persist any drift (the pure diff lives in
// bucketPersist.ts). Best-effort by design — a failure (e.g. a row deleted by a
// concurrent browser toggle) must never abort a generation chain; the build
// then proceeds on the stored snapshot, which is exactly today's behavior.
export async function refreshBucketMembership(shopId: string, quizId: string): Promise<void> {
  try {
    const rows = await prisma.category.findMany({
      where: { shopId, quizId, source: { in: ["collection", "smart_collection", "tag"] } },
      select: { id: true, source: true, sourceRef: true, tags: true, productIds: true },
    });
    if (rows.length === 0) return;
    const inputs = await loadBucketInputs(shopId);
    const updates = computeBucketMembershipRefresh(rows, inputs.products, inputs.collections);
    if (updates.length === 0) return;
    await prisma.$transaction(
      updates.map((u) =>
        prisma.category.update({
          where: { id: u.id },
          data: { productIds: u.productIds, tags: u.tags },
        }),
      ),
    );
  } catch (err) {
    reportError(err, { scope: "bucketPersist", msg: "bucket membership refresh failed", shopId, quizId });
  }
}
