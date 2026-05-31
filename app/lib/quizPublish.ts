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

type ResultPageT = QuizDoc["results_pages"][number];

// Every category id the recommendation logic references, across BOTH the legacy
// results_pages array AND the v3 result NODES (data.category_id, stages, and the
// points strategy → every category any answer awards points to). The publisher
// fetches these once and bakes their product ids onto the published pages.
export function collectReferencedCategoryIds(doc: QuizDoc): Set<string> {
  const pointsCategoryIds = new Set<string>();
  for (const node of doc.nodes) {
    if (node.type !== "question") continue;
    for (const a of node.data.answers) {
      if (a.points) for (const cid of Object.keys(a.points)) pointsCategoryIds.add(cid);
    }
  }

  const ids = new Set<string>();
  for (const r of doc.results_pages) {
    if (r.match_strategy === "archetype" && r.category_id) ids.add(r.category_id);
  }
  for (const node of doc.nodes) {
    if (node.type !== "result") continue;
    if (node.data.category_id) ids.add(node.data.category_id);
    for (const st of node.data.stages) if (st.category_id) ids.add(st.category_id);
    const ladder = [
      ...node.data.match_ladder,
      ...node.data.stages.flatMap((s) => s.match_ladder),
    ];
    if (ladder.includes("points")) {
      for (const cid of pointsCategoryIds) ids.add(cid);
    }
  }
  return ids;
}

// Bake the runtime-facing results_pages: keep/enrich any legacy entries AND
// synthesize one entry per v3 result NODE (keyed by node id) carrying the baked
// category→productIds map. The storefront engine reads the map off the result
// page matching the result node id (recommendationEngine.categoryMapFor), so
// WITHOUT these node-derived entries the v3 "category"/"points" strategies
// resolve to nothing and fall through to the fallback collection. Pure +
// testable (the category rows are fetched by the caller).
export function bakeResultPages(
  doc: QuizDoc,
  categoryProductIdsById: Map<string, string[]>,
): ResultPageT[] {
  const fullMap: Record<string, string[]> = {};
  for (const [id, pids] of categoryProductIdsById) fullMap[id] = pids;

  const resultNodeById = new Map(
    doc.nodes.filter((n) => n.type === "result").map((n) => [n.id, n]),
  );

  const ladderFor = (nodeId: string): string[] => {
    const node = resultNodeById.get(nodeId);
    return node && node.type === "result"
      ? [...node.data.match_ladder, ...node.data.stages.flatMap((s) => s.match_ladder)]
      : [];
  };

  // Legacy results_pages (kept + enriched).
  const legacy = doc.results_pages.map((r) => {
    const ladder = ladderFor(r.id);
    const needsMap =
      ladder.includes("category") ||
      ladder.includes("points") ||
      r.match_strategy === "archetype" ||
      r.match_strategy === "points";
    const out: ResultPageT = { ...r };
    if (r.match_strategy === "archetype" && r.category_id) {
      out.category_product_ids = categoryProductIdsById.get(r.category_id) ?? [];
    }
    if (needsMap) out.category_product_ids_map = fullMap;
    return out;
  });

  // v3 result NODES not already represented in results_pages.
  const legacyIds = new Set(doc.results_pages.map((r) => r.id));
  const fromNodes: ResultPageT[] = [];
  for (const node of doc.nodes) {
    if (node.type !== "result" || legacyIds.has(node.id)) continue;
    const ladder = [
      ...node.data.match_ladder,
      ...node.data.stages.flatMap((s) => s.match_ladder),
    ];
    const needsMap = ladder.includes("category") || ladder.includes("points");
    fromNodes.push({
      id: node.id,
      headline: node.data.headline,
      subtext: node.data.subtext,
      product_ids: [],
      match_strategy: node.data.category_id ? "archetype" : "top_n",
      ...(node.data.category_id
        ? {
            category_id: node.data.category_id,
            category_product_ids: categoryProductIdsById.get(node.data.category_id) ?? [],
          }
        : {}),
      ...(needsMap ? { category_product_ids_map: fullMap } : {}),
    });
  }

  return [...legacy, ...fromNodes];
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
      const variants = (p.variants ?? []) as Array<{
        id?: string;
        inventoryQuantity?: number | null;
      }>;
      const inStock = variants.some(
        (v) => typeof v.inventoryQuantity === "number" && v.inventoryQuantity > 0,
      );
      // Prefer the first in-stock variant for the cart permalink; else the
      // first variant. Used by add-to-cart on the storefront.
      const defaultVariant =
        variants.find(
          (v) => typeof v.inventoryQuantity === "number" && v.inventoryQuantity > 0,
        ) ?? variants[0];
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
        ...(defaultVariant?.id ? { default_variant_id: defaultVariant.id } : {}),
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
  // recommendation logic so the storefront runtime needs no DB lookup. The
  // category ids are collected from result NODES (the v3 model) as well as the
  // legacy results_pages array, then fetched once and baked onto a result page
  // per node (see bakeResultPages). This is what lets the runtime "category"
  // and "points" strategies resolve real products instead of falling through to
  // the fallback collection.
  const allCategoryIds = collectReferencedCategoryIds(doc);
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

  const bakedResultsPages = bakeResultPages(doc, categoryProductIdsById);

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
