import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz, type BuildSession } from "../lib/quizSchema";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import { detectGroupingDimension } from "../lib/groupingDetect";
import { recordIdentitySignals } from "../lib/brandIdentityBuild.server";
import {
  persistConfirmedGroups,
  loadConfirmedBuckets,
  resyncCatalogForShop,
  generateStep1TemplateOptions,
} from "../lib/step1Build.server";
import type { GroupingProduct } from "../lib/categoryGrouping";
import { Step1Funnel } from "../components/onboarding/Step1Funnel";

// Builder Re-work Step 1 — the identity-first creation funnel (the nested,
// resumable home for ONE draft quiz). Stages live in draftJson.build_session
// (scratch state, stripped at publish): grouping → goal → generating →
// templates. The entry route (studio.onboarding.tsx) creates the draft and
// redirects here so refresh/back resume the same quiz + its Categories.

// Minimum goal characters before the merchant can generate. Shared by the action
// (the gate) and the component (the QzProgress fill bar, via loader data).
const MIN_GOAL_CHARS = 24;

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

// Load the owned draft + its parsed doc + build_session. Throws a 404 Response
// when the quiz isn't this shop's (or doesn't parse) so loader/action share it.
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

// Persist a mutated doc back to the draft (build_session is scratch state, so we
// write draftJson directly — no publish path). Re-parse first so an invalid
// mutation can never land.
async function writeDoc(quizId: string, doc: Quiz) {
  await prisma.quiz.update({
    where: { id: quizId },
    data: { draftJson: Quiz.parse(doc) as never },
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const { quiz, session } = await loadFunnelDraft(shop.id, params.quizId);

  const [products, collections, shopRow] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
    prisma.shop.findUnique({ where: { id: shop.id }, select: { brandIdentity: true } }),
  ]);

  // Deterministic detection (cheap, no AI) — only consumed at the grouping stage,
  // but recomputed each load so a re-sync reflects immediately.
  const detect = detectGroupingDimension(
    products.map(toGroupingProduct),
    collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
  );

  return json({
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
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const { quiz, doc, session } = await loadFunnelDraft(shop.id, params.quizId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // "Refresh catalog" — best-effort offline-admin re-sync; the loader revalidates
  // after, so detection reflects any freshly-synced collection membership.
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
    // S4 records the pick + marks the funnel done; S5 wires pick → the detached
    // full build (flip buildState, redirect to the editor overlay).
    const next: BuildSession = { ...session, stage: "done", picked_option_id: optionId };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
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
};

export default function StudioOnboardingFunnel() {
  const data = useLoaderData<typeof loader>();
  return <Step1Funnel data={data} />;
}
