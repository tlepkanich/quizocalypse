import prisma from "../db.server";
import { buildScopedIndex } from "./catalogIndex";
import { detectGroupingDimension } from "./groupingDetect";
import { parseBrandIdentitySafe } from "./brandIdentity";
import {
  runWebResearchForQuizTypes,
  generateQuizTypes,
  generateQuizTemplates,
} from "./claude";
import type { GroupingProduct } from "./categoryGrouping";
import type { QuizType, RichTemplateOption } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Step 2 — server orchestration for the two-tier template generation. Tier 1
// digests the brand identity + catalog (+ optional live web research) into 3-4
// quiz TYPE cards; tier 2 expands the chosen type into 2-3 rich battle-card
// TEMPLATES. Mirrors step1Build's generateStep1TemplateOptions assembly. The
// detached/funnel wiring (writing BuildSession, polling) lands in T3.
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

async function loadStep2Context(shopId: string) {
  const [products, collections, shop] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { brandIdentity: true } }),
  ]);
  const indexed = buildScopedIndex(products, collections, []);
  const identity = parseBrandIdentitySafe(shop?.brandIdentity);
  const brandSummary = identity?.summary ?? "";
  const brandVoiceSample = identity?.voice
    ? [identity.voice.tone_description, ...(identity.voice.sample_phrases ?? [])]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const positioning = {
    industry: identity?.positioning.industry ?? "",
    vertical: identity?.positioning.vertical ?? "",
    price_tier: identity?.positioning.price_tier ?? "",
    demographic: identity?.positioning.target_demographic ?? [],
  };
  // Confirmed buckets when provided by the funnel; else detect them.
  const detect = detectGroupingDimension(
    products.map(toGroupingProduct),
    collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
  );
  return { products, collections, indexed, brandSummary, brandVoiceSample, positioning, detect };
}

// Tier 1: brand-tailored quiz types (with best-effort live web research).
export async function generateStep2Types(
  shopId: string,
  input: { goal: string; struggle?: string; buckets?: Array<{ name: string; tags: string[] }> },
): Promise<{ types: QuizType[]; webResearchSummary: string }> {
  const ctx = await loadStep2Context(shopId);
  const buckets =
    input.buckets ?? ctx.detect.proposed.map((g) => ({ name: g.name, tags: g.tags }));

  const webResearchText = await runWebResearchForQuizTypes({
    industry: ctx.positioning.industry,
    vertical: ctx.positioning.vertical,
    priceTier: ctx.positioning.price_tier,
    demographic: ctx.positioning.demographic,
  });

  const types = await generateQuizTypes({
    brandSummary: ctx.brandSummary,
    ...(ctx.brandVoiceSample ? { brandVoiceSample: ctx.brandVoiceSample } : {}),
    positioning: ctx.positioning,
    goalPrompt: input.goal,
    ...(input.struggle ? { struggle: input.struggle } : {}),
    buckets,
    catalogSummary: ctx.indexed.summary,
    webResearchText,
  });

  return { types, webResearchSummary: webResearchText };
}

// Tier 2: rich battle-card templates for the chosen type.
export async function generateStep2Templates(
  shopId: string,
  chosenType: QuizType,
  input: { goal: string; struggle?: string; buckets?: Array<{ id: string; name: string; tags: string[] }> },
): Promise<RichTemplateOption[]> {
  const ctx = await loadStep2Context(shopId);
  const buckets =
    input.buckets ??
    ctx.detect.proposed.map((g) => ({ id: g.sourceRef ?? g.name, name: g.name, tags: g.tags }));

  return generateQuizTemplates({
    chosenType,
    brandSummary: ctx.brandSummary,
    ...(ctx.brandVoiceSample ? { brandVoiceSample: ctx.brandVoiceSample } : {}),
    positioning: {
      industry: ctx.positioning.industry,
      vertical: ctx.positioning.vertical,
      price_tier: ctx.positioning.price_tier,
    },
    goalPrompt: input.goal,
    ...(input.struggle ? { struggle: input.struggle } : {}),
    buckets,
    catalogSummary: ctx.indexed.summary,
  });
}
