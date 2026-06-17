import { json, redirect } from "@remix-run/node";
import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { Quiz, BuildSession, DesignDials, RecDefaults } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { detectGroupingDimension } from "./groupingDetect";
import { recordIdentitySignals } from "./brandIdentityBuild.server";
import {
  persistConfirmedGroups,
  loadConfirmedBuckets,
  resyncCatalogForShop,
  startStep1Build,
} from "./step1Build.server";
import {
  startStep2Types,
  startStep2Templates,
  initPickedTemplate,
  startStep2Build,
} from "./step2Build.server";
import { saveTemplate, listSavedTemplates, loadSavedTemplate } from "./savedTemplates.server";
import type { GroupingProduct } from "./categoryGrouping";

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

// The funnel's front door: resume the most-recent in-flight Step-1 draft for this
// shop, or seed a fresh one. Returns the quiz id; each entry route redirects to
// its own nested funnel path (/studio/onboarding/:id or /app/onboarding/:id).
export async function findOrCreateStep1Draft(shopId: string): Promise<string> {
  const inFlight = await prisma.quiz.findFirst({
    where: { shopId, buildState: "step1" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (inFlight) return inFlight.id;

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
    select: { id: true, name: true, draftJson: true, buildState: true },
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
export async function loadStep1FunnelData(shop: FunnelShop, quizId: string | undefined) {
  const { quiz, session } = await loadFunnelDraft(shop.id, quizId);

  const [products, collections, shopRow, categories, savedTemplates] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
    prisma.shop.findUnique({ where: { id: shop.id }, select: { brandIdentity: true } }),
    prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, productIds: true },
      orderBy: { createdAt: "asc" },
    }),
    listSavedTemplates(shop.id),
  ]);

  const titleById = new Map(products.map((p) => [p.productId, p.title]));

  const detect = detectGroupingDimension(
    products.map(toGroupingProduct),
    collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
  );

  return {
    quizId: quiz.id,
    name: quiz.name,
    stage: session.stage,
    minGoalChars: MIN_GOAL_CHARS,
    productCount: products.length,
    identitySummary: parseBrandIdentitySafe(shopRow?.brandIdentity)?.summary ?? null,
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
    productGroups: categories.map((c) => ({
      id: c.id,
      name: c.name,
      // Resolve each bucket member to a readable {id,title} so the T8 editor can
      // render product toggle chips (the working copy stores GIDs only).
      products: c.productIds.map((pid) => ({ id: pid, title: titleById.get(pid) ?? pid })),
    })),
    collections: collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
    savedTemplates: savedTemplates.map((t) => ({ id: t.id, name: t.name, template: t.template })),
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
  const form = await request.formData();
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

  if (intent === "generate-build") {
    const picked = session.picked_template;
    if (!picked) return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
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
    intent === "back-to-types"
  ) {
    const stage =
      intent === "back-to-grouping" ? "grouping" : intent === "back-to-goal" ? "goal" : "types";
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
