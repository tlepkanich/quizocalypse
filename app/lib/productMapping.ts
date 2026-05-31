import type { Quiz as QuizDoc } from "./quizSchema";
import type { IndexedProduct } from "./recommendationEngine";

// ───────────────────────────────────────────────────────────────────────────
// Product Mapping (FOCUS #2, HALF 2) — the data behind the Logic tab's
// "working backwards from the rec page" table.
//
// A result page that is bound to a bucket (`data.category_id`) becomes a COLUMN.
// Every catalog product is a ROW. A cell is checked when the product belongs to
// that column's bucket (the bucket's `productIds`). This is a pure view over
// `categories[].productIds` joined to the bound result nodes — the same data the
// `category` ladder strategy resolves at runtime — so it never disagrees with
// what shoppers actually see.
//
// Editing happens on a working copy of the buckets' member lists (a
// `Record<categoryId, productIds[]>`); `toggleMembership` and `diffMembers` are
// pure so the table can stay client-driven and only persist the delta.
// ───────────────────────────────────────────────────────────────────────────

export interface MappingCategory {
  id: string;
  name: string;
  productIds: string[];
}

// One column = a result page bound to a bucket.
export interface MappingColumn {
  nodeId: string; // result node id
  categoryId: string; // bound bucket id
  label: string; // headline, falling back to the bucket name
  bucketName: string;
  productCount: number; // members in the bound bucket
}

export interface MappingRow {
  productId: string;
  title: string;
  imageUrl: string | null;
  // Bound-bucket ids (among the columns) this product currently belongs to.
  categoryIds: string[];
  mappedCount: number; // === categoryIds.length, for quick flagging
}

export interface MappingMatrix {
  columns: MappingColumn[];
  rows: MappingRow[];
  // Products in zero columns' buckets — they never surface as a "category"
  // recommendation for any page.
  unmappedProductIds: string[];
  // Products in more than one column's bucket — they can show on multiple pages.
  multiMappedProductIds: string[];
}

// Minimal shape we read off a result node. Kept loose so callers can pass the
// full QuizDoc nodes without massaging types.
type ResultNodeLike = {
  id: string;
  type: string;
  data: { headline?: string; category_id?: string };
};

/**
 * Build the product→result-page matrix from the catalog index, the (working)
 * bucket member lists, and the quiz's result nodes.
 *
 * Only result nodes bound to an existing bucket become columns; tag/collection
 * pages without a `category_id` have no fixed membership and are omitted (the
 * table is about explicit bucket membership).
 */
export function buildMappingMatrix(
  productIndex: IndexedProduct[],
  categories: MappingCategory[],
  resultNodes: QuizDoc["nodes"],
): MappingMatrix {
  const catById = new Map(categories.map((c) => [c.id, c]));

  const columns: MappingColumn[] = [];
  // categoryId → Set(productId) for fast cell lookup, scoped to bound buckets.
  const memberSetByCat = new Map<string, Set<string>>();

  for (const node of resultNodes) {
    const n = node as unknown as ResultNodeLike;
    if (n.type !== "result") continue;
    const categoryId = n.data.category_id;
    if (!categoryId) continue;
    const cat = catById.get(categoryId);
    if (!cat) continue; // bound to a bucket that no longer exists — skip
    // A bucket can technically back more than one page; each bound page is its
    // own column but shares the bucket's membership set.
    if (!memberSetByCat.has(categoryId)) {
      memberSetByCat.set(categoryId, new Set(cat.productIds));
    }
    columns.push({
      nodeId: n.id,
      categoryId,
      label: n.data.headline?.trim() || cat.name,
      bucketName: cat.name,
      productCount: cat.productIds.length,
    });
  }

  const rows: MappingRow[] = [];
  const unmappedProductIds: string[] = [];
  const multiMappedProductIds: string[] = [];

  for (const product of productIndex) {
    const memberOf: string[] = [];
    for (const [categoryId, members] of memberSetByCat) {
      if (members.has(product.product_id)) memberOf.push(categoryId);
    }
    rows.push({
      productId: product.product_id,
      title: product.title,
      imageUrl: product.image_url,
      categoryIds: memberOf,
      mappedCount: memberOf.length,
    });
    if (memberOf.length === 0) unmappedProductIds.push(product.product_id);
    else if (memberOf.length > 1) multiMappedProductIds.push(product.product_id);
  }

  return { columns, rows, unmappedProductIds, multiMappedProductIds };
}

/**
 * Toggle a product's membership in a bucket on a working member map
 * (`categoryId → productIds[]`). Pure — returns a new map. Adds the product if
 * absent, removes it if present.
 */
export function toggleMembership(
  members: Record<string, string[]>,
  categoryId: string,
  productId: string,
): Record<string, string[]> {
  const current = members[categoryId] ?? [];
  const has = current.includes(productId);
  const next = has
    ? current.filter((p) => p !== productId)
    : [...current, productId];
  return { ...members, [categoryId]: next };
}

/**
 * Seed a working member map from the loaded buckets.
 */
export function membersFromCategories(
  categories: MappingCategory[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of categories) out[c.id] = [...c.productIds];
  return out;
}

/**
 * Compute the changed buckets between the originals and the working map, as the
 * `{ [categoryId]: productIds[] }` payload the set-members endpoint expects.
 * Order-insensitive membership comparison so re-saving an unchanged set is a
 * no-op. Only categories present in `members` are considered.
 */
export function diffMembers(
  original: MappingCategory[],
  members: Record<string, string[]>,
): Record<string, string[]> {
  const origById = new Map(original.map((c) => [c.id, new Set(c.productIds)]));
  const changed: Record<string, string[]> = {};
  for (const [categoryId, ids] of Object.entries(members)) {
    const before = origById.get(categoryId);
    const after = new Set(ids);
    if (!before || !sameSet(before, after)) {
      changed[categoryId] = [...new Set(ids)];
    }
  }
  return changed;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
