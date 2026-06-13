import prisma from "../db.server";
import type { GroupingDimension } from "./groupingDetect";
import { runAiOnboardingBuild } from "./onboardingBuild.server";
import { syncCatalog } from "../jobs/catalogSync";
import type { ProposedGroup } from "./categoryGrouping";
import type { TemplateOption, BuildSession } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Step 1 funnel — grouping persistence + the legacy "pick a direction" build.
// (The lightweight direction GENERATOR — generateStep1TemplateOptions — was
// retired in Step 2: save-goal now kicks the two-tier types/templates flow. The
// `pick` → startStep1Build consumer path stays for any pre-Step-2 draft sitting
// at stage "templates"; new drafts never reach it.)
// ════════════════════════════════════════════════════════════════════════════

// ── Grouping-stage persistence (the funnel's "confirm" action) ───────────────

// Atomically replace THIS quiz's Category rows with the confirmed groups. The
// groups are already-resolved ProposedGroups (from detectGroupingDimension), so
// productIds never come from the client — only WHICH groups to keep does. Mirrors
// api.categories.group.tsx's quiz-scoped delete+create transaction. Returns the
// created category ids (cached in build_session.grouping.confirmed_category_ids).
// An empty `groups` (the "all products" dimension) just clears the quiz's set.
export async function persistConfirmedGroups(
  shopId: string,
  quizId: string,
  dimension: GroupingDimension,
  groups: ProposedGroup[],
): Promise<string[]> {
  const runId = `s1_${quizId.slice(-6)}`;
  const rows = groups.map((g) => ({
    shopId,
    quizId,
    name: g.name,
    description: "",
    tags: g.tags,
    productIds: g.productIds,
    source: dimension === "all" ? "tag" : dimension,
    sourceRef: g.sourceRef ?? null,
    manualProductIds: [] as string[],
    discoveryRunId: runId,
  }));
  await prisma.$transaction([
    prisma.category.deleteMany({ where: { shopId, quizId } }),
    ...(rows.length ? [prisma.category.createMany({ data: rows })] : []),
  ]);
  if (!rows.length) return [];
  const created = await prisma.category.findMany({
    where: { shopId, quizId, discoveryRunId: runId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return created.map((c) => c.id);
}

// The confirmed buckets for the generation stage: the quiz's persisted Category
// rows as {name, tags}. Empty when the merchant chose "all products" — the
// generator then works from the catalog summary alone.
export async function loadConfirmedBuckets(
  shopId: string,
  quizId: string,
): Promise<Array<{ name: string; tags: string[] }>> {
  const rows = await prisma.category.findMany({
    where: { shopId, quizId },
    orderBy: { createdAt: "asc" },
    select: { name: true, tags: true },
  });
  return rows.map((r) => ({ name: r.name, tags: r.tags }));
}

// ── Pick → the detached full build (the funnel's terminal step) ──────────────

// Kick the full quiz build for a picked direction WITHOUT blocking the request,
// reusing the detached-build muscle of startAiOnboardingBuild. The quiz row
// already exists (the funnel draft), so we just rename it to the chosen
// direction, flip buildState → "building", and run the real build detached. The
// editor (studio.$id) polls buildState and swaps the overlay for the built quiz
// when it clears. The build consumes the merchant's CONFIRMED grouping (the
// quiz's Category rows) — no AI re-discovery — and the picked direction's angle
// + sample questions as generation context.
export async function startStep1Build(
  shopId: string,
  quizId: string,
  picked: TemplateOption,
  session: BuildSession,
): Promise<void> {
  // The confirmed buckets (with ids — reconcileBucketsToResultNodes binds result
  // pages via category_id). Empty when the merchant chose "all products"; in that
  // case omit preResolvedBuckets so the build discovers buckets rather than
  // produce a single undifferentiated page (a better quiz than the literal read).
  const cats = await prisma.category.findMany({
    where: { shopId, quizId },
    select: { id: true, name: true, tags: true },
    orderBy: { createdAt: "asc" },
  });

  const goal = session.goal?.goal_text?.trim() || picked.angle;
  const struggle = session.goal?.struggle_text?.trim();
  const goalPrompt = struggle ? `${goal}\n\nShoppers struggle with: ${struggle}` : goal;

  await prisma.quiz.update({
    where: { id: quizId },
    data: { name: picked.title, buildState: "building" },
  });

  void runAiOnboardingBuild({
    shopId,
    quizId,
    name: picked.title,
    goalPrompt,
    questionCount: 6,
    tone: "friendly",
    flow: {
      welcome_message: false,
      email_gate: picked.experience_type === "lead_capture",
      mixed_input_types: false,
    },
    experienceType: picked.experience_type,
    ...(cats.length ? { preResolvedBuckets: cats } : {}),
    directionAngle: picked.angle,
    sampleQuestionSeeds: picked.sample_questions,
  })
    .then(() => prisma.quiz.update({ where: { id: quizId }, data: { buildState: null } }))
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.quiz
        .update({ where: { id: quizId }, data: { buildState: `error:${msg.slice(0, 300)}` } })
        .catch(() => {});
    });
}

// The grouping stage's "Refresh catalog" affordance — resolves the offline Admin
// client and re-runs the catalog sync so Product.collectionIds (and collection
// membership) reflect the live store. Best-effort: when no offline session is
// resolvable (the studio dev path) it returns {ok:false} and the funnel degrades
// to the always-fresh tag/product_type detection. The install-time afterAuth sync
// already keeps production stores fresh; this is the manual top-up.
export async function resyncCatalogForShop(
  shopDomain: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(shopDomain);
    await syncCatalog(admin, shopDomain);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
