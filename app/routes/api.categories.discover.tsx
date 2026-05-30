// app/routes/api.categories.discover.tsx
// Discovers shopper-archetype categories for the active shop. Reads the
// whole catalog, calls Claude to propose 5–9 categories, runs the
// deterministic tag-overlap assignment, atomically overwrites existing
// categories with the fresh set.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildScopedIndex } from "../lib/catalogIndex";
import {
  CategoryDiscoveryError,
  discoverCategories,
} from "../lib/categoryDiscover";
import { assignProducts } from "../lib/categoryAssign";

// A catalog with fewer than this many products doesn't produce useful
// archetypes — the variance isn't there. Return a 400 rather than burning
// a Claude call.
const MIN_PRODUCTS = 5;

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found" }, { status: 400 });
  }

  const [allProducts, allCollections] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
  ]);

  if (allProducts.length < MIN_PRODUCTS) {
    return json(
      {
        ok: false,
        error: `Need at least ${MIN_PRODUCTS} synced products to discover categories.`,
      },
      { status: 400 },
    );
  }

  // Empty scope = whole catalog. buildScopedIndex already produces a
  // prompt-shaped summary (top tags + sample products) we can hand
  // straight to Claude.
  const indexed = buildScopedIndex(allProducts, allCollections, []);

  let discovered;
  try {
    discovered = await discoverCategories({ catalogSummary: indexed.summary });
  } catch (err) {
    if (err instanceof CategoryDiscoveryError) {
      return json(
        {
          ok: false,
          error: `${err.message}${err.lastValidationIssue ? ` (${err.lastValidationIssue})` : ""}`,
        },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, { status: 500 });
  }

  // Assign products via tag overlap. Use the category name as the
  // assignment key, then re-key once we have real db ids after insert.
  const assignments = assignProducts(
    discovered.map((d) => ({ key: d.name, tags: d.tags })),
    allProducts.map((p) => ({
      productId: p.productId,
      tags: p.tags,
      title: p.title,
    })),
  );

  // One discovery run id ties together every Category row we're about to
  // insert. Lets the merchant tell at a glance when a set was generated.
  const discoveryRunId = `run_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  await prisma.$transaction([
    prisma.category.deleteMany({ where: { shopId: shop.id } }),
    prisma.category.createMany({
      data: discovered.map((d) => ({
        shopId: shop.id,
        name: d.name,
        description: d.description,
        tags: d.tags,
        productIds: assignments.get(d.name) ?? [],
        rationale: d.rationale,
        discoveryRunId,
      })),
    }),
  ]);

  // Re-read so we get the auto-generated cuids for the response.
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
      rationale: r.rationale,
    })),
  });
}
