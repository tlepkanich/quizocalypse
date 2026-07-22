import prisma from "../db.server";
import type { GroupingDimension } from "./groupingDetect";
import { runAiOnboardingBuild } from "./onboardingBuild.server";
import { syncCatalog } from "../jobs/catalogSync";
import type { ProposedGroup } from "./categoryGrouping";
import {
  bucketRowFor,
  bucketRowsFor,
  type BucketType,
  type BucketRow,
} from "./bucketPersist";
import type { TemplateOption, BuildSession } from "./quizSchema";
import type { DesignTokensT } from "./designTokens";
import { GENERIC_BUILD_ERROR } from "./step2Build.server";
import { reportError } from "./log.server";

// Re-export the pure bucket resolver so callers can import the whole bucket
// API (pure resolve + IO persist) from one place.
export { bucketRowFor, bucketRowsFor, type BucketType, type BucketRow };

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

// ── Recommendation-bucket persistence (RB Step 1 — the bucket browser, IO) ───
// Each selected bucket is ONE Category row keyed on (shopId, quizId, source,
// sourceRef), so add/remove is idempotent: toggling on deletes any matching row
// then creates one; toggling off just deletes the match. The pure {type,key} →
// row resolution lives in bucketPersist.ts (re-exported above); this half is the
// Prisma writes. The three browser tabs only ever produce product/tag/collection
// sources; legacy product_type/metafield/ai rows are ignored by the shelf.

// Discovery-run marker stamped on browser-created bucket rows (purely so a set
// is identifiable; matching is always on source+sourceRef).
const BUCKET_RUN = "rb_buckets";

function bucketToData(shopId: string, quizId: string, row: BucketRow) {
  return {
    shopId,
    quizId,
    name: row.name,
    description: "",
    tags: row.tags,
    productIds: row.productIds,
    source: row.source,
    sourceRef: row.sourceRef,
    manualProductIds: [] as string[],
    discoveryRunId: BUCKET_RUN,
  };
}

// Add (or replace) bucket rows idempotently — delete any existing row for each
// (source,sourceRef) then create, all in one transaction. Covers single toggle-on
// (one row) and Select-All (many).
export async function addBuckets(
  shopId: string,
  quizId: string,
  rows: BucketRow[],
): Promise<void> {
  if (!rows.length) return;
  await prisma.$transaction(
    rows.flatMap((row) => [
      prisma.category.deleteMany({
        where: { shopId, quizId, source: row.source, sourceRef: row.sourceRef },
      }),
      prisma.category.create({ data: bucketToData(shopId, quizId, row) }),
    ]),
  );
}

// Remove bucket rows by key (single toggle-off or Clear-Visible).
export async function removeBuckets(
  shopId: string,
  quizId: string,
  type: BucketType,
  sourceRefs: string[],
): Promise<void> {
  if (!sourceRefs.length) return;
  await prisma.category.deleteMany({
    where: { shopId, quizId, source: type, sourceRef: { in: sourceRefs } },
  });
}

// Clear the quiz's entire bucket set (tab-lock confirm → switch dimensions).
export async function clearBuckets(shopId: string, quizId: string): Promise<void> {
  await prisma.category.deleteMany({ where: { shopId, quizId } });
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

  // DGN-1 — thread the draft's design_tokens (which now carry the shop's brand
  // seed from draft creation) into the build; without this the re-seed falls
  // back to the house theme and the brand look is lost on the legacy pick path.
  const draftDoc = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { draftJson: true },
  });
  const draftTokens =
    (draftDoc?.draftJson as { design_tokens?: DesignTokensT } | null)?.design_tokens ?? null;

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
    designTokens: draftTokens,
  })
    // ai-fallbacks Gap 1 — runAiOnboardingBuild swallows its own AI failure and
    // resolves with a `degraded` hint; treating that as success dropped the
    // merchant into a question-less builder with no explanation. Mirror
    // startAiOnboardingBuild: degraded → an error buildState the builder shows.
    .then((result) =>
      prisma.quiz.update({
        where: { id: quizId },
        data: {
          buildState: result.degraded
            ? "error:AI couldn't finish this draft. Try again or continue manually."
            : null,
        },
      }),
    )
    .catch(async (err) => {
      // BIC-2 A2(f) — buildState's "error:" payload renders verbatim in the
      // builder (studio_.$id BuildError): generic copy persisted, full error
      // to the log seam (mirrors step2Build's twin catch).
      reportError(err, { scope: "step1", msg: "detached build failed", quizId });
      await prisma.quiz
        .update({
          where: { id: quizId },
          data: { buildState: `error:${GENERIC_BUILD_ERROR}` },
        })
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
