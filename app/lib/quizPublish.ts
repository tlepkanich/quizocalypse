import type { PrismaClient } from "@prisma/client";
import { Quiz } from "./quizSchema";
import { validateQuiz } from "./quizValidation";
import type { IndexedProduct } from "./recommendationEngine";
import { translateFeaturesToBenefits, generateAnswerTooltips } from "./claude";
import { toneSampleFromCatalog } from "./catalogIndex";
import { parseBrandGuidelinesSafe } from "./brandGuidelines";
import { computeAnswerWeights } from "./answerPerformance";
import { StoredMembershipSchema } from "./groupMembership";
import {
  BrandTokens,
  resolveDesignTokens,
  type DesignTokensT,
} from "./designTokens";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

// §J1/§C4 — extract a Group's ACTIVE persona (name present) from its membership
// Json, for baking into target_index. Returns undefined for legacy / no-persona
// groups, so the bake stays absent (byte-identical) unless a persona is set.
function personaOfMembership(
  membership: unknown,
): { name: string; description?: string; image?: string | null } | undefined {
  const parsed = StoredMembershipSchema.safeParse(membership);
  const p = parsed.success ? parsed.data.persona : null;
  if (!p || !p.name || !p.name.trim()) return undefined;
  return { name: p.name, description: p.description, image: p.image ?? null };
}

// The public `/q/:id.json` embed endpoint serves publishedJson raw (it never
// applies a locale, unlike the HTML routes). Strip the editor-only maps that
// must never egress a public, CORS-open, CDN-cacheable payload:
//  - review_enrichment_sources: merchant's raw pasted review/FAQ text (also
//    dropped at bake — belt-and-suspenders).
//  - translations: the full multi-locale string maps (no .json consumer reads
//    them; the HTML/launcher/results/compare routes read translations from their
//    own DB load and apply the locale server-side).
// The single strip primitive every public egress shares (the .json endpoint
// AND the HTML / results routes) so a future refactor can't silently diverge
// one of them and leak the merchant's pasted reviews or the full locale maps to
// shoppers (HII-6). Typed: preserves the doc's shape minus the two editor-only
// keys, so the HTML routes keep their strongly-typed `doc` payload.
export function stripPublicDoc<T extends Record<string, unknown>>(
  doc: T,
): Omit<T, "review_enrichment_sources" | "translations"> {
  const { review_enrichment_sources: _r, translations: _t, ...rest } = doc;
  void _r;
  void _t;
  return rest;
}

export function stripPublicJsonPayload(
  payload: unknown,
): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  return stripPublicDoc(payload as Record<string, unknown>);
}

export interface PublishedQuiz extends QuizDoc {
  product_index: IndexedProduct[];
  published_at: string;
  version: number;
  // Shop's myshopify domain, baked at publish time so the runtime can
  // construct PDP URLs (https://<shop>/products/<handle>) without an
  // extra DB lookup.
  shop_domain: string;
  // Spin-off: "shopify" (Shopify cart + PDP) | "standalone" (the merchant's own
  // product URLs, "Shop now"). Absent on pre-existing quizzes → runtime reads it
  // as "shopify", so nothing changes for installed Shopify shops.
  platform?: "shopify" | "standalone";
  // Phase J — per-answer conversion weights (only when data_weighting is on
  // AND the session history clears the data gates). Privacy-safe aggregates.
  answer_weights?: Record<string, number>;
  // LOGIC v2 (L2-3) — baked ONLY for decider docs (absent on every legacy
  // publish → byte-identical). target_product_ids_map: targetId → ORDERED
  // member product ids (collection-sourced targets carry the merchant's
  // Shopify collection sort when a publish-time fetch succeeds, else the
  // synced membership order — the collection_order hero signal reads this
  // order). target_index: targetId → shape + display name for the runtime
  // and the Step-4 target selector.
  target_product_ids_map?: Record<string, string[]>;
  // §J1/§C4 — `persona` is baked ONLY for a decider doc whose mapped Group
  // carries an ACTIVE persona (persona.name set). Absent otherwise, so decider
  // docs without personas stay byte-identical, and legacy docs never reach this
  // bake at all (the whole block is decider-gated). Runtime render is a separate
  // step; this is the baked data foundation (§C4 result precedence).
  target_index?: Record<string, TargetIndexEntry>;
}

