import {
  json,
  redirect,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { Quiz, BuildSession, DesignDials, RecDefaults, DesignTokens, QuizType } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { suggestQuizGoal } from "./goalSuggest";
import { detectGroupingDimension } from "./groupingDetect";
import { suggestBucketStrategy } from "./bucketDetect";
import { recordIdentitySignals } from "./brandIdentityBuild.server";
import {
  persistConfirmedGroups,
  loadConfirmedBuckets,
  resyncCatalogForShop,
  startStep1Build,
  bucketRowFor,
  bucketRowsFor,
  addBuckets,
  removeBuckets,
  clearBuckets,
  type BucketType,
} from "./step1Build.server";
import {
  startStep2Types,
  startStep2Templates,
  initPickedTemplate,
  startStep2Build,
} from "./step2Build.server";
import { saveTemplate, listSavedTemplates, loadSavedTemplate } from "./savedTemplates.server";
import {
  MAX_LOGO_BYTES,
  isAllowedLogoType,
  isSafeLogoUrl,
  LOGO_SIZES,
  LOGO_ALIGNS,
} from "./logoUpload";
import { DEFAULT_TOKENS } from "./designTokens";
import { applyBrandToDesign } from "./brandSync";
import { normalizeTags } from "./enrichTags";
import {
  inverseCollectionIndex,
  hydrateCollectionProducts,
  type GroupingProduct,
  type GroupingCollection,
} from "./categoryGrouping";

// Builder Re-work Step 1 — the funnel's loader + action, lifted out of the route
// so the studio (cookie) and embedded (Shopify admin) routes are thin wrappers
// over ONE shop-scoped implementation. Mirrors the `*ForShop` editor-IO seam:
// each route resolves its own shop + builder URL, the logic lives here.

// Minimum goal characters before the merchant can generate. Shared by the action
// (the gate) and the component (the QzProgress bar, via loader data).
export const MIN_GOAL_CHARS = 24;

type FunnelShop = Pick<Shop, "id" | "shopDomain">;

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

// Load the catalog as bucket-resolution inputs (products + hydrated collections
// + title lookups). Used by the continuous-save bucket intents to re-resolve
// membership server-side — the client never sends product ids.
async function loadBucketInputs(shopId: string): Promise<{
  products: GroupingProduct[];
  collections: GroupingCollection[];
  productTitleById: Map<string, string>;
  collectionTitleById: Map<string, string>;
}> {
  const [productRows, collectionRows] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId }, select: { collectionId: true, title: true } }),
  ]);
  const products = productRows.map(toGroupingProduct);
  return {
    products,
    collections: hydrateCollectionProducts(collectionRows, products),
    productTitleById: new Map(productRows.map((p) => [p.productId, p.title])),
    collectionTitleById: new Map(collectionRows.map((c) => [c.collectionId, c.title])),
  };
}

// The funnel's front door: resume the most-recent in-flight Step-1 draft for this
// shop, or seed a fresh one. Returns the quiz id; each entry route redirects to
// its own nested funnel path (/studio/onboarding/:id or /app/onboarding/:id).
export async function findOrCreateStep1Draft(shopId: string): Promise<string> {
  // Resume the most recent GENUINELY in-flight funnel draft. A step1 draft whose
  // build already completed (session.built) or that reached a terminal stage is a
  // finished quiz that didn't graduate — graduate it now (buildState → null, so it
  // leaves the funnel + appears in the gallery) and keep looking. This both fixes
  // the "Create new quiz drops you back in the builder" bug and self-heals any
  // pre-existing stuck drafts.
  const candidates = await prisma.quiz.findMany({
    where: { shopId, buildState: "step1" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, draftJson: true },
    take: 24,
  });
  let resumeId: string | null = null;
  for (const c of candidates) {
    const parsed = Quiz.safeParse(c.draftJson);
    const session = parsed.success ? parsed.data.build_session : undefined;
    const finished = session?.built === true || session?.stage === "done" || session?.stage === "generate";
    if (finished) {
      // Graduate EVERY finished draft (not just the newest), so a finished quiz
      // sitting behind a newer in-flight one still leaves the funnel + shows up in
      // the gallery.
      await prisma.quiz
        .update({ where: { id: c.id }, data: { buildState: null } })
        .catch(() => {});
    } else if (!resumeId) {
      resumeId = c.id; // the newest genuinely mid-funnel draft → resume it
    }
  }
  if (resumeId) return resumeId;

  const doc = Quiz.parse({ ...buildSeedQuiz("New quiz"), build_session: { stage: "grouping" } });
  const created = await prisma.quiz.create({
    data: {
      shopId,
      name: "New quiz",
      status: "draft",
      buildState: "step1",
      draftJson: doc as never,
    },
    select: { id: true },
  });
  return created.id;
}

// Load the owned draft + its parsed doc + build_session. Throws a 404 Response
// when the quiz isn't this shop's (or doesn't parse).
async function loadFunnelDraft(shopId: string, quizId: string | undefined) {
  if (!quizId) throw new Response("Not found", { status: 404 });
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, shopId },
    select: { id: true, name: true, draftJson: true, buildState: true, updatedAt: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  const parsed = Quiz.safeParse(quiz.draftJson);
  if (!parsed.success) throw new Response("Draft is not readable", { status: 422 });
  // BuildSession.parse({}) fills every default (stage:"grouping" + all arrays),
  // so this stays correct as Step-2 fields accrete.
  const session: BuildSession = parsed.data.build_session ?? BuildSession.parse({});
  return { quiz, doc: parsed.data, session };
}

