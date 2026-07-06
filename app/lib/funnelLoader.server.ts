// BIC-2 C3b — the funnel loader payload assembly (serialized to FunnelData on
// the client). Split out of step1Funnel.server.ts as a pure move; the body of
// loadStep1FunnelData is byte-identical to the original.
import prisma from "../db.server";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { suggestQuizGoal } from "./goalSuggest";
import { detectGroupingDimension } from "./groupingDetect";
import { suggestBucketStrategy } from "./bucketDetect";
import type { BucketType } from "./step1Build.server";
import { listSavedTemplates } from "./savedTemplates.server";
import { prefetchShopWebResearch } from "./shopWebResearch.server";
import { normalizeTags } from "./enrichTags";
import { inverseCollectionIndex } from "./categoryGrouping";
import { toGroupingProduct } from "./bucketPersist.server";
import { MIN_GOAL_CHARS, loadFunnelDraft, type FunnelShop } from "./funnelDraft.server";

// The loader payload (serialized to FunnelData on the client). Pure data — the
// route wraps it in json().
export async function loadStep1FunnelData(
  shop: FunnelShop,
  quizId: string | undefined,
  opts?: { backHref?: string },
) {
  const { quiz, doc, session } = await loadFunnelDraft(shop.id, quizId);

  // FAST F1 — kick the web-research prefetch at funnel ENTRY (the research
  // inputs are shop-level, not bucket-level), so by the time the merchant
  // finishes picking buckets (typically >40s) the typing job finds it cached
  // or in flight. Fire-and-forget + internally throttled/single-flighted, so
  // repeated loader passes (action revalidations, polls, reloads) never stack
  // calls. "goal" is included for legacy in-flight drafts parked there.
  if (session.stage === "grouping" || session.stage === "goal") {
    prefetchShopWebResearch(shop.id);
  }

  const [products, collections, shopRow, categories, savedTemplates] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
    prisma.shop.findUnique({ where: { id: shop.id }, select: { brandIdentity: true } }),
    prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: {
        id: true,
        name: true,
        productIds: true,
        source: true,
        sourceRef: true,
        // description/tags/quizId widen the row to the builder's BuilderCategory
        // shape, consumed only by the gated question_builder payload below.
        description: true,
        tags: true,
        quizId: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    listSavedTemplates(shop.id),
  ]);

  const titleById = new Map(products.map((p) => [p.productId, p.title]));

  const detect = detectGroupingDimension(
    products.map(toGroupingProduct),
    collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
  );

  // Pre-computed goal suggestion so the goal stage is an approval, not a blank
  // box — derived from the brand identity + confirmed (else detected) groups,
  // mapped to the built-in templates' intent. Deterministic, no AI call.
  const identitySummary = parseBrandIdentitySafe(shopRow?.brandIdentity)?.summary ?? null;
  const suggestedGoal = suggestQuizGoal({
    identitySummary,
    groupNames: categories.length
      ? categories.map((c) => c.name)
      : detect.proposed.map((g) => g.name),
  });

  // ── Recommendation-buckets page (RB Step 1) ──────────────────────────────
  // The catalog browser, the AI bucket-strategy suggestion, and the current
  // selections — all derived from the data already in hand (no extra queries).
  const groupingProducts = products.map(toGroupingProduct);
  const groupingCollections = collections.map((c) => ({
    collectionId: c.collectionId,
    title: c.title,
  }));
  const suggestion = suggestBucketStrategy(groupingProducts, groupingCollections);

  // Tags tallied by NORMALIZED identity (so a key round-trips through
  // resolveByTag) but shown with the first raw label seen.
  const tagTally = new Map<string, { label: string; count: number }>();
  for (const p of products) {
    const seenForProduct = new Set<string>();
    for (const raw of p.tags) {
      const [norm] = normalizeTags([raw], new Set());
      if (!norm || seenForProduct.has(norm)) continue;
      seenForProduct.add(norm);
      const entry = tagTally.get(norm);
      if (entry) entry.count += 1;
      else tagTally.set(norm, { label: raw.trim() || norm, count: 1 });
    }
  }
  const catalogTags = [...tagTally.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const invIdx = inverseCollectionIndex(groupingProducts);
  const catalogCollections = collections
    .map((c) => ({
      key: c.collectionId,
      label: c.title,
      count: (invIdx.get(c.collectionId) ?? []).length,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const catalogProducts = products.map((p) => ({
    id: p.productId,
    title: p.title,
    imageUrl: p.imageUrl ?? null,
    price: p.priceMin != null ? Number(p.priceMin) : null,
    // Step-1 spec §5: the single-product preview screen shows a description
    // clamped to 3 lines — slice server-side so 100+ products don't bloat the
    // payload with full descriptions.
    description: p.descriptionText ? p.descriptionText.slice(0, 220) : null,
    // Normalized tag keys + collection ids so the results-page preview drawer
    // can list a tag/collection's members client-side (these match the bucket
    // key identities).
    tagKeys: normalizeTags(p.tags, new Set()),
    collectionIds: p.collectionIds,
  }));

  // Current selections from the quiz's Category rows. The browser only manages
  // product/tag/collection sources; legacy product_type/metafield/ai rows (from
  // a pre-RB confirm-grouping draft) are simply not shown as shelf buckets.
  const imageByProductId = new Map(products.map((p) => [p.productId, p.imageUrl ?? null]));
  const BROWSER_SOURCES = new Set(["product", "tag", "collection", "smart_collection"]);
  const buckets = categories
    .filter((c) => c.sourceRef && BROWSER_SOURCES.has(c.source))
    .map((c) => ({
      key: c.sourceRef as string,
      type: (c.source === "smart_collection" ? "collection" : c.source) as BucketType,
      name: c.name,
      count: c.productIds.length,
      thumbnailUrl:
        c.productIds.map((pid) => imageByProductId.get(pid)).find((u): u is string => Boolean(u)) ??
        null,
    }));

  const browser = session.bucket_browser;
  const activeTab: BucketType = browser?.active_tab ?? suggestion.suggestedType;
  const bannerDismissed = browser?.banner_dismissed ?? false;

  // Step-1 spec §6 (downstream integrity): selections the DRAFT already
  // references — answer target_ids + decision rules (decider docs) and points
  // keys / result-node bindings (legacy docs). Removing one of these on a
  // return visit can orphan Step-3 mappings, so the client warns first
  // (V5/V6 still catch anything broken at Step 3 — this is the courtesy).
  const referencedCategoryIds = new Set<string>();
  for (const n of doc.nodes) {
    if (n.type === "result" && n.data.category_id) referencedCategoryIds.add(n.data.category_id);
    if ("answers" in n.data && Array.isArray(n.data.answers)) {
      for (const a of n.data.answers) {
        if (a.target_id) referencedCategoryIds.add(a.target_id);
        for (const k of Object.keys(a.points ?? {})) referencedCategoryIds.add(k);
        // The dormant swapped-scoring sidecar references categories too.
        for (const k of Object.keys(a.points_alt ?? {})) referencedCategoryIds.add(k);
      }
    }
  }
  // Legacy points-mode Branch routing: the category id lives on the EDGE
  // condition (QuizEdge.condition.points_category), not on the branch node.
  for (const e of doc.edges) {
    if (e.condition?.points_category) referencedCategoryIds.add(e.condition.points_category);
  }
  for (const r of doc.decision_rules ?? []) referencedCategoryIds.add(r.target_id);
  const referencedKeys = categories
    .filter((c) => c.sourceRef && referencedCategoryIds.has(c.id))
    .map(
      (c) => `${c.source === "smart_collection" ? "collection" : c.source}:${c.sourceRef as string}`,
    );

  // A detached generation job (typing/templating) that dies mid-run — e.g. the
  // Fly machine restarts on a deploy — strands the stage forever, since the
  // in-process try/catch can't fire. Detect it: still "in flight" but the draft
  // hasn't been written in well past a real run. The "templating" stage now spans
  // BOTH template-gen AND the early question build (runAiOnboardingBuild only
  // writes draftJson at the very end), so the no-write window can reach ~75-110s;
  // 200s gives a legitimately slow build margin before we surface the re-run /
  // template escape instead of polling indefinitely.
  const genInFlight = session.stage === "typing" || session.stage === "templating";
  const genStalled =
    genInFlight && Date.now() - new Date(quiz.updatedAt).getTime() > 200_000;

  // ── Question Builder (the pre-config editing step) ───────────────────────
  // ONLY on this stage do we ship the full editable doc + the builder's
  // category/productIndex shapes, so QuestionBuilderStage can compose FlowRail +
  // ContextPanel over the SAME draftJson the main builder edits — via useQuizDraft
  // PUTting back through this route's JSON autosave branch. Gated so every other
  // stage's payload stays lean (and so this is inert until P2 sets the stage).
  // Builder-shaped catalog views, shared by the rich editing stages
  // (Question Builder + Recommendation), so both mount the SAME panels over the
  // SAME draft. Built once; each stage's payload is gated below.
  const builderCategories = categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? "",
    tags: c.tags ?? [],
    productIds: c.productIds,
    source: c.source,
    sourceRef: c.sourceRef,
    quizId: c.quizId,
  }));
  const builderProductIndex = products.map((p) => {
    const variants = (p.variants ?? []) as Array<{ inventoryQuantity?: number | null }>;
    return {
      product_id: p.productId,
      title: p.title,
      handle: p.handle,
      price: p.priceMin != null ? String(p.priceMin) : null,
      image_url: p.imageUrl,
      tags: p.tags,
      collection_ids: p.collectionIds,
      inventory_in_stock: variants.some(
        (v) => typeof v.inventoryQuantity === "number" && v.inventoryQuantity > 0,
      ),
    };
  });
  const questionBuilder =
    session.stage === "question_builder"
      ? { doc, categories: builderCategories, productIndex: builderProductIndex }
      : null;

  // ── Rec Page on the built draft ──────────────────────────────────────────
  // When the quiz is already built (re-architected flow), the Rec Page step edits
  // the RESULT NODES directly (the build baked rec_defaults onto them) rather than
  // picked_template.rec_defaults, which would no-op (the build already ran). Emit
  // the current node-level rec settings (uniform across result nodes — the build
  // applies one recOverride to all). Null → no result nodes yet (a legacy in-flight
  // draft) → RecPageStage falls back to editing picked_template.
  const firstResult = doc.nodes.find((n) => n.type === "result");
  const recNodeDefaults =
    session.stage === "rec_page" && firstResult && firstResult.type === "result"
      ? {
          max_products: firstResult.data.max_products ?? 3,
          oos_behavior: firstResult.data.oos_behavior,
        }
      : null;

  // The Recommendation step mounts the full per-bucket config editor
  // (ResultSettingsPanel + RecPageDiagram) over the SAME draft, so it needs the
  // doc + catalog shapes too — emitted only when a result node exists (a built
  // draft). Null → legacy in-flight draft → RecPageStage edits picked_template.
  const recPage =
    session.stage === "rec_page" && firstResult && firstResult.type === "result"
      ? { doc, categories: builderCategories, productIndex: builderProductIndex }
      : null;

  return {
    questionBuilder,
    recNodeDefaults,
    recPage,
    designTokens: doc.design_tokens,
    designLinked: doc.design_linked ?? true,
    recPageDesign: doc.rec_page_design ?? null,
    quizId: quiz.id,
    name: quiz.name,
    stage: session.stage,
    // LOGIC v2 (L2-10d) — the creation stamp; the Shape stage branches on it
    // (direct-only, Manual card hidden). null = a legacy in-flight draft.
    logicModel: doc.logic_model ?? null,
    minGoalChars: MIN_GOAL_CHARS,
    productCount: products.length,
    identitySummary,
    suggestedGoal,
    detection: {
      dimension: detect.dimension,
      rationale: detect.rationale,
      groups: detect.proposed.map((g) => ({
        key: g.sourceRef ?? g.name,
        name: g.name,
        count: g.productIds.length,
      })),
    },
    confirmed: session.grouping ?? null,
    goal: session.goal ?? null,
    templateOptions: session.template_options,
    pickedOptionId: session.picked_option_id ?? null,
    // ── Step 2 ──
    quizTypes: session.quiz_types,
    pickedTypeId: session.picked_type_id ?? null,
    richTemplates: session.rich_templates,
    pickedTemplate: session.picked_template ?? null,
    webResearchSummary: session.web_research_summary ?? null,
    genError: session.gen_error ?? null,
    genStalled,
    // FAST F3 — the detached jobs' honest live checkpoint (null for old
    // in-flight sessions / non-gen stages → the UI falls back to timed beats).
    genProgress: session.gen_progress ?? null,
    productGroups: categories.map((c) => ({
      id: c.id,
      name: c.name,
      // Resolve each bucket member to a readable {id,title} so the T8 editor can
      // render product toggle chips (the working copy stores GIDs only).
      products: c.productIds.map((pid) => ({ id: pid, title: titleById.get(pid) ?? pid })),
    })),
    collections: collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
    savedTemplates: savedTemplates.map((t) => ({ id: t.id, name: t.name, template: t.template })),
    // ── Recommendation Buckets (RB Step 1) ──
    catalog: { products: catalogProducts, tags: catalogTags, collections: catalogCollections },
    suggestion,
    buckets,
    activeTab,
    bannerDismissed,
    referencedKeys,
    backHref: opts?.backHref ?? "/studio/quizzes",
  };
}
