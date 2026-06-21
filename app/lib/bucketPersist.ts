import {
  resolveGroupsBySource,
  type GroupingProduct,
  type GroupingCollection,
} from "./categoryGrouping";

// ════════════════════════════════════════════════════════════════════════════
// Recommendation-bucket resolution (RB Step 1) — the PURE half of the bucket
// browser's persistence. Given a {type, key} selection + the live catalog,
// produce the Category-row payload to store. Membership (productIds) is ALWAYS
// re-derived here from the catalog — the client only ever says WHICH key was
// toggled, never the members (the persistConfirmedGroups trust boundary). The
// IO half (add/remove/clear against Prisma) lives in step1Build.server.ts.
// ════════════════════════════════════════════════════════════════════════════

export type BucketType = "product" | "tag" | "collection";

export interface BucketRow {
  source: BucketType;
  sourceRef: string; // productId | normalized tag | collectionId
  name: string;
  tags: string[];
  productIds: string[];
}

// Resolve one {type,key} selection into a persistable row against the live
// catalog. Returns null when the key resolves to nothing (a stale product id /
// tag / collection) so the caller skips it rather than write an empty bucket.
export function bucketRowFor(
  type: BucketType,
  key: string,
  products: GroupingProduct[],
  collections: GroupingCollection[],
  productTitleById: Map<string, string>,
  collectionTitleById: Map<string, string>,
): BucketRow | null {
  if (type === "product") {
    const title = productTitleById.get(key);
    if (!title) return null;
    return { source: "product", sourceRef: key, name: title, tags: [], productIds: [key] };
  }
  const source = type === "tag" ? "tag" : "collection";
  const [group] = resolveGroupsBySource(source, products, collections, { sourceRef: key });
  if (!group || group.productIds.length === 0) return null;
  return {
    source: type,
    sourceRef: group.sourceRef ?? key,
    // Collections keep their real title; tags use the (normalized) tag the
    // resolver matched — both readable on the shelf.
    name: type === "collection" ? collectionTitleById.get(key) ?? group.name : group.name,
    tags: group.tags,
    productIds: group.productIds,
  };
}

// Resolve a batch of selections (Select-All), dropping any that don't resolve.
export function bucketRowsFor(
  selections: Array<{ type: BucketType; key: string }>,
  products: GroupingProduct[],
  collections: GroupingCollection[],
  productTitleById: Map<string, string>,
  collectionTitleById: Map<string, string>,
): BucketRow[] {
  const rows: BucketRow[] = [];
  for (const sel of selections) {
    const row = bucketRowFor(
      sel.type,
      sel.key,
      products,
      collections,
      productTitleById,
      collectionTitleById,
    );
    if (row) rows.push(row);
  }
  return rows;
}
