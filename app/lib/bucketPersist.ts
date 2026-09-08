import {
  resolveGroupsBySource,
  type GroupingProduct,
  type GroupingCollection,
} from "./categoryGrouping";
import { isSellable } from "./recommendationEngine";

// ════════════════════════════════════════════════════════════════════════════
// Recommendation-bucket resolution (RB Step 1) — the PURE half of the bucket
// browser's persistence. Given a {type, key} selection + the live catalog,
// produce the Category-row payload to store. Membership (productIds) is ALWAYS
// re-derived here from the catalog — the client only ever says WHICH key was
// toggled, never the members (the persistConfirmedGroups trust boundary). The
// IO half (add/remove/clear against Prisma) lives in step1Build.server.ts.
// ════════════════════════════════════════════════════════════════════════════

// Step-1 tweaks (§02 item 5) — the FOURTH bucket type: a shop-global Category
// row the merchant built in the group wizard ("Custom" tab). Its bucket row is
// `source: "group"`, `sourceRef: <that Category id>` — NEVER the group's own
// dominantSource, or the type-scoped set-buckets delete treats it as a tag.
export type BucketType = "product" | "tag" | "collection" | "group";
export const BUCKET_TYPES: readonly BucketType[] = ["product", "tag", "collection", "group"];
export function isBucketType(x: string): x is BucketType {
  return (BUCKET_TYPES as readonly string[]).includes(x);
}

export interface BucketRow {
  source: BucketType;
  sourceRef: string; // productId | normalized tag | collectionId | group Category id
  name: string;
  tags: string[];
  productIds: string[];
}

// A shop-global group offered on the Custom tab — the resolver copies its
// stored membership into the quiz's bucket row (the same path a collection's
// members take at publish: bake through productIds).
export interface GroupSource {
  id: string;
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
  groups: readonly GroupSource[] = [],
): BucketRow | null {
  if (type === "product") {
    const title = productTitleById.get(key);
    if (!title) return null;
    return { source: "product", sourceRef: key, name: title, tags: [], productIds: [key] };
  }
  if (type === "group") {
    const group = groups.find((g) => g.id === key);
    if (!group || group.productIds.length === 0) return null;
    return {
      source: "group",
      sourceRef: group.id,
      name: group.name,
      tags: group.tags,
      productIds: group.productIds,
    };
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
  groups: readonly GroupSource[] = [],
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
      groups,
    );
    if (row) rows.push(row);
  }
  return rows;
}

// ── set-buckets leaver scope (Step-1 tweaks §02 item 3) ─────────────────────
// The bulk replace ("Apply" / its Undo / Revert) swaps ONE type's half of the
// selection. Two live data-loss bugs lived in the old "everything not wanted
// leaves" rule: (a) cross-type collateral — a single-typed `wanted` deleted the
// merchant's picks of every other type; (b) Logic-tab rule targets (rows
// stamped discoveryRunId "logic-tab-*") were leaver candidates — deleting one
// dangles every rule that points at it and hard-blocks publish. Type-scoping
// alone does not fix (b): a same-type Logic-tab target still left.
export const normBucketSource = (s: string): string =>
  s === "smart_collection" ? "collection" : s;

export interface ExistingBucketRow {
  id: string;
  source: string;
  sourceRef: string | null;
  discoveryRunId: string;
}

export function isLogicTabTarget(row: Pick<ExistingBucketRow, "discoveryRunId">): boolean {
  return row.discoveryRunId.startsWith("logic-tab-");
}

/** Rows to DELETE when the `type` half of the selection becomes `keys`. */
export function setBucketsLeaverIds(
  existing: readonly ExistingBucketRow[],
  type: BucketType,
  keys: readonly string[],
): string[] {
  const wanted = new Set(keys);
  return existing
    .filter(
      (c) =>
        normBucketSource(c.source) === type &&
        !(c.sourceRef && wanted.has(c.sourceRef)) &&
        !isLogicTabTarget(c),
    )
    .map((c) => c.id);
}

/** Keys of `type` already present (their rows keep their ids). */
export function setBucketsKeptKeys(
  existing: readonly ExistingBucketRow[],
  type: BucketType,
  keys: readonly string[],
): Set<string> {
  const wanted = new Set(keys);
  const kept = new Set<string>();
  for (const c of existing) {
    if (normBucketSource(c.source) === type && c.sourceRef && wanted.has(c.sourceRef)) {
      kept.add(c.sourceRef);
    }
  }
  return kept;
}

// ── Deliverable count (Step-1 tweaks §02 item 6, decision 8) ────────────────
// "Group of 44 products" counts every member; the runtime filters the pool
// through isSellable, which drops non-active products (on bakes that carry
// status) and anything out of stock at ≤0. So a group advertised as 44 can
// deliver 38. ONE derivation, through isSellable itself — never a status test
// alone. Rendered in the Results rail only; the picker keeps the real size.
export interface SellableProduct {
  inventory_in_stock: boolean;
  price: string | null;
  status?: string;
}

export function deliverableCount(
  productIds: readonly string[],
  sellableById: ReadonlyMap<string, SellableProduct>,
): number {
  let n = 0;
  for (const id of productIds) {
    const p = sellableById.get(id);
    if (p && isSellable(p)) n++;
  }
  return n;
}