// Re-parse before writing so an invalid mutation can never land (build_session is
// scratch state — we write draftJson directly, no publish path).
async function writeDoc(quizId: string, doc: Quiz) {
  await prisma.quiz.update({
    where: { id: quizId },
    data: { draftJson: Quiz.parse(doc) as never },
  });
}

// The loader payload (serialized to FunnelData on the client). Pure data — the
// route wraps it in json().
export async function loadStep1FunnelData(
  shop: FunnelShop,
  quizId: string | undefined,
  opts?: { backHref?: string },
) {
  const { quiz, doc, session } = await loadFunnelDraft(shop.id, quizId);

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
    // Normalized tag keys + collection ids so the ProductPreviewDrawer can list a
    // tag/collection's members client-side (these match the bucket key identities).
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
    backHref: opts?.backHref ?? "/studio/quizzes",
  };
}

// The funnel's action — every stage transition. `builderPath` is surface-specific
// (studio → /studio/:id?mode=ai, embedded → /app/quizzes/:id/studio?mode=ai) so
// the pick hand-off lands in the right builder.
export async function runStep1FunnelAction(
  shop: FunnelShop,
  quizId: string | undefined,
  request: Request,
  opts: { builderPath: (quizId: string) => string },
): Promise<Response> {
  const { quiz, doc, session } = await loadFunnelDraft(shop.id, quizId);

  // JSON PUT autosave — the question_builder editing step. useQuizDraft PUTs the
  // live doc here exactly as it does against the main editor route; mirror that
  // seam (quizEditorIO.server.ts): Quiz-gate, write draftJson, leave the stage
  // untouched. The doc still carries build_session (it round-trips through the
  // client unmodified), so the stage is preserved by the write. MUST run BEFORE
  // request.formData() — a JSON body has no form fields to read.
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { doc: unknown };
    const parsed = Quiz.safeParse(body.doc);
    if (!parsed.success) {
      return json(
        { ok: false, error: "Invalid quiz document", issues: parsed.error.issues.slice(0, 5) },
        { status: 400 },
      );
    }
    // Autosave persists DOC CONTENT only. build_session / stage is owned by the
    // navigation intents — so we keep the SERVER's current session, never the
    // client doc's. This makes a debounced PUT that races a stage transition
    // safe in EITHER order: the PUT can never rewind the stage, and the merchant's
    // last edit is preserved whichever request lands last.
    await prisma.quiz.update({
      where: { id: quiz.id },
      data: { draftJson: Quiz.parse({ ...parsed.data, build_session: session }) as never },
    });
    return json({ ok: true, savedAt: new Date().toISOString() });
  }

  // Logo upload is the only multipart body. Parse it with a memory handler
  // capped per-part at MAX_LOGO_BYTES — this STREAMS and aborts past the cap
  // regardless of the content-length header (a chunked/absent header can't
  // bypass it), so memory is bounded before the precise size check below.
  let form: FormData;
  if (contentType.includes("multipart/form-data")) {
    try {
      form = await unstable_parseMultipartFormData(
        request,
        unstable_createMemoryUploadHandler({ maxPartSize: MAX_LOGO_BYTES }),
      );
    } catch {
      return json({ ok: false, error: "Logo too large (max 2 MB)." }, { status: 413 });
    }
  } else {
    form = await request.formData();
  }
  const intent = String(form.get("intent") ?? "");

  if (intent === "resync") {
    const res = await resyncCatalogForShop(shop.shopDomain);
    return json({ intent, ...res });
  }

  if (intent === "confirm-grouping") {
    const mode = String(form.get("mode") ?? "detected");
    const selected = String(form.get("selected") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const detect = detectGroupingDimension(
      (await prisma.product.findMany({ where: { shopId: shop.id } })).map(toGroupingProduct),
      (await prisma.collection.findMany({ where: { shopId: shop.id } })).map((c) => ({
        collectionId: c.collectionId,
        title: c.title,
      })),
    );

    const useAll = mode === "all" || detect.dimension === "all";
    const groups = useAll
      ? []
      : detect.proposed.filter((g) => selected.includes(g.sourceRef ?? g.name));
    const dimension = useAll || groups.length === 0 ? "all" : detect.dimension;

    const ids = await persistConfirmedGroups(shop.id, quiz.id, dimension, groups);
    const next: BuildSession = {
      ...session,
      stage: "goal",
      grouping: {
        dimension,
        confirmed_category_ids: ids,
        detected_rationale: detect.rationale,
      },
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  // ── Recommendation Buckets (RB Step 1) — continuous-save bucket browser ───
  // Membership is always re-resolved server-side; the client only sends WHICH
  // key(s) were toggled (the persistConfirmedGroups trust boundary).
  if (intent === "toggle-bucket" || intent === "select-all" || intent === "clear-visible") {
    const rawType = String(form.get("type") ?? "");
    if (rawType !== "product" && rawType !== "tag" && rawType !== "collection") {
      return json({ intent, ok: false, error: "Unknown bucket type." }, { status: 400 });
    }
    const type: BucketType = rawType;

    if (intent === "toggle-bucket") {
      const key = String(form.get("key") ?? "").trim();
      const on = String(form.get("on") ?? "") === "true";
      if (!key) return json({ intent, ok: false, error: "Missing bucket key." }, { status: 400 });
      if (!on) {
        await removeBuckets(shop.id, quiz.id, type, [key]);
        return json({ intent, ok: true });
      }
      const inputs = await loadBucketInputs(shop.id);
      const row = bucketRowFor(
        type,
        key,
        inputs.products,
        inputs.collections,
        inputs.productTitleById,
        inputs.collectionTitleById,
      );
      if (!row) {
        return json({ intent, ok: false, error: "That item is no longer available." }, { status: 400 });
      }
      await addBuckets(shop.id, quiz.id, [row]);
      return json({ intent, ok: true });
    }

    // select-all / clear-visible — the client sends the visible (filtered) keys.
    const keys = String(form.get("keys") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (intent === "clear-visible") {
      await removeBuckets(shop.id, quiz.id, type, keys);
      return json({ intent, ok: true });
    }
    const inputs = await loadBucketInputs(shop.id);
    const rows = bucketRowsFor(
      keys.map((key) => ({ type, key })),
      inputs.products,
      inputs.collections,
      inputs.productTitleById,
      inputs.collectionTitleById,
    );
    await addBuckets(shop.id, quiz.id, rows);
    return json({ intent, ok: true });
  }

  if (intent === "switch-tab") {
    const rawType = String(form.get("type") ?? "");
    if (rawType !== "product" && rawType !== "tag" && rawType !== "collection") {
      return json({ intent, ok: false, error: "Unknown bucket type." }, { status: 400 });
    }
    // A type change with existing buckets clears them (the client only sends
    // clear=true after the TabLockModal confirm).
    if (String(form.get("clear") ?? "") === "true") await clearBuckets(shop.id, quiz.id);
    // A non-suggested tab click also dismisses the AI banner — folded in here so
    // one submit does both (a single fetcher can't fire two intents).
    const dismiss = String(form.get("dismiss") ?? "") === "true";
    const browser = session.bucket_browser;
    const next: BuildSession = {
      ...session,
      bucket_browser: {
        ...(browser ?? {}),
        active_tab: rawType,
        banner_dismissed: dismiss || (browser?.banner_dismissed ?? false),
      },
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  if (intent === "dismiss-banner") {
    const browser = session.bucket_browser;
    const next: BuildSession = {
      ...session,
      bucket_browser: { ...(browser ?? {}), banner_dismissed: true },
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  // Continue → advance to the goal stage (relabeled "Step 2" in the UI). The
  // bucket rows ARE the confirmed grouping; dimension reflects the active tab.
  if (intent === "continue-buckets") {
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    if (cats.length === 0) {
      return json(
        { intent, ok: false, error: "Add at least one recommendation bucket to continue." },
        { status: 400 },
      );
    }
    const tab = session.bucket_browser?.active_tab;
    const dimension = tab === "tag" ? "tag" : tab === "collection" ? "collection" : "all";

    // Re-sequenced flow (owner): Buckets → Shape DIRECTLY (no standalone Goal step).
    // Derive the goal automatically from the brand identity + confirmed buckets —
    // the same deterministic suggestion the old Goal stage pre-filled — and kick the
    // tier-1 type generation now, so Shape loads with the 2 AI template options. The
    // merchant can still override via Shape's "write your goal" card (shape-goal-build).
    const shopRow = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { brandIdentity: true },
    });
    const suggestedGoal = suggestQuizGoal({
      identitySummary: parseBrandIdentitySafe(shopRow?.brandIdentity)?.summary ?? null,
      groupNames: cats.map((c) => c.name),
    });
    const next: BuildSession = {
      ...session,
      stage: "typing",
      grouping: {
        dimension,
        confirmed_category_ids: cats.map((c) => c.id),
        detected_rationale: "Selected in the recommendation buckets browser.",
      },
      goal: { goal_text: suggestedGoal, struggle_text: "" },
      gen_error: undefined,
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    const buckets = await loadConfirmedBuckets(shop.id, quiz.id);
    startStep2Types(shop.id, quiz.id, {
      goal: suggestedGoal,
      ...(buckets.length ? { buckets } : {}),
    });
    return json({ intent, ok: true });
  }

  if (intent === "save-goal") {
    const goal = String(form.get("goal") ?? "").trim().slice(0, 500);
    const struggle = String(form.get("struggle") ?? "").trim().slice(0, 500);
    if (goal.length < MIN_GOAL_CHARS) {
      return json(
        { intent, ok: false, error: `Add a little more detail (at least ${MIN_GOAL_CHARS} characters).` },
        { status: 400 },
      );
    }

    // Fold the struggle into the brand identity (locks pain_points so it survives
    // future re-syncs) — an enhancement, never a blocker: ignore its result.
    if (struggle) await recordIdentitySignals(shop.id, { struggle, goal });

    // Step 2 — enter the transient "typing" stage and kick the DETACHED tier-1
    // job (web research + quiz types; ~70s, outruns the edge window). The funnel
    // polls until the job writes stage:"types".
    const buckets = await loadConfirmedBuckets(shop.id, quiz.id);
    const next: BuildSession = {
      ...session,
      stage: "typing",
      goal: { goal_text: goal, struggle_text: struggle },
      gen_error: undefined, // clear any prior failure — this is a fresh attempt
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    startStep2Types(shop.id, quiz.id, {
      goal,
      ...(struggle ? { struggle } : {}),
      ...(buckets.length ? { buckets } : {}),
    });
    return json({ intent, ok: true });
  }

  if (intent === "pick") {
    const optionId = String(form.get("optionId") ?? "");
    const chosen = session.template_options.find((o) => o.id === optionId);
    if (!chosen) {
      return json({ intent, ok: false, error: "That direction is no longer available." }, { status: 400 });
    }
    if (!session.goal?.goal_text) {
      return json({ intent, ok: false, error: "Add a goal before building." }, { status: 400 });
    }
    // Kick the detached full build (renames the draft, flips buildState →
    // "building", consumes the confirmed buckets + the picked direction) and hand
    // off to the editor, whose polling overlay swaps in the built quiz.
    await startStep1Build(shop.id, quiz.id, chosen, session);
    return redirect(opts.builderPath(quiz.id));
  }

  // ── Step 2 intents ──────────────────────────────────────────────────────
  if (intent === "pick-type") {
    const typeId = String(form.get("typeId") ?? "");
    const chosen = session.quiz_types.find((t) => t.id === typeId);
    if (!chosen) return json({ intent, ok: false, error: "That type is no longer available." }, { status: 400 });
    const goal = session.goal?.goal_text ?? "";
    const struggle = session.goal?.struggle_text ?? "";
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, tags: true },
    });
    const next: BuildSession = { ...session, stage: "templating", picked_type_id: typeId, gen_error: undefined };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    startStep2Templates(shop.id, quiz.id, chosen, {
      goal,
      ...(struggle ? { struggle } : {}),
      ...(cats.length ? { buckets: cats } : {}),
    });
    return json({ intent, ok: true });
  }

  // Shape-Your-Quiz spec — the four-card page's AI-card "Continue": capture the
  // required scoring model + the card's experience type onto the doc, then run
  // the SAME type→templates build as pick-type. Scoring is required (the spec
  // pre-selects nothing).
  if (intent === "shape-continue") {
    const typeId = String(form.get("typeId") ?? "");
    const scoring = String(form.get("scoring") ?? "");
    if (scoring !== "direct" && scoring !== "weighted") {
      return json({ intent, ok: false, error: "Pick how to score this quiz first." }, { status: 400 });
    }
    const chosen = session.quiz_types.find((t) => t.id === typeId);
    if (!chosen) return json({ intent, ok: false, error: "That type is no longer available." }, { status: 400 });
    const goal = session.goal?.goal_text ?? "";
    const struggle = session.goal?.struggle_text ?? "";
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, tags: true },
    });
    const next: BuildSession = { ...session, stage: "templating", picked_type_id: typeId, gen_error: undefined };
    await writeDoc(quiz.id, {
      ...doc,
      scoring_model: scoring,
      experience_type: chosen.experience_type,
      build_session: next,
    });
    startStep2Templates(shop.id, quiz.id, chosen, {
      goal,
      ...(struggle ? { struggle } : {}),
      ...(cats.length ? { buckets: cats } : {}),
    });
    return json({ intent, ok: true });
  }

  // Shape spec — the "write your goal" card's "Continue": BUILD the quiz straight
  // from the merchant's typed goal (no chosen template). Synthesize a minimal
  // QuizType from the goal and run the SAME templates→build chain as the AI cards,
  // so the AI generates the questions/mapping FROM the goal. Scoring defaults to
  // "weighted" (the merchant can switch it later in the Question Builder).
  if (intent === "shape-goal-build") {
    const goal = String(form.get("goal") ?? "").trim().slice(0, 500);
    if (goal.length < MIN_GOAL_CHARS) {
      return json(
        { intent, ok: false, error: `Add a little more detail (at least ${MIN_GOAL_CHARS} characters).` },
        { status: 400 },
      );
    }
    const scoring = String(form.get("scoring") ?? "") === "direct" ? "direct" : "weighted";
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, tags: true },
    });
    const syntheticType = QuizType.parse({
      id: "custom-goal",
      experience_type: "product_match",
      name: "Your goal",
      achieves: goal.slice(0, 160),
      question_range: { min: 4, max: 7 },
    });
    const struggle = session.goal?.struggle_text ?? "";
    const next: BuildSession = {
      ...session,
      stage: "templating",
      goal: { goal_text: goal, struggle_text: struggle },
      gen_error: undefined,
    };
    await writeDoc(quiz.id, {
      ...doc,
      scoring_model: scoring,
      experience_type: "product_match",
      build_session: next,
    });
    startStep2Templates(shop.id, quiz.id, syntheticType, {
      goal,
      ...(struggle ? { struggle } : {}),
      ...(cats.length ? { buckets: cats } : {}),
    });
    return json({ intent, ok: true });
  }

  // Shape spec — "↻ Regenerate suggestions": re-run the tier-1 type generation
  // for a fresh pair of directions (mirrors save-goal's typing kick).
  if (intent === "shape-regenerate") {
    const buckets = await loadConfirmedBuckets(shop.id, quiz.id);
    const next: BuildSession = { ...session, stage: "typing", quiz_types: [], gen_error: undefined };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    startStep2Types(shop.id, quiz.id, {
      goal: session.goal?.goal_text ?? "",
      ...(session.goal?.struggle_text ? { struggle: session.goal.struggle_text } : {}),
      ...(buckets.length ? { buckets } : {}),
    });
    return json({ intent, ok: true });
  }

  // Shape spec — Card 4 "Manual Create": skip AI generation and go straight to
  // the Question Builder with the seed quiz. Scoring stays UNSET so the builder
  // prompts for it (per the question-builder spec's manual-create flow).
  if (intent === "shape-manual") {
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "done" } });
    // Manual Create leaves the funnel for the builder — graduate it out of "step1"
    // so it shows in the gallery and "Create new quiz" starts fresh (see above).
    await prisma.quiz.update({ where: { id: quiz.id }, data: { buildState: null } });
    return redirect(opts.builderPath(quiz.id));
  }

  if (intent === "retry-gen") {
    // Re-kick a stalled generation: the prior detached job died (e.g. a server
    // restart mid-run) leaving the stage stuck with no error to catch. Rebuild
    // the inputs from the persisted build_session and re-run the SAME detached
    // job; writeDoc resets updatedAt so the stall clears. If the AI genuinely
    // fails this time, the job's own catch sets gen_error (the honest "didn't
    // finish" banner + template escape).
    if (session.stage === "typing") {
      const retryBuckets = await loadConfirmedBuckets(shop.id, quiz.id);
      await writeDoc(quiz.id, { ...doc, build_session: { ...session, gen_error: undefined } });
      startStep2Types(shop.id, quiz.id, {
        goal: session.goal?.goal_text ?? "",
        ...(session.goal?.struggle_text ? { struggle: session.goal.struggle_text } : {}),
        ...(retryBuckets.length ? { buckets: retryBuckets } : {}),
      });
      return json({ intent, ok: true });
    }
    if (session.stage === "templating") {
      const retryType = session.quiz_types.find((t) => t.id === session.picked_type_id);
      if (retryType) {
        const retryCats = await prisma.category.findMany({
          where: { shopId: shop.id, quizId: quiz.id },
          select: { id: true, name: true, tags: true },
        });
        await writeDoc(quiz.id, { ...doc, build_session: { ...session, gen_error: undefined } });
        startStep2Templates(shop.id, quiz.id, retryType, {
          goal: session.goal?.goal_text ?? "",
          ...(session.goal?.struggle_text ? { struggle: session.goal.struggle_text } : {}),
          ...(retryCats.length ? { buckets: retryCats } : {}),
        });
        return json({ intent, ok: true });
      }
    }
    return json({ intent, ok: false, error: "Nothing to retry — start over from the quiz list." }, { status: 400 });
  }

  if (intent === "pick-template") {
    const templateId = String(form.get("templateId") ?? "");
    const rich = session.rich_templates.find((t) => t.id === templateId);
    if (!rich) return json({ intent, ok: false, error: "That template is no longer available." }, { status: 400 });
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, productIds: true },
      orderBy: { createdAt: "asc" },
    });
    const picked = initPickedTemplate(
      rich,
      cats.map((c) => ({ id: c.id, name: c.name, product_ids: c.productIds })),
      new Date(),
    );
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, picked_template: picked } });
    return json({ intent, ok: true });
  }

  // Reuse a saved template — skip the AI tiers entirely. Loads the stored
  // RichTemplateOption, seeds it as the sole tier-2 option + an auto-named working
  // copy, and jumps straight to the battle card (stage "configuring").
  if (intent === "use-saved-template") {
    const templateId = String(form.get("templateId") ?? "");
    const rich = await loadSavedTemplate(shop.id, templateId);
    if (!rich) return json({ intent, ok: false, error: "That saved template is no longer available." }, { status: 400 });
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, productIds: true },
      orderBy: { createdAt: "asc" },
    });
    const picked = initPickedTemplate(
      rich,
      cats.map((c) => ({ id: c.id, name: c.name, product_ids: c.productIds })),
      new Date(),
    );
    await writeDoc(quiz.id, {
      ...doc,
      build_session: { ...session, stage: "configuring", rich_templates: [rich], picked_template: picked },
    });
    return json({ intent, ok: true });
  }

  // Autosave setters — all require a picked template.
  if (
    intent === "set-dials" ||
    intent === "set-rec" ||
    intent === "set-name" ||
    intent === "toggle-group" ||
    intent === "toggle-product"
  ) {
    const picked = session.picked_template;
    if (!picked) return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    let nextPicked = picked;

    if (intent === "set-dials") {
      const parsed = DesignDials.safeParse(safeJson(form.get("dials")));
      if (!parsed.success) return json({ intent, ok: false, error: "bad dials" }, { status: 400 });
      nextPicked = { ...picked, design_dials: parsed.data };
    } else if (intent === "set-rec") {
      const parsed = RecDefaults.safeParse(safeJson(form.get("rec")));
      if (!parsed.success) return json({ intent, ok: false, error: "bad rec" }, { status: 400 });
      nextPicked = { ...picked, rec_defaults: parsed.data };
    } else if (intent === "set-name") {
      const name = String(form.get("name") ?? "").trim().slice(0, 120);
      if (!name) return json({ intent, ok: false, error: "Name can't be empty." }, { status: 400 });
      nextPicked = { ...picked, quiz_name: name };
    } else if (intent === "toggle-group") {
      const groupId = String(form.get("groupId") ?? "");
      const enabled = String(form.get("enabled") ?? "") === "true";
      nextPicked = {
        ...picked,
        recommended_groups: picked.recommended_groups.map((g) =>
          g.group_id === groupId ? { ...g, enabled } : g,
        ),
      };
    } else {
      // toggle-product
      const groupId = String(form.get("groupId") ?? "");
      const productId = String(form.get("productId") ?? "");
      const enabled = String(form.get("enabled") ?? "") === "true";
      nextPicked = {
        ...picked,
        recommended_groups: picked.recommended_groups.map((g) => {
          if (g.group_id !== groupId) return g;
          const set = new Set(g.product_ids);
          if (enabled) set.add(productId);
          else set.delete(productId);
          return { ...g, product_ids: Array.from(set) };
        }),
      };
    }

    await writeDoc(quiz.id, { ...doc, build_session: { ...session, picked_template: nextPicked } });
    return json({ intent, ok: true });
  }

  // Rec Page on a BUILT draft — patch products-per-result + OOS behavior onto
  // EVERY result node (the build baked these uniformly; this is the merchant's
  // edit on the real nodes, not picked_template.rec_defaults which would no-op
  // post-build). Validated against RecDefaults; only max_products + oos_behavior
  // are applied (fallback stays untouched — the no-fit-→-no-products goal).
  if (intent === "set-result-rec") {
    const parsed = RecDefaults.safeParse(safeJson(form.get("rec")));
    if (!parsed.success) return json({ intent, ok: false, error: "bad rec" }, { status: 400 });
    const { max_products, oos_behavior } = parsed.data;
    const nodes = doc.nodes.map((n) =>
      n.type === "result"
        ? { ...n, data: { ...n.data, max_products, oos_behavior } }
        : n,
    );
    await writeDoc(quiz.id, { ...doc, nodes });
    return json({ intent, ok: true });
  }

  if (intent === "save-template") {
    const picked = session.picked_template;
    if (!picked) return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    const rich = session.rich_templates.find((t) => t.id === picked.template_id);
    if (!rich) return json({ intent, ok: false, error: "Template not found." }, { status: 400 });
    // Persist the merchant's edited template for reuse.
    await saveTemplate(shop.id, picked.quiz_name, {
      ...rich,
      dials: picked.design_dials,
      rec_defaults: picked.rec_defaults,
      question_count: picked.question_count,
    });
    await writeDoc(quiz.id, {
      ...doc,
      build_session: { ...session, picked_template: { ...picked, saved_as_template: true } },
    });
    return json({ intent, ok: true });
  }

  // Advance to the Design step (theme picker). Reached from Rec Page "Continue →"
  // (the re-architected order: Question Builder → Rec Page → Design) and Overview
  // "← Back".
  if (intent === "to-design") {
    if (!session.picked_template) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "design" } });
    return json({ intent, ok: true });
  }

  // Rec Page "← Back": return to the Question Builder editing step. The draft is
  // already built (question nodes present), so this is a pure stage change.
  if (intent === "to-question-builder") {
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "question_builder" } });
    return json({ intent, ok: true });
  }

  // Design "Continue →": advance to the Recommendation Page step (rec settings).
  if (intent === "to-rec-page") {
    if (!session.picked_template) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "rec_page" } });
    return json({ intent, ok: true });
  }

  // Design step — apply a theme preset's tokens to the draft. The build threads
  // doc.design_tokens as its base, so this survives generation. Validated against
  // the DesignTokens schema (the tokens come from the client).
  if (intent === "set-design") {
    const parsed = DesignTokens.safeParse(safeJson(form.get("tokens")));
    if (!parsed.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, design_tokens: parsed.data });
    return json({ intent, ok: true });
  }

  // Design step — patch ONE whitelisted design-token field (shape / button style)
  // onto the draft, merged into the current tokens (so it layers on the chosen
  // preset). The build threads design_tokens, so these survive generation.
  if (intent === "set-design-field") {
    const field = String(form.get("field") ?? "");
    const value = String(form.get("value") ?? "");
    const ALLOWED: Record<string, readonly string[]> = {
      radius: ["square", "rounded", "pill"],
      button_style: ["filled", "outline", "ghost"],
    };
    if (!(field in ALLOWED) || !ALLOWED[field]!.includes(value)) {
      return json({ intent, ok: false, error: "Invalid design option." }, { status: 400 });
    }
    const merged = DesignTokens.safeParse({ ...doc.design_tokens, [field]: value });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, design_tokens: merged.data });
    return json({ intent, ok: true });
  }

  // Design step §3 — the Style Bar (image density / lines / spacing, 0-100).
  // Merged onto the chosen template's tokens so the sliders fine-tune it; the
  // runtime applies them via the --qz-radius/--qz-pad/--qz-image-density vars.
  if (intent === "set-style-bar") {
    const parsed = DesignTokens.shape.style_bar.safeParse(safeJson(form.get("style_bar")));
    if (!parsed.success) {
      return json({ intent, ok: false, error: "Invalid style bar." }, { status: 400 });
    }
    await writeDoc(quiz.id, {
      ...doc,
      design_tokens: {
        ...doc.design_tokens,
        style_bar: { ...doc.design_tokens.style_bar, ...parsed.data },
      },
    });
    return json({ intent, ok: true });
  }

  // Design step §1 — Brand Identity color. §5: a `scope` of "rec_page" (only when
  // de-linked) edits the rec page's own design instead of the quiz's.
  if (intent === "set-design-color") {
    const key = String(form.get("key") ?? "");
    const value = String(form.get("value") ?? "");
    const ALLOWED = ["primary", "background", "text", "accent", "secondary", "muted"];
    if (!ALLOWED.includes(key) || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      return json({ intent, ok: false, error: "Invalid color." }, { status: 400 });
    }
    const { base, write } = designScopeTarget(doc, form);
    const merged = DesignTokens.safeParse({ ...base, colors: { ...base.colors, [key]: value } });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §1 — Brand Identity font (merge a curated family into a typography
  // slot). §5: a "rec_page" scope (de-linked only) targets the rec page's design.
  if (intent === "set-design-font") {
    const slot = String(form.get("slot") ?? "");
    const family = String(form.get("family") ?? "").trim();
    if (!["heading", "body"].includes(slot) || !family) {
      return json({ intent, ok: false, error: "Invalid font." }, { status: 400 });
    }
    const { base, write } = designScopeTarget(doc, form);
    const typo = (base.typography ?? {}) as Record<string, unknown>;
    const slotTokens = (typo[slot] ?? {}) as Record<string, unknown>;
    const merged = DesignTokens.safeParse({
      ...base,
      typography: { ...typo, [slot]: { ...slotTokens, family, source: "google" } },
    });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §5 — Quiz↔Rec-Page design LINK. De-link seeds rec_page_design from
  // the quiz design (starts identical, then the rec scope diverges); re-link clears
  // it (the UI confirms first). Result/end nodes render from rec_page_design when
  // de-linked (QuizRuntime §5).
  if (intent === "set-design-linked") {
    const linked = String(form.get("linked") ?? "") === "true";
    if (linked) {
      const { rec_page_design: _drop, ...rest } = doc;
      await writeDoc(quiz.id, { ...rest, design_linked: true } as Quiz);
    } else {
      const seeded = doc.rec_page_design ?? doc.design_tokens;
      await writeDoc(quiz.id, { ...doc, design_linked: false, rec_page_design: seeded });
    }
    return json({ intent, ok: true });
  }

  // Design step §1 — Brand Identity LOGO. Three shapes share this intent:
  //  • clear=1            → remove the logo (no header renders)
  //  • a `logo` File      → uploaded image, stored as a base64 data URL
  //  • a `url` string     → pasted https asset (lightweight alternative)
  //  • size / align only  → adjust the existing logo's header rendering
  // Stored on design_tokens.logo so it cascades + survives the build/publish.
  if (intent === "set-design-logo") {
    const { base, write } = designScopeTarget(doc, form);
    const current = (base.logo ?? {}) as {
      url?: string;
      size?: string;
      align?: string;
    };

    // Remove the logo entirely.
    if (String(form.get("clear") ?? "") === "1") {
      const { logo: _drop, ...rest } = base;
      const merged = DesignTokens.safeParse(rest);
      if (!merged.success) {
        return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
      }
      await writeDoc(quiz.id, write(merged.data));
      return json({ intent, ok: true });
    }

    // Resolve the new URL: an uploaded file wins, else a pasted URL, else keep
    // the existing one (a size/align-only update).
    let nextUrl = current.url;
    const file = form.get("logo");
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const f = file as File;
      if (!isAllowedLogoType(f.type)) {
        return json(
          { intent, ok: false, error: "Use a PNG, JPG, SVG, WEBP or GIF image." },
          { status: 400 },
        );
      }
      if (f.size === 0 || f.size > MAX_LOGO_BYTES) {
        return json({ intent, ok: false, error: "Logo must be 1 byte–2 MB." }, { status: 400 });
      }
      const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
      nextUrl = `data:${f.type.toLowerCase()};base64,${b64}`;
    } else {
      const pasted = String(form.get("url") ?? "").trim();
      if (pasted) {
        if (!isSafeLogoUrl(pasted)) {
          return json(
            { intent, ok: false, error: "Logo URL must be an https or data:image link." },
            { status: 400 },
          );
        }
        nextUrl = pasted;
      }
    }

    // size / align (optional; default the unset side when a logo first appears).
    const sizeIn = String(form.get("size") ?? "");
    const alignIn = String(form.get("align") ?? "");
    const size =
      (LOGO_SIZES as readonly string[]).includes(sizeIn) ? sizeIn : (current.size ?? "md");
    const align =
      (LOGO_ALIGNS as readonly string[]).includes(alignIn) ? alignIn : (current.align ?? "center");

    if (!nextUrl) {
      return json({ intent, ok: false, error: "No logo provided." }, { status: 400 });
    }

    const merged = DesignTokens.safeParse({
      ...base,
      logo: { url: nextUrl, size, align },
    });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid logo." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §1 — Reset to system default (the merchant confirms in the UI).
  // §5: scope-aware — resets the rec page's own design when de-linked + rec scope,
  // else the quiz design. (Must match the scoped Brand Identity panel it lives in,
  // or Reset would silently wipe the quiz while the merchant edits the rec page.)
  if (intent === "reset-design") {
    const { write } = designScopeTarget(doc, form);
    const merged = DesignTokens.safeParse(JSON.parse(JSON.stringify(DEFAULT_TOKENS)));
    if (!merged.success) {
      return json({ intent, ok: false, error: "Reset failed." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §1 — Re-sync from Shopify: overlay the shop's brand (colors /
  // fonts / logo persisted in shop.brandTokens at install by themeSync). §5: same
  // scope as the panel — applies to the rec page's design when editing it.
  if (intent === "resync-design") {
    const { base, write } = designScopeTarget(doc, form);
    const shopRow = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { brandTokens: true },
    });
    const brand = DesignTokens.safeParse(shopRow?.brandTokens ?? {});
    const { next, applied } = applyBrandToDesign(base, brand.success ? brand.data : {});
    if (applied.length === 0) {
      return json(
        {
          intent,
          ok: false,
          error: "No Shopify brand found yet — connect your store or set colors above.",
        },
        { status: 400 },
      );
    }
    const merged = DesignTokens.safeParse(next);
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid brand." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true, applied });
  }

  // Design step §4 — Per-Quiz Formatting. One intent for every formatting token:
  // answer_layout / answer_grid_columns (D4a), progress_bar (D4b),
  // question_image_position (D4c). Each merges into design_tokens; unset tokens
  // never get written, so a quiz stays byte-stable until the merchant opts in.
  if (intent === "set-format") {
    const key = String(form.get("key") ?? "");
    let patch: Record<string, unknown> | null = null;
    if (key === "answer_layout") {
      const v = String(form.get("value") ?? "");
      if (!["grid", "list", "auto"].includes(v)) {
        return json({ intent, ok: false, error: "Invalid answer layout." }, { status: 400 });
      }
      patch = { answer_layout: v };
    } else if (key === "answer_grid_columns") {
      const n = Number(form.get("value"));
      if (n !== 2 && n !== 3) {
        return json({ intent, ok: false, error: "Invalid column count." }, { status: 400 });
      }
      patch = { answer_grid_columns: n };
    } else if (key === "question_image_position") {
      const v = String(form.get("value") ?? "");
      if (!["none", "top", "side"].includes(v)) {
        return json({ intent, ok: false, error: "Invalid image position." }, { status: 400 });
      }
      patch = { question_image_position: v };
    } else if (key === "progress_bar") {
      const parsed = DesignTokens.shape.progress_bar.safeParse(safeJson(form.get("value")));
      if (!parsed.success) {
        return json({ intent, ok: false, error: "Invalid progress bar." }, { status: 400 });
      }
      patch = { progress_bar: { ...doc.design_tokens.progress_bar, ...parsed.data } };
    } else {
      return json({ intent, ok: false, error: "Unknown format key." }, { status: 400 });
    }
    const merged = DesignTokens.safeParse({ ...doc.design_tokens, ...patch });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid formatting." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, design_tokens: merged.data });
    return json({ intent, ok: true });
  }

  // Design "Continue →": park at the Overview review step before the build.
  // The build itself still fires from Overview via generate-build (below).
  if (intent === "to-overview") {
    if (!session.picked_template) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "overview" } });
    return json({ intent, ok: true });
  }

  if (intent === "generate-build") {
    const picked = session.picked_template;
    if (!picked) return json({ intent, ok: false, error: "No template selected." }, { status: 400 });

    // Re-architected flow: the quiz is ALREADY built (the question build ran at
    // the Question Builder step). Generate is a NON-AI finalize — just open the
    // already-built draft in the builder. Re-running startStep2Build would strip +
    // rebuild the sb_ question nodes (fresh answer ids) and re-bake result nodes,
    // DESTROYING every Question Builder / Rec Page / Design edit. The merchant's
    // last design/rec edits already live on the draft (autosaved), so nothing else
    // to apply.
    if (session.built) {
      // Graduate the draft out of the "step1" in-flight state: the funnel is done,
      // so it should now appear in the gallery AND "Create new quiz" should start a
      // FRESH draft instead of resuming this finished one (findOrCreateStep1Draft
      // only resumes buildState:"step1" drafts).
      await prisma.quiz.update({ where: { id: quiz.id }, data: { buildState: null } });
      return redirect(opts.builderPath(quiz.id));
    }

    // Legacy in-flight draft that reached Overview the OLD way (no build yet) →
    // run the real detached build, landing in the builder via the buildState overlay.
    const rich = session.rich_templates.find((t) => t.id === picked.template_id);
    if (!rich) return json({ intent, ok: false, error: "Template not found." }, { status: 400 });
    if (!session.goal?.goal_text) return json({ intent, ok: false, error: "Add a goal before building." }, { status: 400 });
    await startStep2Build(
      shop.id,
      quiz.id,
      rich,
      picked,
      session.goal.goal_text,
      session.goal.struggle_text ?? "",
    );
    return redirect(opts.builderPath(quiz.id));
  }

  if (
    intent === "back-to-grouping" ||
    intent === "back-to-goal" ||
    intent === "back-to-types" ||
    intent === "back-to-configuring"
  ) {
    const stage =
      intent === "back-to-grouping"
        ? "grouping"
        : intent === "back-to-goal"
          ? "goal"
          : intent === "back-to-configuring"
            ? "configuring"
            : "types";
    const next: BuildSession = { ...session, stage };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  return json({ intent, ok: false, error: "Unknown action" }, { status: 400 });
}

// Parse a form value as JSON, returning null on any failure (the Zod safeParse
// downstream rejects nulls cleanly).
function safeJson(v: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(v ?? "null"));
  } catch {
    return null;
  }
}

// §5 — a design intent targets the quiz design by default, or the rec page's own
// design when scope="rec_page" AND the quiz is de-linked. Returns the token object
// to merge into + a writer that puts the result back on the right field.
function designScopeTarget(doc: Quiz, form: FormData): {
  base: Quiz["design_tokens"];
  write: (next: Quiz["design_tokens"]) => Quiz;
} {
  const recScope = String(form.get("scope") ?? "") === "rec_page" && doc.design_linked === false;
  const base = recScope ? (doc.rec_page_design ?? doc.design_tokens) : doc.design_tokens;
  return {
    base,
    write: (next) => (recScope ? { ...doc, rec_page_design: next } : { ...doc, design_tokens: next }),
  };
}