export type TargetIndexEntry = {
  type: "product" | "collection" | "tag";
  name: string;
  persona?: { name: string; description?: string; image?: string | null };
};

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

// LOGIC v2 (L2-3) — every recommendation target a decider doc references: the
// deciding question's answer mappings + every AND-rule's target. These are
// Step-1 Category ids; publish fetches them, BLOCKS on missing rows (V4/V5's
// DB half — the doc points at a deleted bucket), and bakes their ORDERED
// membership into publishedJson.target_product_ids_map. Pure + testable.
export function collectDeciderTargetIds(doc: QuizDoc): Set<string> {
  const ids = new Set<string>();
  if (doc.logic_model !== "decider") return ids;
  for (const n of doc.nodes) {
    if (n.type !== "question" || n.data.role !== "decides") continue;
    for (const a of n.data.answers) if (a.target_id) ids.add(a.target_id);
  }
  for (const rule of doc.decision_rules ?? []) ids.add(rule.target_id);
  return ids;
}

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

// Cap a plain-text product description for the result card (spec §2). Collapses
// whitespace and trims to a sentence-ish length so cards stay scannable.
export function shortDescription(text: string, maxChars = 200): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  // Cut at the last word boundary before the cap, then ellipsize.
  const slice = clean.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

// Every product id the recommendation engine can surface for this doc: bucket
// members (from the baked category map) + explicit conditional-rule products.
// The publisher unions these INTO product_index so the runtime's category /
// points / conditional strategies (which intersect productIndex with these ids)
// actually find them instead of falling through to the fallback collection.
// Pure + testable.
export function collectRecommendableProductIds(
  doc: QuizDoc,
  categoryProductIdsById: Map<string, string[]>,
): Set<string> {
  const ids = new Set<string>();
  for (const pids of categoryProductIdsById.values())
    for (const pid of pids) ids.add(pid);
  for (const node of doc.nodes) {
    if (node.type !== "result") continue;
    for (const rule of node.data.conditional_rules)
      for (const pid of rule.product_ids) ids.add(pid);
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
  // LOGIC v2 (L2-3) — optional server-side collection-order fetcher, injected
  // by the (server-only) caller so this module stays client-safe (bakeResultPages
  // is imported by preview components; a direct .server import would break the
  // client bundle). Given the collection-sourced targets, returns targetId →
  // ORDERED product ids per the merchant's Shopify collection sort, or null on
  // any failure → the baked map falls back to the synced membership order.
  opts?: {
    collectionOrder?: (
      targets: Array<{ targetId: string; collectionRef: string }>,
    ) => Promise<Record<string, string[]> | null>;
  },
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
  const explicitProductIds = new Set<string>([
    ...doc.nodes
      .filter((n) => n.type === "product_cards")
      .flatMap((n) => (n.type === "product_cards" ? n.data.product_ids : [])),
  ]);

  const scopeIds = new Set<string>([
    ...doc.scope.collection_ids,
    ...fallbackCollectionIds,
    ...(doc.featured_collection_id ? [doc.featured_collection_id] : []),
    // LOGIC v2 — the two named fallback collections (§6) must have their
    // members in product_index so the runtime can render them without a live
    // fetch. Decider docs only; absent fields add nothing.
    ...(doc.logic_model === "decider" && doc.rec_page_settings?.global.emptyFallbackCol
      ? [doc.rec_page_settings.global.emptyFallbackCol]
      : []),
    ...(doc.logic_model === "decider" && doc.rec_page_settings?.global.safetyNetCol
      ? [doc.rec_page_settings.global.safetyNetCol]
      : []),
  ]);

  // Categories referenced by the recommendation logic (v3 result nodes' bound
  // buckets + the points strategy). Fetched BEFORE the product index so their
  // member products are guaranteed INTO the index — otherwise the runtime's
  // `category`/`points` strategies (productIndex ∩ bucket ids) collapse to
  // nothing and fall through to the fallback collection (the "only snowboards"
  // bug: a quiz scoped to a 13-product collection baked buckets referencing the
  // whole catalog, so the intersection was ~empty).
  const allCategoryIds = collectReferencedCategoryIds(doc);
  // LOGIC v2 — decider targets are Category rows too; fetch them in the same
  // pass (the extra select columns feed target_index and are harmless for
  // legacy docs, whose deciderTargetIds set is always empty).
  const deciderTargetIds = collectDeciderTargetIds(doc);
  const fetchCategoryIds = new Set([...allCategoryIds, ...deciderTargetIds]);
  const categoryRows =
    fetchCategoryIds.size > 0
      ? await prisma.category.findMany({
          where: { id: { in: [...fetchCategoryIds] } },
          select: { id: true, productIds: true, source: true, sourceRef: true, name: true, membership: true },
        })
      : [];
  const categoryProductIdsById = new Map(
    categoryRows.map((c) => [c.id, c.productIds]),
  );

  // LOGIC v2 (V4/V5's DB half) — a decider doc referencing a target whose
  // Category row no longer exists (bucket deleted after mapping) must NOT
  // publish: the runtime would resolve an empty target for those shoppers.
  let targetBake: {
    map: Record<string, string[]>;
    index: Record<string, TargetIndexEntry>;
  } | null = null;
  if (doc.logic_model === "decider") {
    const rowById = new Map(categoryRows.map((c) => [c.id, c]));
    const missing = [...deciderTargetIds].filter((id) => !rowById.has(id));
    if (missing.length > 0) {
      throw new PublishError(
        "A mapped result bucket no longer exists — re-pick the mapping before publishing.",
        missing.map((id) => ({ path: id, message: "Referenced bucket was deleted." })),
      );
    }
    // Ordered membership: collection-sourced targets try the merchant's real
    // Shopify collection sort via the injected fetcher; anything else (or a
    // failed fetch) keeps the synced membership order.
    const collectionTargets = [...deciderTargetIds]
      .map((id) => rowById.get(id)!)
      .filter((c) => c.source === "collection" && c.sourceRef)
      .map((c) => ({ targetId: c.id, collectionRef: c.sourceRef! }));
    let shopifyOrder: Record<string, string[]> | null = null;
    if (collectionTargets.length > 0 && opts?.collectionOrder) {
      try {
        shopifyOrder = await opts.collectionOrder(collectionTargets);
      } catch (err) {
        console.warn(
          "[publish] collection-order fetch failed — using synced membership order",
          err instanceof Error ? err.message : err,
        );
      }
    }
    const map: Record<string, string[]> = {};
    const index: Record<string, TargetIndexEntry> = {};
    for (const id of deciderTargetIds) {
      const row = rowById.get(id)!;
      const ordered = shopifyOrder?.[id];
      // The Shopify order can drift from synced membership (deleted/added
      // products since sync) — intersect it with the synced members so the
      // baked map never references a product missing from product_index.
      const synced = row.productIds;
      map[id] = ordered
        ? [
            ...ordered.filter((pid) => synced.includes(pid)),
            ...synced.filter((pid) => !ordered.includes(pid)),
          ]
        : [...synced];
      const type =
        row.source === "product" ? "product" : row.source === "tag" ? "tag" : "collection";
      // §J1/§C4 — carry the Group's ACTIVE persona (name set) into the bake.
      const persona = personaOfMembership(row.membership);
      index[id] = persona ? { type, name: row.name, persona } : { type, name: row.name };
    }
    targetBake = { map, index };
  }

  // Every product the recommendation engine can surface MUST be in the index.
  const includeProductIds = collectRecommendableProductIds(doc, categoryProductIdsById);
  // LOGIC v2 — decider target members must be in product_index too (the
  // decider path intersects the baked map with the index).
  if (targetBake) {
    for (const pids of Object.values(targetBake.map))
      for (const pid of pids) includeProductIds.add(pid);
  }

  const products = await prisma.product.findMany({
    where: { shopId: args.shopId },
  });

  const productIndex: IndexedProduct[] = products
    .filter((p) =>
      explicitProductIds.has(p.productId) || includeProductIds.has(p.productId)
        ? true
        : scopeIds.size === 0
          ? true
          : p.collectionIds.some((c) => scopeIds.has(c)),
    )
    .map((p) => {
      const variants = (p.variants ?? []) as Array<{
        id?: string;
        title?: string;
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
      // Variant list for the result-card selector — title is the Shopify
      // variant title ("Small / Red"); availability from inventory.
      const variantList = variants
        .filter((v) => typeof v.id === "string")
        .map((v) => ({
          id: v.id as string,
          title: typeof v.title === "string" && v.title ? v.title : "Default",
          available:
            typeof v.inventoryQuantity === "number" ? v.inventoryQuantity > 0 : true,
        }));
      return {
        product_id: p.productId,
        title: p.title,
        handle: p.handle,
        price: p.priceMin ? String(p.priceMin) : null,
        image_url: p.imageUrl,
        ...(p.descriptionText && p.descriptionText.trim()
          ? { description: shortDescription(p.descriptionText) }
          : {}),
        tags: p.tags,
        collection_ids: p.collectionIds,
        inventory_in_stock: inStock,
        updated_at: p.updatedAt ? p.updatedAt.toISOString() : undefined,
        ...(p.url ? { url: p.url } : {}),
        ...(Object.keys(metafields).length > 0 ? { metafields } : {}),
        ...(defaultVariant?.id ? { default_variant_id: defaultVariant.id } : {}),
        ...(variantList.length > 1 ? { variants: variantList } : {}),
      };
    });

  // Resolve the design-token cascade: shop brand → quiz overrides → defaults.
  // Per-node overrides remain in doc.design_overrides and are resolved at
  // render time by the storefront against this baked baseline.
  const shop = await prisma.shop.findUnique({
    where: { id: args.shopId },
    select: { brandTokens: true, shopDomain: true, brandGuidelines: true, source: true },
  });
  const shopParsed = BrandTokens.safeParse(shop?.brandTokens ?? {});
  const shopTokens: DesignTokensT | null = shopParsed.success
    ? shopParsed.data
    : null;
  const resolvedTokens = resolveDesignTokens(shopTokens, doc.design_tokens);
  const brandGuidelines = parseBrandGuidelinesSafe(shop?.brandGuidelines);

  // Bake category → productIds onto each result page so the storefront needs no
  // DB lookup. `categoryProductIdsById` was fetched above (before the product
  // index) so the index is guaranteed to contain these products.
  const bakedResultsPages = bakeResultPages(doc, categoryProductIdsById);

  // Bake "why this product" benefit bullets onto each result node (Dev Spec §5).
  // Best-effort + parallel: each translateFeaturesToBenefits call falls back to
  // [] on failure (and the function is non-throwing), so publish never breaks.
  // Skips nodes that already carry bullets (merchant/AI-authored). Features come
  // from the bound bucket's top products' titles + descriptions.
  const productById = new Map(products.map((p) => [p.productId, p]));
  const toneSample = toneSampleFromCatalog(products);
  const bakedNodes = await Promise.all(
    doc.nodes.map(async (node) => {
      // Result nodes → "why this product" benefit bullets (Call 3).
      if (node.type === "result") {
        if (node.data.why_bullets.length > 0) return node;
        const catId = node.data.category_id;
        const pids = (catId ? categoryProductIdsById.get(catId) ?? [] : []).slice(0, 3);
        const features = pids
          .map((pid) => productById.get(pid))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .flatMap((p) => [
            p.title,
            ...(p.descriptionText
              ? [p.descriptionText.replace(/\s+/g, " ").trim().slice(0, 300)]
              : []),
          ]);
        if (features.length === 0) return node;
        const bullets = await translateFeaturesToBenefits({
          features: features.slice(0, 6),
          ...(toneSample ? { brandVoiceSample: toneSample } : {}),
          ...(brandGuidelines ? { brandGuidelines } : {}),
        }).catch(() => [] as string[]);
        return bullets.length > 0
          ? { ...node, data: { ...node.data, why_bullets: bullets } }
          : node;
      }
      // Question nodes → one tooltip per answer (Call 4). Fills only empty ones,
      // so merchant/AI-authored tooltips are preserved.
      if (node.type === "question") {
        if (node.data.answers.every((a) => a.tooltip_text)) return node;
        const tips = await generateAnswerTooltips({
          answers: node.data.answers.map((a) => ({ id: a.id, text: a.text })),
          context: node.data.text,
          ...(brandGuidelines ? { brandGuidelines } : {}),
        }).catch(() => ({}) as Record<string, string>);
        if (Object.keys(tips).length === 0) return node;
        return {
          ...node,
          data: {
            ...node.data,
            answers: node.data.answers.map((a) =>
              !a.tooltip_text && tips[a.id] ? { ...a, tooltip_text: tips[a.id] } : a,
            ),
          },
        };
      }
      return node;
    }),
  );

  // Phase J: bake conversion-informed answer weights when the merchant opted
  // in AND the session history clears the data gates (≥30 completed, ≥5
  // conversions). Failure to compute must never block publishing.
  let answerWeights: Record<string, number> | undefined;
  if (doc.data_weighting) {
    try {
      const sessions = await prisma.quizSession.findMany({
        where: { quizId: quiz.id, completedAt: { not: null } },
        select: { answerIds: true, converted: true, completedAt: true },
        orderBy: { startedAt: "desc" },
        take: 5000,
      });
      const result = computeAnswerWeights(sessions);
      if (result.eligible && Object.keys(result.weights).length > 0) {
        answerWeights = result.weights;
      }
    } catch {
      // weights are an enhancement — publish proceeds unweighted
    }
  }

  // Bake the shop's currency (ISO 4217) so the runtime formats prices/discounts
  // with the right symbol + decimal rules (e.g. ¥886, not "$886"). A Shopify
  // shop has ONE currency, captured per-product at sync time; take the first
  // product that carries one. Absent (e.g. an all-manual catalog) → omit the
  // field so the runtime falls back to USD.
  const bakedCurrency = products.find((p) => p.currency)?.currency ?? undefined;

  const nextVersion = quiz.version + 1;
  // Strip draft/editor-only state that must never reach publishedJson (which
  // spreads ...doc) or the served runtime payload:
  //  - build_session: Step-1 funnel scratch.
  //  - review_enrichment_sources: the merchant's pasted review/FAQ source text.
  //    No serve route consumes it (the builder reads it from the DRAFT), so drop
  //    it at the root here — otherwise every public serve route that doesn't
  //    explicitly strip it (the .json embed + compare) egresses it verbatim.
  //  - why_copy_meta: L2-11 config-time AI-copy provenance (staleness hashes) —
  //    the panel reads it from the DRAFT; shoppers never need it.
  //  - path_report_ai: L2-12c advisory AI path-quality rows — the panel reads it
  //    from the DRAFT; shoppers never need it, and it never gates publish.
  const {
    build_session: _build_session,
    review_enrichment_sources: _review_sources,
    why_copy_meta: _why_copy_meta,
    path_report_ai: _path_report_ai,
    ...docWithoutSession
  } = doc;
  const publishedJson: PublishedQuiz = {
    ...docWithoutSession,
    nodes: bakedNodes,
    results_pages: bakedResultsPages,
    status: "published",
    design_tokens: resolvedTokens,
    // §5 — a de-linked rec page resolves its own design against the shop brand
    // cascade too. Absent (linked) → the field stays undefined (byte-stable).
    ...(doc.rec_page_design
      ? { rec_page_design: resolveDesignTokens(shopTokens, doc.rec_page_design) }
      : {}),
    product_index: productIndex,
    published_at: new Date().toISOString(),
    version: nextVersion,
    shop_domain: shop?.shopDomain ?? "",
    platform: shop?.source === "standalone" ? "standalone" : "shopify",
    ...(bakedCurrency ? { currency: bakedCurrency } : {}),
    ...(answerWeights ? { answer_weights: answerWeights } : {}),
    // LOGIC v2 — the baked target data (decider docs only; absent on every
    // legacy publish → byte-identical, pinned by the H3 harness).
    ...(targetBake
      ? { target_product_ids_map: targetBake.map, target_index: targetBake.index }
      : {}),
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
