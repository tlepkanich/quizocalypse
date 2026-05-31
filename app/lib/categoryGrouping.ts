// Deterministic (no AI) product→group resolution for the v3
// "product-first" grouping on-ramp. Given a grouping source + the shop's
// products/collections, produce proposed category groups by partitioning
// products along a chosen catalog dimension (collection, tag, product
// type, or metafield value). The discover/AI path lives elsewhere
// (categoryDiscover.ts + categoryAssign.ts) — this module is the
// deterministic counterpart that requires no Claude call.

import { normalizeTags } from "./enrichTags";

export type GroupingSource =
  | "collection"
  | "smart_collection" // same resolution as collection for our purposes (we already store productIds per collection)
  | "tag"
  | "product_type"
  | "metafield";

export interface GroupingProduct {
  productId: string;
  title: string;
  tags: string[];
  productType?: string | null;
  collectionIds: string[];
  // flattened metafields key->string (e.g. { "custom.skin_type": "oily" })
  metafields?: Record<string, string>;
}

export interface GroupingCollection {
  collectionId: string;
  title: string;
  productIds: string[];
}

export interface ProposedGroup {
  name: string; // human-facing bucket name
  tags: string[]; // representative tags for the group (used downstream as the category's embodying tags)
  productIds: string[]; // resolved members
  sourceRef?: string; // the dimension value this group came from (collection id / tag / type / metafield value)
}

// When no specific sourceRef is given, cap the number of distinct tags we
// turn into groups so a catalog with hundreds of tags doesn't explode
// into hundreds of categories.
const TOP_TAG_LIMIT = 12;

