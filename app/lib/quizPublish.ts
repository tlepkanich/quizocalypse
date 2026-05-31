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
      // Flatten metafields into a simple key→string map for v3 ranking +
      // the metafield match strategy. Source shape is { "ns.key": { value,
      // type } } from catalog sync.
      const rawMeta = (p.metafields ?? {}) as Record<
        string,
        { value?: unknown } | unknown
      >;
      const metafields: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawMeta)) {
        const val =
          v && typeof v === "object" && "value" in v
            ? (v as { value?: unknown }).value
            : v;
        if (val != null) metafields[k] = String(val);
      }
      return {
        product_id: p.productId,
        title: p.title,
        handle: p.handle,
        price: p.priceMin ? String(p.priceMin) : null,
        image_url: p.imageUrl,
        tags: p.tags,
        collection_ids: p.collectionIds,
        inventory_in_stock: inStock,
        updated_at: p.updatedAt ? p.updatedAt.toISOString() : undefined,
        ...(Object.keys(metafields).length > 0 ? { metafields } : {}),
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

  // Inline category → productIds for every category referenced by the
  // recommendation logic so the storefront runtime needs no DB lookup:
  //  - legacy archetype: resultPage.category_id
  //  - v3 "category" strategy: result node data.category_id (+ stages)
  //  - v3 "points" strategy: every category referenced by any answer.points
  // We collect a global id set, fetch once, and attach the relevant slice
  // to each result page.
  const resultNodeById = new Map(
    doc.nodes.filter((n) => n.type === "result").map((n) => [n.id, n]),
  );
  const pointsCategoryIds = new Set<string>();
  for (const node of doc.nodes) {
    if (node.type !== "question") continue;
    for (const a of node.data.answers) {
      if (a.points) for (const cid of Object.keys(a.points)) pointsCategoryIds.add(cid);
    }
  }
  const allCategoryIds = new Set<string>();
  for (const r of doc.results_pages) {
    if (r.match_strategy === "archetype" && r.category_id) allCategoryIds.add(r.category_id);
    const node = resultNodeById.get(r.id);
    if (node && node.type === "result") {
      if (node.data.category_id) allCategoryIds.add(node.data.category_id);
      for (const st of node.data.stages) {
        if (st.category_id) allCategoryIds.add(st.category_id);
      }
      const ladder = [
        ...node.data.match_ladder,
        ...node.data.stages.flatMap((s) => s.match_ladder),
      ];
      if (ladder.includes("points")) {
        for (const cid of pointsCategoryIds) allCategoryIds.add(cid);
      }
    }
  }
  const categoryRows =
    allCategoryIds.size > 0
      ? await prisma.category.findMany({
          where: { id: { in: [...allCategoryIds] } },
          select: { id: true, productIds: true },
        })
      : [];
  const categoryProductIdsById = new Map(
    categoryRows.map((c) => [c.id, c.productIds]),
  );
  const fullMap: Record<string, string[]> = {};
  for (const [id, ids] of categoryProductIdsById) fullMap[id] = ids;

  const bakedResultsPages = doc.results_pages.map((r) => {
    const node = resultNodeById.get(r.id);
    const ladder =
      node && node.type === "result"
        ? [...node.data.match_ladder, ...node.data.stages.flatMap((s) => s.match_ladder)]
        : [];
    const needsMap =
      ladder.includes("category") ||
      ladder.includes("points") ||
      r.match_strategy === "archetype" ||
      r.match_strategy === "points";
    const out: typeof r = { ...r };
    if (r.match_strategy === "archetype" && r.category_id) {
      out.category_product_ids = categoryProductIdsById.get(r.category_id) ?? [];
    }
    if (needsMap) out.category_product_ids_map = fullMap;
    return out;
  });

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
