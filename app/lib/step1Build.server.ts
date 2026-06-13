import prisma from "../db.server";
import { buildScopedIndex } from "./catalogIndex";
import { detectGroupingDimension } from "./groupingDetect";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { generateTemplateOptions } from "./claude";
import type { GroupingProduct } from "./categoryGrouping";
import type { TemplateOption } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Step 1 funnel — server orchestration for the "generating" stage. Digests the
// merchant's goal + struggle + the (detected or confirmed) grouping + the brand
// identity into 2-3 lightweight quiz "directions" via one cheap AI pass. The
// brand identity is the on-brand seed; degrades gracefully when it's absent.
// ════════════════════════════════════════════════════════════════════════════

const toGroupingProduct = (p: {
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

export async function generateStep1TemplateOptions(
  shopId: string,
  input: { goal: string; struggle?: string; buckets?: Array<{ name: string; tags: string[] }> },
): Promise<TemplateOption[]> {
  const [products, collections, shop] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { brandIdentity: true } }),
  ]);

  const indexed = buildScopedIndex(products, collections, []);

  // Confirmed buckets from the grouping stage if provided; else detect them.
  let buckets = input.buckets;
  if (!buckets) {
    const detect = detectGroupingDimension(
      products.map(toGroupingProduct),
      collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
    );
    buckets = detect.proposed.map((g) => ({ name: g.name, tags: g.tags }));
  }

  const identity = parseBrandIdentitySafe(shop?.brandIdentity);
  const brandSummary = identity?.summary ?? "";
  const brandVoiceSample = identity?.voice
    ? [identity.voice.tone_description, ...(identity.voice.sample_phrases ?? [])]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return generateTemplateOptions({
    brandSummary,
    ...(brandVoiceSample ? { brandVoiceSample } : {}),
    goalPrompt: input.goal,
    ...(input.struggle ? { struggle: input.struggle } : {}),
    buckets,
    catalogSummary: indexed.summary,
  });
}
