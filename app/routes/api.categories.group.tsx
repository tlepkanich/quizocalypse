// app/routes/api.categories.group.tsx
// Non-AI ("product-first") grouping action. The deterministic counterpart
// to /api/categories/discover: instead of asking Claude to invent
// archetypes, it partitions the catalog along a chosen catalog dimension
// (Shopify collection, smart collection, tag, product type, or metafield
// value) — or accepts a fully merchant-assembled "manual" set. The actual
// product→bucket resolution lives in app/lib/categoryGrouping.ts; this
// route just authenticates, loads the catalog, calls the resolver, and
// atomically overwrites the shop's Category rows (mirroring the discover
// route's persistence pattern).

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  resolveGroupsBySource,
  type GroupingCollection,
  type GroupingProduct,
  type GroupingSource,
  type ProposedGroup,
} from "../lib/categoryGrouping";

// Mirrors the discover route: a catalog this small can't be meaningfully
// partitioned, so refuse rather than persist a degenerate set.
const MIN_PRODUCTS = 5;

// Non-AI grouping sources we route through resolveGroupsBySource. "manual"
// is handled separately (the merchant hands us the buckets directly).
const GROUPING_SOURCES: ReadonlySet<string> = new Set<GroupingSource>([
  "collection",
  "smart_collection",
  "tag",
  "product_type",
  "metafield",
]);

interface ManualGroupInput {
  name: string;
  productIds: string[];
}

// Flatten a stored Product.metafields Json ({ "ns.key": { value, type } })
// into the Record<string,string> shape the resolver expects. Anything
// malformed (missing/non-object value) is skipped rather than throwing.
function flattenMetafields(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry && typeof entry === "object" && "value" in entry) {
      const value = (entry as { value: unknown }).value;
      if (value != null) out[key] = String(value);
    }
  }
  return out;
}

// Coerce the posted `groups` field (manual mode) into a validated list of
// { name, productIds }. Returns null on any structural problem so the
// caller can return a 400.
function parseManualGroups(raw: string | null): ManualGroupInput[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const groups: ManualGroupInput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const name = (item as { name?: unknown }).name;
    const productIds = (item as { productIds?: unknown }).productIds;
    if (typeof name !== "string") return null;
    if (
      !Array.isArray(productIds) ||
      !productIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    groups.push({ name, productIds: productIds as string[] });
  }
  return groups;
}

// Pull a field from either a urlencoded form body or a JSON body. Remix's
// request.formData() handles urlencoded + multipart; for application/json
// we parse manually.
async function readBody(
  request: Request,
): Promise<Record<string, string | null>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await request.json()) as Record<string, unknown>;
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value == null) {
        out[key] = null;
      } else if (typeof value === "string") {
        out[key] = value;
      } else {
        // groups posted as a real array in JSON → re-stringify so the
        // manual parser can treat both transports identically.
        out[key] = JSON.stringify(value);
      }
    }
    return out;
  }
  const form = await request.formData();
  const out: Record<string, string | null> = {};
  for (const [key, value] of form.entries()) {
    out[key] = typeof value === "string" ? value : null;
  }
  return out;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found" }, { status: 400 });
  }

  let body: Record<string, string | null>;
  try {
    body = await readBody(request);
  } catch {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const source = body.source;
  if (!source) {
    return json({ ok: false, error: "Missing source" }, { status: 400 });
  }
  if (source !== "manual" && !GROUPING_SOURCES.has(source)) {
    return json(
      { ok: false, error: `Unknown grouping source: ${source}` },
      { status: 400 },
    );
  }

  const [allProducts, allCollections] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
  ]);

  if (allProducts.length < MIN_PRODUCTS) {
    return json(
      {
        ok: false,
        error: `Need at least ${MIN_PRODUCTS} synced products to group categories.`,
      },
      { status: 400 },
    );
  }

  // Resolve the proposed buckets. Manual mode trusts the merchant's posted
  // assignment verbatim; every other source runs the deterministic resolver.
  let proposed: ProposedGroup[];
  if (source === "manual") {
    const manualGroups = parseManualGroups(body.groups ?? null);
    if (!manualGroups) {
      return json(
        { ok: false, error: "Invalid or missing manual groups" },
        { status: 400 },
      );
    }
    // Drop empties (no name AND no members) so blank UI buckets don't persist.
    const cleaned = manualGroups.filter(
      (g) => g.name.trim() !== "" || g.productIds.length > 0,
    );
    if (cleaned.length === 0) {
      return json(
        { ok: false, error: "Add at least one group with a name." },
        { status: 400 },
      );
    }
    proposed = cleaned.map((g, i) => ({
      name: g.name.trim() || `Group ${i + 1}`,
      tags: [],
      productIds: g.productIds,
    }));
  } else {
    const groupingProducts: GroupingProduct[] = allProducts.map((p) => ({
      productId: p.productId,
      title: p.title,
      tags: p.tags,
      productType: p.productType,
      collectionIds: p.collectionIds,
      metafields: flattenMetafields(p.metafields),
    }));
    const groupingCollections: GroupingCollection[] = allCollections.map(
      (c) => ({
        collectionId: c.collectionId,
        title: c.title,
        productIds: c.productIds,
      }),
    );

    const metafieldKey = body.metafieldKey?.trim() || undefined;
    if (source === "metafield" && !metafieldKey) {
      return json(
        { ok: false, error: "A metafield key is required." },
        { status: 400 },
      );
    }

    proposed = resolveGroupsBySource(
      source as GroupingSource,
      groupingProducts,
      groupingCollections,
      {
        sourceRef: body.sourceRef?.trim() || undefined,
        metafieldKey,
      },
    );

    if (proposed.length === 0) {
      return json(
        {
          ok: false,
          error: "No groups matched that source. Try a different dimension.",
        },
        { status: 400 },
      );
    }
  }

  // One run id ties together every Category row this invocation writes, so
  // the merchant can tell a grouping set apart from an AI discovery set.
  const discoveryRunId = `grp_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const rowsData = proposed.map((group) => ({
    shopId: shop.id,
    name: group.name,
    description: "",
    tags: group.tags,
    productIds: group.productIds,
    source,
    sourceRef: group.sourceRef ?? null,
    manualProductIds: source === "manual" ? group.productIds : [],
    discoveryRunId,
  }));

  try {
    await prisma.$transaction([
      prisma.category.deleteMany({ where: { shopId: shop.id } }),
      prisma.category.createMany({ data: rowsData }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }

  // Re-read so we return the auto-generated cuids (the discover route does
  // the same).
  const rows = await prisma.category.findMany({
    where: { shopId: shop.id, discoveryRunId },
    orderBy: { createdAt: "asc" },
  });

  return json({
    ok: true,
    runId: discoveryRunId,
    categories: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      tags: r.tags,
      productCount: r.productIds.length,
      source: r.source,
    })),
  });
}
