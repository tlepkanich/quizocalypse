import type { PrismaClient } from "@prisma/client";
import { Quiz } from "./quizSchema";
import { validateQuiz } from "./quizValidation";
import type { IndexedProduct } from "./recommendationEngine";
import {
  BrandTokens,
  resolveDesignTokens,
  type DesignTokensT,
} from "./designTokens";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

export interface PublishedQuiz extends QuizDoc {
  product_index: IndexedProduct[];
  published_at: string;
  version: number;
  // Shop's myshopify domain, baked at publish time so the runtime can
  // construct PDP URLs (https://<shop>/products/<handle>) without an
  // extra DB lookup.
  shop_domain: string;
}

export interface PublishResult {
  ok: true;
  version: number;
  productCount: number;
}

export class PublishError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export async function publishQuiz(
  prisma: PrismaClient,
  args: { quizId: string; shopId: string },
): Promise<PublishResult> {
  const quiz = await prisma.quiz.findFirst({
    where: { id: args.quizId, shopId: args.shopId },
  });
  if (!quiz) throw new PublishError("Quiz not found", []);

  // Hard schema validation.
  const parsed = Quiz.safeParse(quiz.draftJson);
  if (!parsed.success) {
    throw new PublishError(
      "Draft JSON does not match the quiz schema.",
      parsed.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }
  const doc = parsed.data;

  // Soft validation — refuse to publish with semantic errors.
  const issues = validateQuiz(doc);
  if (issues.length > 0) {
    throw new PublishError(
      "Fix all validation issues before publishing.",
      issues.map((i) => ({ path: i.nodeId, message: i.message })),
    );
  }

  // Build product_index from shop's products that are in any scoped collection
  // OR any fallback collection referenced by result nodes (so fallback always
  // has products available) OR the quiz's featured collection (for mid-quiz
  // preview cold-start). If no scope is set, include all shop products.
  const fallbackCollectionIds = doc.nodes
    .filter((n) => n.type === "result")
    .map((n) =>
      n.type === "result" ? n.data.fallback_collection_id : undefined,
    )
    .filter((x): x is string => !!x);

  // Hand-picked products from product_cards nodes must be available even if
  // they're not in any scoped collection — otherwise a curated showcase
  // step would render empty. Collect those IDs and include them unconditionally.
  const explicitProductIds = new Set<string>(
    doc.nodes
      .filter((n) => n.type === "product_cards")
      .flatMap((n) =>
        n.type === "product_cards" ? n.data.product_ids : [],
      ),
  );

  const scopeIds = new Set<string>([
    ...doc.scope.collection_ids,
    ...fallbackCollectionIds,
    ...(doc.featured_collection_id ? [doc.featured_collection_id] : []),
  ]);

  const products = await prisma.product.findMany({
    where: { shopId: args.shopId },
  });

  const productIndex: IndexedProduct[] = products
    .filter((p) =>
      explicitProductIds.has(p.productId)
        ? true
        : scopeIds.size === 0
          ? true
          : p.collectionIds.some((c) => scopeIds.has(c)),
    )
    .map((p) => {
      const variants = (p.variants ?? []) as Array<{ inventoryQuantity?: number | null }>;
      const inStock = variants.some(
        (v) => typeof v.inventoryQuantity === "number" && v.inventoryQuantity > 0,
      );
      return {
        product_id: p.productId,
        title: p.title,
        handle: p.handle,
        price: p.priceMin ? String(p.priceMin) : null,
        image_url: p.imageUrl,
        tags: p.tags,
        collection_ids: p.collectionIds,
        inventory_in_stock: inStock,
      };
    });

  // Resolve the design-token cascade: shop brand → quiz overrides → defaults.
  // Per-node overrides remain in doc.design_overrides and are resolved at
  // render time by the storefront against this baked baseline.
  const shop = await prisma.shop.findUnique({
    where: { id: args.shopId },
    select: { brandTokens: true, shopDomain: true },
  });
  const shopParsed = BrandTokens.safeParse(shop?.brandTokens ?? {});
  const shopTokens: DesignTokensT | null = shopParsed.success
    ? shopParsed.data
    : null;
  const resolvedTokens = resolveDesignTokens(shopTokens, doc.design_tokens);

  // For any result page bound to a discovered category (match_strategy
  // === "archetype" + category_id), inline the category's product list
  // onto the page so the storefront runtime doesn't need a DB lookup.
  // Top-N pages (no category_id) are untouched.
  const archetypeCategoryIds = doc.results_pages
    .filter((r) => r.match_strategy === "archetype" && r.category_id)
    .map((r) => r.category_id!);
  const categoryRows =
    archetypeCategoryIds.length > 0
      ? await prisma.category.findMany({
          where: { id: { in: archetypeCategoryIds } },
          select: { id: true, productIds: true },
        })
      : [];
  const categoryProductIdsById = new Map(
    categoryRows.map((c) => [c.id, c.productIds]),
  );
  const bakedResultsPages = doc.results_pages.map((r) =>
    r.match_strategy === "archetype" && r.category_id
      ? {
          ...r,
          category_product_ids: categoryProductIdsById.get(r.category_id) ?? [],
        }
      : r,
  );

  const nextVersion = quiz.version + 1;
  const publishedJson: PublishedQuiz = {
    ...doc,
    results_pages: bakedResultsPages,
    status: "published",
    design_tokens: resolvedTokens,
    product_index: productIndex,
    published_at: new Date().toISOString(),
    version: nextVersion,
    shop_domain: shop?.shopDomain ?? "",
  };

  await prisma.$transaction([
    prisma.quiz.update({
      where: { id: quiz.id },
      data: {
        status: "published",
        publishedJson: publishedJson as never,
        version: nextVersion,
      },
    }),
    prisma.quizVersion.create({
      data: {
        quizId: quiz.id,
        version: nextVersion,
        publishedJson: publishedJson as never,
      },
    }),
  ]);

  // Spec §3.3 / §M7: keep the last 10 published versions only.
  const versions = await prisma.quizVersion.findMany({
    where: { quizId: quiz.id },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (versions.length > 10) {
    const toDelete = versions.slice(10).map((v) => v.id);
    await prisma.quizVersion.deleteMany({ where: { id: { in: toDelete } } });
  }

  return { ok: true, version: nextVersion, productCount: productIndex.length };
}
