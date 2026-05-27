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
  // has products available). If no scope is set, include all shop products.
  const fallbackCollectionIds = doc.nodes
    .filter((n) => n.type === "result")
    .map((n) =>
      n.type === "result" ? n.data.fallback_collection_id : undefined,
    )
    .filter((x): x is string => !!x);

  const scopeIds = new Set<string>([
    ...doc.scope.collection_ids,
    ...fallbackCollectionIds,
  ]);

  const products = await prisma.product.findMany({
    where: { shopId: args.shopId },
  });

  const productIndex: IndexedProduct[] = products
    .filter((p) =>
      scopeIds.size === 0
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
    select: { brandTokens: true },
  });
  const shopParsed = BrandTokens.safeParse(shop?.brandTokens ?? {});
  const shopTokens: DesignTokensT | null = shopParsed.success
    ? shopParsed.data
    : null;
  const resolvedTokens = resolveDesignTokens(shopTokens, doc.design_tokens);

  const nextVersion = quiz.version + 1;
  const publishedJson: PublishedQuiz = {
    ...doc,
    status: "published",
    design_tokens: resolvedTokens,
    product_index: productIndex,
    published_at: new Date().toISOString(),
    version: nextVersion,
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