export function resolveGroupsBySource(
  source: GroupingSource,
  products: GroupingProduct[],
  collections: GroupingCollection[],
  opts?: { sourceRef?: string; metafieldKey?: string },
): ProposedGroup[] {
  const sourceRef = opts?.sourceRef;
  switch (source) {
    case "collection":
    case "smart_collection":
      return resolveByCollection(products, collections, sourceRef);
    case "tag":
      return resolveByTag(products, sourceRef);
    case "product_type":
      return resolveByProductType(products, sourceRef);
    case "metafield":
      return resolveByMetafield(products, opts?.metafieldKey, sourceRef);
    default: {
      // Exhaustiveness guard — if a new source is added the compiler flags
      // this branch instead of silently returning nothing.
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

// Map each collection to a group, intersecting its productIds with the
// products we actually know about so we never reference unknown ids. One
// group per collection that has ≥1 known product; or just the requested
// collection when sourceRef is set.
function resolveByCollection(
  products: GroupingProduct[],
  collections: GroupingCollection[],
  sourceRef: string | undefined,
): ProposedGroup[] {
  const knownProductIds = new Set(products.map((p) => p.productId));
  const groups: ProposedGroup[] = [];

  for (const collection of collections) {
    if (sourceRef !== undefined && collection.collectionId !== sourceRef) {
      continue;
    }
    const productIds = collection.productIds.filter((id) =>
      knownProductIds.has(id),
    );
    if (productIds.length === 0) continue;
    groups.push({
      name: collection.title,
      tags: [],
      productIds,
      sourceRef: collection.collectionId,
    });
  }

  return sortGroupsByName(groups);
}

// Group products by tag. Each product may land in multiple tag groups
// (one per distinct tag it carries). Tags are normalized via the shared
// normalizeTags helper so casing/spacing is consistent with the rest of
// the pipeline. When no sourceRef is given we keep only the top
// TOP_TAG_LIMIT tags by member count (ties broken alphabetically); when a
// specific tag is requested we emit only that one bucket.
function resolveByTag(
  products: GroupingProduct[],
  sourceRef: string | undefined,
): ProposedGroup[] {
  const requestedTag =
    sourceRef !== undefined ? normalizeTag(sourceRef) : undefined;

  // tag → ordered, de-duplicated member productIds
  const tagToProductIds = new Map<string, string[]>();
  for (const product of products) {
    const seenForProduct = new Set<string>();
    for (const tag of normalizeTags(product.tags, new Set())) {
      if (requestedTag !== undefined && tag !== requestedTag) continue;
      if (seenForProduct.has(tag)) continue;
      seenForProduct.add(tag);
      const members = tagToProductIds.get(tag);
      if (members) members.push(product.productId);
      else tagToProductIds.set(tag, [product.productId]);
    }
  }

  let tagEntries = [...tagToProductIds.entries()].filter(
    ([, members]) => members.length > 0,
  );

  // Only cap when surfacing every tag — a specific request is never capped.
  if (requestedTag === undefined && tagEntries.length > TOP_TAG_LIMIT) {
    tagEntries = [...tagEntries]
      .sort(([aTag, aMembers], [bTag, bMembers]) => {
        if (bMembers.length !== aMembers.length) {
          return bMembers.length - aMembers.length; // most-common first
        }
        return aTag.localeCompare(bTag); // tie-break alphabetical
      })
      .slice(0, TOP_TAG_LIMIT);
  }

  const groups: ProposedGroup[] = tagEntries.map(([tag, productIds]) => ({
    name: tag,
    tags: [tag],
    productIds,
    sourceRef: tag,
  }));

  return sortGroupsByName(groups);
}

// Group products by productType, skipping products with no type. One group
// per distinct type, or just the requested type when sourceRef is set.
function resolveByProductType(
  products: GroupingProduct[],
  sourceRef: string | undefined,
): ProposedGroup[] {
  const typeToProductIds = new Map<string, string[]>();
  for (const product of products) {
    const productType = product.productType?.trim();
    if (!productType) continue;
    if (sourceRef !== undefined && productType !== sourceRef) continue;
    const members = typeToProductIds.get(productType);
    if (members) members.push(product.productId);
    else typeToProductIds.set(productType, [product.productId]);
  }

  const groups: ProposedGroup[] = [...typeToProductIds.entries()].map(
    ([productType, productIds]) => ({
      name: productType,
      tags: [],
      productIds,
      sourceRef: productType,
    }),
  );

  return sortGroupsByName(groups);
}

// Group products by the value at metafields[metafieldKey], skipping
// products lacking that key. Requires metafieldKey — without it there's no
// dimension to split on, so we return an empty list (graceful no-op rather
// than throwing). One group per distinct value, or just the requested
// value when sourceRef is set.
function resolveByMetafield(
  products: GroupingProduct[],
  metafieldKey: string | undefined,
  sourceRef: string | undefined,
): ProposedGroup[] {
  if (!metafieldKey) return [];

  const valueToProductIds = new Map<string, string[]>();
  for (const product of products) {
    const value = product.metafields?.[metafieldKey]?.trim();
    if (!value) continue;
    if (sourceRef !== undefined && value !== sourceRef) continue;
    const members = valueToProductIds.get(value);
    if (members) members.push(product.productId);
    else valueToProductIds.set(value, [product.productId]);
  }

  const groups: ProposedGroup[] = [...valueToProductIds.entries()].map(
    ([value, productIds]) => ({
      name: value,
      tags: [],
      productIds,
      sourceRef: value,
    }),
  );

  return sortGroupsByName(groups);
}

// Single-tag normalization that reuses the shared normalizeTags rules so a
// requested tag matches the same way the indexed product tags do. Returns
// the empty string if the input normalizes away (caller treats "" as a
// tag that nothing will match).
function normalizeTag(raw: string): string {
  const [normalized] = normalizeTags([raw], new Set());
  return normalized ?? "";
}

// Stable alphabetical ordering by group name for deterministic output.
function sortGroupsByName(groups: ProposedGroup[]): ProposedGroup[] {
  return [...groups].sort((a, b) => a.name.localeCompare(b.name));
}
