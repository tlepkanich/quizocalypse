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

// ── Generation-scope hygiene ─────────────────────────────────────────────────

// Merchant-curated rows beat AI-discovery leftovers. `source: "ai"` rows come
// only from whole-catalog archetype discovery (bucketDiscovery.server.ts) and
// the bucket browser cannot display them — so when a quiz carries BOTH ai rows
// and curated rows (browser picks, wizard grouping, manual groups, logic-tab
// targets), the ai rows are invisible dead weight that would silently widen the
// generation scope back to the full catalog. Drop them. A pure-discovery quiz
// (ai rows only) keeps them: they ARE its grounding.
export function curatedBucketRows<T extends { source: string | null }>(rows: T[]): T[] {
  const curated = rows.filter((r) => r.source !== "ai");
  return curated.length > 0 ? curated : rows;
}

// Order-insensitive id-set equality (product ids are unique within a row).
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const id of setB) if (!setA.has(id)) return false;
  return true;
}

export interface RefreshableBucketRow {
  id: string;
  source: string | null;
  sourceRef: string | null;
  tags: string[];
  productIds: string[];
}

// Re-resolve collection/tag-sourced rows against the LIVE catalog. Bucket rows
// snapshot productIds at selection time and go stale when the catalog resyncs
// (a reseeded store once left every pre-sync quiz grounded in products that no
// longer belonged to its collections). Returns only rows whose membership
// actually changed. product/manual/ai rows have no external source of truth and
// are never touched; a sourceRef that no longer resolves (deleted collection,
// vanished tag) keeps its snapshot — a stale scope beats an empty one.
export function computeBucketMembershipRefresh(
  rows: RefreshableBucketRow[],
  products: GroupingProduct[],
  collections: GroupingCollection[],
): Array<{ id: string; productIds: string[]; tags: string[] }> {
  const updates: Array<{ id: string; productIds: string[]; tags: string[] }> = [];
  for (const row of rows) {
    if (!row.sourceRef) continue;
    const source =
      row.source === "smart_collection" || row.source === "collection"
        ? ("collection" as const)
        : row.source === "tag"
          ? ("tag" as const)
          : null;
    if (!source) continue;
    const [group] = resolveGroupsBySource(source, products, collections, {
      sourceRef: row.sourceRef,
    });
    if (!group || group.productIds.length === 0) continue;
    if (sameIdSet(group.productIds, row.productIds) && sameIdSet(group.tags, row.tags)) continue;
    updates.push({ id: row.id, productIds: group.productIds, tags: group.tags });
  }
  return updates;
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
