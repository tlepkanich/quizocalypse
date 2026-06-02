import prisma from "../db.server";
import { buildScopedIndex } from "./catalogIndex";
import { discoverCategories, assignProductsAI } from "./categoryDiscover";
import { assignProducts } from "./categoryAssign";

// ───────────────────────────────────────────────────────────────────────────
// Shared bucket discovery (AI archetypes → persisted quiz-scoped Category rows).
// Extracted from /api/categories/discover so BOTH that route and the onboarding
// orchestrator (onboardingBuild.server.ts) run the identical discover → assign
// → persist transaction. Server-only.
// ───────────────────────────────────────────────────────────────────────────

// A catalog with fewer than this many products doesn't produce useful
// archetypes — the variance isn't there.
export const MIN_DISCOVERY_PRODUCTS = 5;

export class BucketDiscoveryError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "BucketDiscoveryError";
    this.status = status;
  }
}

export interface PersistedBucket {
  id: string;
  name: string;
  description: string;
  tags: string[];
  productCount: number;
  rationale: string | null;
}

/**
 * Discover archetype buckets for a shop's whole catalog and persist them as
 * Category rows (scoped to `quizId`, or shop-global when null — the destructive
 * wipe is scoped the same way). Returns the persisted rows with their cuids.
 * Throws BucketDiscoveryError (with an HTTP-ish status) on too-few products;
 * propagates CategoryDiscoveryError from the Claude call.
 */
export async function discoverAndPersistBuckets(
  shopId: string,
  quizId: string | null,
): Promise<{ runId: string; buckets: PersistedBucket[] }> {
  const [allProducts, allCollections] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
  ]);

  if (allProducts.length < MIN_DISCOVERY_PRODUCTS) {
    throw new BucketDiscoveryError(
      `Need at least ${MIN_DISCOVERY_PRODUCTS} synced products to discover categories.`,
      400,
    );
  }

  // Empty scope = whole catalog; buildScopedIndex yields a prompt-shaped summary.
  const indexed = buildScopedIndex(allProducts, allCollections, []);
  const discovered = await discoverCategories({ catalogSummary: indexed.summary });

  // Assign with AI when available (semantic placement by title/type/description),
  // falling back to the deterministic multi-signal + balance assignment on any
  // failure. Both pass the bucket NAME + product type/title so a tag-poor
  // catalog still distributes instead of dumping into one bucket.
  const assignableCategories = discovered.map((d) => ({
    key: d.name,
    name: d.name,
    description: d.description,
    tags: d.tags,
  }));
  const assignableProducts = allProducts.map((p) => ({
    productId: p.productId,
    tags: p.tags,
    title: p.title,
    productType: p.productType ?? undefined,
  }));

  let assignments: Map<string, string[]>;
  try {
    assignments = await assignProductsAI(assignableCategories, assignableProducts);
  } catch {
    assignments = assignProducts(assignableCategories, assignableProducts);
  }

  const discoveryRunId = `run_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  await prisma.$transaction([
    prisma.category.deleteMany({ where: { shopId, quizId } }),
    prisma.category.createMany({
      data: discovered.map((d) => ({
        shopId,
        quizId,
        name: d.name,
        description: d.description,
        tags: d.tags,
        productIds: assignments.get(d.name) ?? [],
        rationale: d.rationale,
        discoveryRunId,
      })),
    }),
  ]);

  const rows = await prisma.category.findMany({
    where: { shopId, discoveryRunId },
    orderBy: { createdAt: "asc" },
  });

  return {
    runId: discoveryRunId,
    buckets: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      tags: r.tags,
      productCount: r.productIds.length,
      rationale: r.rationale,
    })),
  };
}
