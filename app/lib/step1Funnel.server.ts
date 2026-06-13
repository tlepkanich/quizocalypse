import { json, redirect } from "@remix-run/node";
import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { Quiz, type BuildSession } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { detectGroupingDimension } from "./groupingDetect";
import { recordIdentitySignals } from "./brandIdentityBuild.server";
import {
  persistConfirmedGroups,
  loadConfirmedBuckets,
  resyncCatalogForShop,
  generateStep1TemplateOptions,
  startStep1Build,
} from "./step1Build.server";
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
  const session: BuildSession = parsed.data.build_session ?? {
    stage: "grouping",
    template_options: [],
  };
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

  const [products, collections, shopRow] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
    prisma.shop.findUnique({ where: { id: shop.id }, select: { brandIdentity: true } }),
  ]);

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

    let options;
    try {
      const buckets = await loadConfirmedBuckets(shop.id, quiz.id);
      options = await generateStep1TemplateOptions(shop.id, {
        goal,
        ...(struggle ? { struggle } : {}),
        ...(buckets.length ? { buckets } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ intent, ok: false, error: `Couldn't draft directions: ${msg}` }, { status: 502 });
    }

    const next: BuildSession = {
      ...session,
      stage: "templates",
      goal: { goal_text: goal, struggle_text: struggle },
      template_options: options,
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
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

  if (intent === "back-to-grouping" || intent === "back-to-goal") {
    const next: BuildSession = {
      ...session,
      stage: intent === "back-to-grouping" ? "grouping" : "goal",
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  return json({ intent, ok: false, error: "Unknown action" }, { status: 400 });
}
