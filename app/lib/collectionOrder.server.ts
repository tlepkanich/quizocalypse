// ────────────────────────────────────────────────────────────────────────────
// LOGIC v2 (L2-3) — publish-time Shopify collection ORDER fetch.
//
// rec-page-spec-V2 §4.2: "Collection order" is the DEFAULT hero/grid signal —
// the first product as the merchant arranged the collection in Shopify Admin
// (there is deliberately no in-app pin; reordering the collection IS the
// merchandising lever). The synced Category.productIds carries membership but
// not the merchant's sort, so publish fetches the real order here.
//
// Failure posture (spec §11.2 + the roadmap's honest-degrade discipline): any
// error — no offline session (the standalone dev shop), API failure, missing
// collection — returns null and the caller bakes the synced membership order
// instead, logging a warning. Publish is never blocked by this fetch.
// ────────────────────────────────────────────────────────────────────────────

interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
}

interface CollectionProductsPage {
  data?: {
    collection?: {
      products?: {
        nodes?: Array<{ id?: string }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    } | null;
  };
}

const PAGE_QUERY = `#graphql
  query CollectionOrder($id: ID!, $after: String) {
    collection(id: $id) {
      products(first: 250, after: $after) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

/** Fetch ONE collection's product ids in the collection's own sort order,
 *  paging until exhausted. Throws on malformed responses (caller catches). */
export async function fetchCollectionOrder(
  admin: AdminGraphql,
  collectionId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  // Hard page cap: 40 pages × 250 = 10k products — beyond any real collection;
  // guards against a pathological pageInfo loop.
  for (let page = 0; page < 40; page++) {
    const res = await admin.graphql(PAGE_QUERY, {
      variables: { id: collectionId, after },
    });
    const body = (await res.json()) as CollectionProductsPage;
    const products = body.data?.collection?.products;
    if (!products) break; // collection gone / inaccessible → partial result
    for (const n of products.nodes ?? []) if (n.id) ids.push(n.id);
    if (!products.pageInfo?.hasNextPage || !products.pageInfo.endCursor) break;
    after = products.pageInfo.endCursor;
  }
  return ids;
}

/** Fetch orders for every collection-sourced target. Pure given an admin —
 *  unit-testable with a mock client. */
export async function fetchCollectionOrders(
  admin: AdminGraphql,
  targets: Array<{ targetId: string; collectionRef: string }>,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of targets) {
    out[t.targetId] = await fetchCollectionOrder(admin, t.collectionRef);
  }
  return out;
}

/** The publish-time entry point: resolve an OFFLINE admin for the shop (the
 *  brandIdentityBuild pattern) and fetch every order; null on ANY failure so
 *  the baked map falls back to the synced membership order. */
export async function resolveCollectionOrders(
  shopDomain: string,
  targets: Array<{ targetId: string; collectionRef: string }>,
): Promise<Record<string, string[]> | null> {
  if (targets.length === 0) return {};
  try {
    // Lazy import keeps shopify.server (which builds shopifyApp() at module
    // load) out of the unit-test import graph.
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(shopDomain);
    return await fetchCollectionOrders(admin as AdminGraphql, targets);
  } catch (err) {
    console.warn(
      `[collectionOrder] no admin/order fetch for ${shopDomain} — falling back to synced order:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
