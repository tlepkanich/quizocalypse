import prisma from "../db.server";
import { logFor, reportError } from "./log.server";
import { checkAiBudget, withAiSpendRecording } from "./aiBudget.server";
import { buildScopedIndex, scopeCatalogToChosen } from "./catalogIndex";
import { detectGroupingDimension } from "./groupingDetect";
import { parseBrandIdentitySafe } from "./brandIdentity";
import {
  runWebResearchForQuizTypes,
  generateQuizTypes,
  generateQuizTemplates,
} from "./claude";
import {
  getOrStartShopWebResearch,
  peekFreshShopWebResearch,
} from "./shopWebResearch.server";
import { Quiz, BuildSession, PickedTemplate } from "./quizSchema";
import { applyManualDeciderSkeleton } from "./smartBuild";
import { dialsToBuildDirectives, autoQuizName } from "./dialDirectives";
import { runAiOnboardingBuild, type PrefetchedBuildCatalog } from "./onboardingBuild.server";
import type { DesignTokensT } from "./designTokens";
import type { GroupingProduct } from "./categoryGrouping";
import type { QuizType, RichTemplateOption, Quiz as QuizDocT } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Step 2 — server orchestration for the two-tier template generation. Tier 1
// digests the brand identity + catalog (+ optional live web research) into 3-4
// quiz TYPE cards; tier 2 expands the chosen type into 2-3 rich battle-card
// TEMPLATES. Mirrors step1Build's generateStep1TemplateOptions assembly. The
// detached/funnel wiring (writing BuildSession, polling) lands in T3.
// ════════════════════════════════════════════════════════════════════════════

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

async function loadStep2Context(shopId: string, quizId?: string) {
  const [products, collections, shop] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { brandIdentity: true } }),
  ]);
  // Owner fix: the Shape page must generate from the merchant's CHOSEN recommended
  // products — the confirmed buckets — NOT the whole catalog. When a quizId is
  // given, scope the catalog summary the type/template AI reads (product types,
  // price band, and tag framing shown to the model) to the union of those buckets'
  // products. NOTE: the Shape stage itself emits no answer.tags — the questions +
  // answers are written later in the question-flow build, which scopes the same way
  // (onboardingBuild.server.ts, via scopeCatalogToChosen).
  const chosenProductIds = quizId
    ? new Set(
        (
          await prisma.category.findMany({ where: { shopId, quizId }, select: { productIds: true } })
        ).flatMap((c) => c.productIds),
      )
    : new Set<string>();
  const scope = scopeCatalogToChosen(products, collections, chosenProductIds);
  const indexed = buildScopedIndex(scope.products, scope.collections, []);
  const identity = parseBrandIdentitySafe(shop?.brandIdentity);
  const brandSummary = identity?.summary ?? "";
  const brandVoiceSample = identity?.voice
    ? [identity.voice.tone_description, ...(identity.voice.sample_phrases ?? [])]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const positioning = {
    industry: identity?.positioning.industry ?? "",
    vertical: identity?.positioning.vertical ?? "",
    price_tier: identity?.positioning.price_tier ?? "",
    demographic: identity?.positioning.target_demographic ?? [],
  };
  // Confirmed buckets when provided by the funnel; else detect them.
  const detect = detectGroupingDimension(
    products.map(toGroupingProduct),
    collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
  );
  return { products, collections, indexed, brandSummary, brandVoiceSample, positioning, detect };
}

// (runStep2WebResearch retired by FAST F1 — the typing job now resolves
// research through getOrStartShopWebResearch, the shop-level cache +
// single-flight in shopWebResearch.server.ts. Cold-cache behavior is the
// identical inline runWebResearchForQuizTypes call with the same positioning.)

// Tier 1: brand-tailored quiz types. `webResearchText` is passed in (the caller
// runs runStep2WebResearch first, detached); `skipWebResearch` runs the fast
// degraded path (model knowledge only).
export async function generateStep2Types(
  shopId: string,
  quizId: string,
  input: {
    goal: string;
    struggle?: string;
    buckets?: Array<{ name: string; tags: string[] }>;
    webResearchText?: string;
    skipWebResearch?: boolean;
  },
): Promise<{ types: QuizType[]; webResearchSummary: string }> {
  // Scope the catalog summary to the quiz's confirmed buckets (chosen products).
  const ctx = await loadStep2Context(shopId, quizId);
  const buckets =
    input.buckets ?? ctx.detect.proposed.map((g) => ({ name: g.name, tags: g.tags }));

  const webResearchText =
    input.webResearchText ??
    (input.skipWebResearch
      ? ""
      : await runWebResearchForQuizTypes({
          industry: ctx.positioning.industry,
          vertical: ctx.positioning.vertical,
          priceTier: ctx.positioning.price_tier,
          demographic: ctx.positioning.demographic,
        }));

  const types = await generateQuizTypes({
    brandSummary: ctx.brandSummary,
    ...(ctx.brandVoiceSample ? { brandVoiceSample: ctx.brandVoiceSample } : {}),
    positioning: ctx.positioning,
    goalPrompt: input.goal,
    ...(input.struggle ? { struggle: input.struggle } : {}),
    buckets,
    catalogSummary: ctx.indexed.summary,
    webResearchText,
  });

  return { types, webResearchSummary: webResearchText };
}

// Tier 2: rich battle-card templates for the chosen type.
export async function generateStep2Templates(
  shopId: string,
  quizId: string,
  chosenType: QuizType,
  input: { goal: string; struggle?: string; buckets?: Array<{ id: string; name: string; tags: string[] }> },
): Promise<RichTemplateOption[]> {
  // Scope the catalog summary to the quiz's confirmed buckets (chosen products).
  const ctx = await loadStep2Context(shopId, quizId);
  const buckets =
    input.buckets ??
    ctx.detect.proposed.map((g) => ({ id: g.sourceRef ?? g.name, name: g.name, tags: g.tags }));

  return generateQuizTemplates({
    chosenType,
    brandSummary: ctx.brandSummary,
    ...(ctx.brandVoiceSample ? { brandVoiceSample: ctx.brandVoiceSample } : {}),
    positioning: {
      industry: ctx.positioning.industry,
      vertical: ctx.positioning.vertical,
      price_tier: ctx.positioning.price_tier,
    },
    goalPrompt: input.goal,
    ...(input.struggle ? { struggle: input.struggle } : {}),
    buckets,
    catalogSummary: ctx.indexed.summary,
  });
}

// ── Detached generation + build (the funnel's typing/templating/build steps) ──

// Re-read the quiz fresh, mutate build_session, write back. The fresh re-read is
// the no-clobber discipline for the long detached jobs (the merchant only polls
// during them, so this end-of-job write is safe).
// Map a detached-job AI error to an honest, non-technical funnel banner. Anthropic
// surfaces billing/rate problems as 4xx with a recognizable message; everything else
// gets a generic retry nudge. Never leaks raw account/billing detail to a merchant —
// the full error stays in the operator's server logs.
// BIC-2 A2(f) — the ONLY copy the detached main-builder build may persist into
// Quiz.buildState's "error:" payload (it renders verbatim in the builder's
// BuildError screen). Exported for step1Build's twin catch + the scrub test.
export const GENERIC_BUILD_ERROR =
  "The AI build didn't finish — try again, or start from a template.";

// BIC-2 A3 — the funnel jobs' over-budget banner. Renders in the existing
// gen_error treatment (banner + retry affordance), so tomorrow's retry Just
// Works once the UTC day rolls over.
const BUDGET_GEN_ERROR =
  "Today's AI generation limit for this shop is reached — try again tomorrow.";

// Check the merchant ceiling ONCE at job kick (never mid-pipeline). Same
// never-throw posture as the jobs themselves: checkAiBudget fails open and the
// gen_error write goes through writeGenError. Returns true when the job may run.
async function budgetAllowsGenJob(
  shopId: string,
  quizId: string,
  onRefusal: () => Promise<void>,
): Promise<boolean> {
  const budget = await checkAiBudget(shopId, "merchant");
  if (budget.allowed) return true;
  logFor("step2").warn(
    { shopId, quizId, spentUSD: budget.spentUSD, limitUSD: budget.limitUSD },
    "gen job refused — daily AI budget reached",
  );
  await onRefusal();
  return false;
}

function friendlyGenError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/credit balance|billing|quota|insufficient|payment/i.test(msg)) {
    return "AI quiz generation is temporarily unavailable. Start from a ready-made template below, or try again shortly.";
  }
  if (/rate.?limit|429|overloaded|529/i.test(msg)) {
    return "The AI is busy right now. Give it a moment and try again, or start from a ready-made template below.";
  }
  return "We couldn't generate that with AI. Try again, or start from a ready-made template below.";
}

async function patchBuildSession(
  quizId: string,
  mutate: (s: BuildSession) => BuildSession,
): Promise<void> {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { draftJson: true } });
  if (!quiz) return;
  const parsed = Quiz.safeParse(quiz.draftJson);
  if (!parsed.success) return;
  const session = parsed.data.build_session ?? BuildSession.parse({});
  const next = mutate(session);
  await prisma.quiz.update({
    where: { id: quizId },
    data: { draftJson: Quiz.parse({ ...parsed.data, build_session: next }) as never },
  });
}

// Best-effort gen_error persist for the DETACHED jobs' failure paths: if writing
// the error state itself fails (DB hiccup), LOG it but never let it throw — a throw
// in a void async would strand the funnel on the typing/templating spinner forever.
// The updatedAt-stall detection + retry-gen is the final backstop ([[detached-job-killed-strands-funnel]]).
async function writeGenError(
  quizId: string,
  mutate: (s: BuildSession) => BuildSession,
): Promise<void> {
  try {
    await patchBuildSession(quizId, mutate);
  } catch (e) {
    reportError(e, { scope: "step2", msg: "failed to persist gen_error", quizId });
  }
}

// FAST F3 — persist the jobs' honest live checkpoint. Same never-throw posture
// as writeGenError: a progress write is cosmetic and must NEVER be able to
// fail a detached job (a throw here would land in the job's catch and write a
// bogus gen_error). Fresh-read via patchBuildSession, one small write per REAL
// pass boundary — never inside retry loops.
async function writeGenProgress(
  quizId: string,
  progress: NonNullable<BuildSession["gen_progress"]>,
): Promise<void> {
  try {
    await patchBuildSession(quizId, (s) => BuildSession.parse({ ...s, gen_progress: progress }));
  } catch (e) {
    reportError(e, { scope: "step2", msg: "failed to persist gen_progress", quizId });
  }
}

// How a template/question generation failure lands (start-routing spec):
//  - "shape" (default): back to the Shape stage with gen_error + retry — the
//    AI-templates route's own §3 treatment.
//  - "blank_questions" (§1.3, the write-a-goal route): the merchant chose a
//    goal, not Shape — seed the manual decider skeleton and land them on a
//    BLANK Questions step with a non-blocking notice, never a stage they
//    didn't pick.
export type GenFailMode = "shape" | "blank_questions";

// §1.3 — apply the blank-Questions landing. Same never-throw posture as
// writeGenError (a throw in a void async strands the spinner forever).
async function failToBlankQuestions(shopId: string, quizId: string): Promise<void> {
  try {
    const [quiz, firstCollection] = await Promise.all([
      prisma.quiz.findUnique({ where: { id: quizId }, select: { draftJson: true } }),
      prisma.collection.findFirst({ where: { shopId }, select: { collectionId: true } }),
    ]);
    if (!quiz) return;
    const parsed = Quiz.safeParse(quiz.draftJson);
    if (!parsed.success) return;
    const doc = applyManualDeciderSkeleton(
      parsed.data,
      firstCollection?.collectionId ?? "manual",
    );
    const session = parsed.data.build_session ?? BuildSession.parse({});
    const next = BuildSession.parse({
      ...session,
      stage: "question_builder",
      built: true,
      gen_error:
        "We couldn't generate from your goal — starting blank. Build your questions below, or go back and try again.",
      gen_progress: undefined,
    });
    await prisma.quiz.update({
      where: { id: quizId },
      data: { draftJson: Quiz.parse({ ...doc, build_session: next }) as never },
    });
  } catch (e) {
    reportError(e, { scope: "step2", msg: "failed to land blank questions", shopId, quizId });
  }
}

// The funnel's "typing" job — web research + quiz types, DETACHED (research ~40s +
// types ~31s outruns the edge window; measured at T2). On success → stage "types"
// with the cards; on failure → back to "types" (Shape) with a gen_error so the
// merchant can retry / write a goal there (the standalone Goal step is retired).
export function startStep2Types(
  shopId: string,
  quizId: string,
  input: { goal: string; struggle?: string; buckets?: Array<{ name: string; tags: string[] }> },
): void {
  // BIC-2 A3 — the whole job runs inside the shop's usage-recording scope
  // (research + types both bill the shop); the ceiling is checked ONCE at kick.
  // Every code path below is caught or never-throw, so the void is safe.
  void withAiSpendRecording(shopId, async () => {
    const allowed = await budgetAllowsGenJob(shopId, quizId, () =>
      writeGenError(quizId, (s) =>
        BuildSession.parse({
          ...s,
          stage: "types",
          gen_error: BUDGET_GEN_ERROR,
          gen_progress: undefined,
        }),
      ),
    );
    if (!allowed) return;
    try {
      // FAST F1 — resolve research through the shop-level cache: a fresh cache
      // (or an entry-time prefetch that already finished) makes this instant;
      // an in-flight prefetch is awaited (single-flight); a cold cache runs the
      // identical inline research as before. FAST F3 — only announce the
      // "research" checkpoint when we genuinely have to wait for research.
      const cachedResearch = await peekFreshShopWebResearch(shopId);
      if (cachedResearch === null) await writeGenProgress(quizId, "research");
      const tResearch = Date.now();
      const webResearchText = cachedResearch ?? (await getOrStartShopWebResearch(shopId));
      logFor("step2").info({ quizId, ms: Date.now() - tResearch }, "research took");

      await writeGenProgress(quizId, "types");
      const tTypes = Date.now();
      const { types } = await generateStep2Types(shopId, quizId, { ...input, webResearchText });
      logFor("step2").info({ quizId, ms: Date.now() - tTypes }, "types took");
      await patchBuildSession(quizId, (s) =>
        BuildSession.parse({
          ...s,
          stage: "types",
          quiz_types: types,
          web_research_summary: webResearchText.slice(0, 600),
          gen_error: undefined,
          gen_progress: undefined,
        }),
      );
    } catch (err) {
      reportError(err, { scope: "step2", msg: "type generation failed", shopId, quizId });
      await writeGenError(quizId, (s) =>
        BuildSession.parse({
          ...s,
          stage: "types",
          gen_error: friendlyGenError(err),
          gen_progress: undefined,
        }),
      );
    }
  });
}

// The funnel's "templating" job — rich battle-card templates for the chosen type,
// DETACHED. On success → auto-pick the AI's top template, then BUILD THE QUIZ
// EARLY (startQuestionBuild) so the merchant lands in the Question Builder editing
// a real draft. The stage stays on the polling "templating" screen for the build's
// duration; the build's completion flips it to "question_builder". On template-gen
// failure → "types" (Shape). A degenerate no-template result falls back to the
// legacy BattleCard ("configuring").
export function startStep2Templates(
  shopId: string,
  quizId: string,
  chosenType: QuizType,
  input: { goal: string; struggle?: string; buckets?: Array<{ id: string; name: string; tags: string[] }> },
  opts?: { failMode?: GenFailMode },
): void {
  const failMode = opts?.failMode ?? "shape";
  // BIC-2 A3 — recording scope + ONE ceiling check at kick; the question build
  // this job chains into (startQuestionBuild) inherits the check via
  // budgetPrechecked so the pipeline is never interrupted midway.
  void withAiSpendRecording(shopId, async () => {
    const allowed = await budgetAllowsGenJob(shopId, quizId, () =>
      failMode === "blank_questions"
        ? failToBlankQuestions(shopId, quizId)
        : writeGenError(quizId, (s) =>
            BuildSession.parse({
              ...s,
              stage: "types",
              gen_error: BUDGET_GEN_ERROR,
              gen_progress: undefined,
            }),
          ),
    );
    if (!allowed) return;
    try {
      // FAST F2 — start the question build's slow NON-AI inputs (catalog rows +
      // shop brand row) CONCURRENTLY with template generation. The promise is
      // threaded down to runAiOnboardingBuild via startQuestionBuild; it never
      // rejects (a prep failure resolves undefined → the build falls back to
      // its own inline queries, today's exact path). FAST F3 — announce the
      // templating job's first real checkpoint.
      await writeGenProgress(quizId, "templates");
      const prefetchedCatalog = prefetchBuildCatalog(shopId);
      const tTemplates = Date.now();
      const templates = await generateStep2Templates(shopId, quizId, chosenType, input);
      logFor("step2").info({ quizId, ms: Date.now() - tTemplates }, "templates took");
      const cats = await prisma.category.findMany({
        where: { shopId, quizId },
        select: { id: true, name: true, productIds: true },
        orderBy: { createdAt: "asc" },
      });
      const top = templates[0];
      const picked = top
        ? initPickedTemplate(
            top,
            cats.map((c) => ({ id: c.id, name: c.name, product_ids: c.productIds })),
            new Date(),
          )
        : undefined;

      if (top && picked) {
        // Persist the auto-picked template, KEEPING the stage on "templating" (the
        // polling generating screen), then kick the question build now. The build's
        // .then flips the stage to "question_builder".
        await patchBuildSession(quizId, (s) =>
          BuildSession.parse({
            ...s,
            rich_templates: templates,
            picked_template: picked,
            gen_error: undefined,
          }),
        );
        await startQuestionBuild(shopId, quizId, top, picked, input.goal, input.struggle ?? "", {
          failMode,
          prefetchedCatalog,
          budgetPrechecked: true,
        });
      } else if (failMode === "blank_questions") {
        await failToBlankQuestions(shopId, quizId);
      } else {
        // No template generated (degenerate) → route back to Shape with an honest
        // error + retry, NOT the retired BattleCard. (The `configuring` stage +
        // BattleCardStage stay only for any legacy in-flight draft already parked there.)
        await patchBuildSession(quizId, (s) =>
          BuildSession.parse({
            ...s,
            stage: "types",
            rich_templates: templates,
            picked_template: undefined,
            gen_error:
              "We couldn't shape a quiz from that just yet — try again, or pick one of the suggested directions.",
            gen_progress: undefined,
          }),
        );
      }
    } catch (err) {
      reportError(err, { scope: "step2", msg: "template generation failed", shopId, quizId });
      if (failMode === "blank_questions") {
        await failToBlankQuestions(shopId, quizId);
      } else {
        await writeGenError(quizId, (s) =>
          BuildSession.parse({
            ...s,
            stage: "types",
            gen_error: friendlyGenError(err),
            gen_progress: undefined,
          }),
        );
      }
    }
  });
}

// FAST F2 — the question build's non-AI prep, prefetched concurrently with
// template generation: the SAME product/collection/shop rows
// runAiOnboardingBuild queries at its catalog step. NEVER rejects — any
// failure resolves undefined and the build degrades to its own inline queries
// (today's exact behavior).
async function prefetchBuildCatalog(
  shopId: string,
): Promise<PrefetchedBuildCatalog | undefined> {
  try {
    const [products, collections, shop] = await Promise.all([
      prisma.product.findMany({ where: { shopId } }),
      prisma.collection.findMany({ where: { shopId } }),
      prisma.shop.findUnique({
        where: { id: shopId },
        select: { brandGuidelines: true, brandIdentity: true },
      }),
    ]);
    return { products, collections, shop };
  } catch (err) {
    logFor("step2").warn({ err, shopId }, "catalog prefetch failed (build will query inline)");
    return undefined;
  }
}

// Build the merchant's editable working copy from a chosen rich template + the
// confirmed buckets. Recommended groups default to all the confirmed buckets
// (or only the AI-flagged ones when it named any).
export function initPickedTemplate(
  rich: RichTemplateOption,
  productGroups: Array<{ id: string; name: string; product_ids: string[] }>,
  now: Date,
): PickedTemplate {
  const flagged = new Set(rich.recommended_bucket_ids);
  return PickedTemplate.parse({
    template_id: rich.id,
    quiz_name: autoQuizName(rich.title, now),
    design_dials: rich.dials,
    rec_defaults: rich.rec_defaults,
    recommended_groups: productGroups.map((g) => ({
      group_id: g.id,
      group_name: g.name,
      product_ids: g.product_ids,
      enabled: flagged.size === 0 || flagged.has(g.id),
    })),
    feature_notes: rich.feature_notes,
    question_count: rich.question_count,
    goal_line: rich.angle,
    saved_as_template: false,
  });
}

// Shared build assembly. Applies the picked working copy to the quiz's Category
// rows (prune disabled groups, narrow enabled groups to the merchant's product
// subset), threads dials → tokenPatch + directives, the Design-step theme →
// designTokens, and rec_defaults → recOverride, then kicks the detached AI build.
// Returns the runAiOnboardingBuild promise so each caller attaches its OWN
// completion handling (the legacy buildState overlay vs the funnel's stage flip).
async function buildQuizFromPicked(
  shopId: string,
  quizId: string,
  rich: RichTemplateOption,
  picked: PickedTemplate,
  goal: string,
  struggle: string,
  // FAST F2 — optional prep started concurrently with template generation.
  // Absent (legacy/wizard/retry callers) → the build queries inline as today.
  prefetchedCatalog?: Promise<PrefetchedBuildCatalog | undefined>,
): Promise<unknown> {
  const cats = await prisma.category.findMany({
    where: { shopId, quizId },
    select: { id: true, name: true, tags: true },
  });
  const overrideById = new Map(picked.recommended_groups.map((g) => [g.group_id, g]));
  const enabledBuckets: Array<{ id: string; name: string; tags: string[] }> = [];
  for (const c of cats) {
    const o = overrideById.get(c.id);
    if (o && !o.enabled) continue; // disabled group → no result page for it
    if (o && o.enabled) {
      // narrow the bucket to the merchant's kept products
      await prisma.category.update({ where: { id: c.id }, data: { productIds: o.product_ids } });
    }
    enabledBuckets.push({ id: c.id, name: c.name, tags: c.tags });
  }

  const goalPrompt = struggle ? `${goal}\n\nShoppers struggle with: ${struggle}` : goal;
  const { tokenPatch, promptDirectives } = dialsToBuildDirectives(picked.design_dials);

  // The merchant's Design-step theme lives on the draft doc; thread it into the
  // build as the base tokens (the dial tokenPatch still overlays on top). Absent
  // (unedited draft) → null → the build falls back to the seed's house tokens.
  const draftDoc = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { draftJson: true },
  });
  const draftRaw = draftDoc?.draftJson as {
    design_tokens?: DesignTokensT;
    logic_model?: string;
    rec_page_settings?: unknown;
  } | null;
  const draftTokens = draftRaw?.design_tokens ?? null;
  // LOGIC v2 (L2-10c) — the CREATION stamp lives on the draft; thread it into
  // the build here so every build intent (shape-continue / shape-goal-build /
  // pick-template / use-saved-template / retry-gen) preserves it uniformly
  // through runAiOnboardingBuild's re-seed. Legacy drafts thread nothing.
  // The draft's Step-4 config rides along too (the design_tokens pattern) so a
  // regenerate never wipes the merchant's capture/fallback setup.
  const logicModel = draftRaw?.logic_model === "decider" ? ("decider" as const) : undefined;
  const recPageSettings = logicModel
    ? (draftRaw?.rec_page_settings as QuizDocT["rec_page_settings"] | undefined)
    : undefined;

  // FAST F2 — resolve the concurrent prep (already settled or nearly so by the
  // time the template pass + category writes above finish). undefined (absent
  // param or a prep failure) leaves runAiOnboardingBuild's inline queries in
  // charge — byte-identical behavior.
  const prefetched = prefetchedCatalog ? await prefetchedCatalog : undefined;

  // BIC-2 A3 — the build's AI passes bill the shop. Nested inside the
  // templating job's scope this is a same-shop re-wrap (emits still fire once
  // per response); for the direct callers (retry-gen, saved-template, legacy
  // startStep2Build) it IS the recording scope.
  return withAiSpendRecording(shopId, () =>
    runAiOnboardingBuild({
      shopId,
      quizId,
      name: picked.quiz_name,
      goalPrompt,
      questionCount: picked.question_count,
      tone: "friendly",
      flow: {
        welcome_message: false,
        email_gate: rich.experience_type === "lead_capture",
        mixed_input_types: false,
      },
      experienceType: rich.experience_type,
      ...(logicModel ? { logicModel } : {}),
      ...(recPageSettings ? { recPageSettings } : {}),
      ...(enabledBuckets.length ? { preResolvedBuckets: enabledBuckets } : {}),
      directionAngle: rich.angle,
      sampleQuestionSeeds: rich.sample_questions,
      designTokens: draftTokens,
      tokenPatch,
      dialDirectives: promptDirectives,
      recOverride: {
        max_products: picked.rec_defaults.max_products,
        oos_behavior: picked.rec_defaults.oos_behavior,
        fallback_collection_id: picked.rec_defaults.fallback_collection_id,
      },
      ...(prefetched ? { prefetchedCatalog: prefetched } : {}),
    }),
  );
}

// LEGACY pick → detached full build that lands in the builder via the
// buildState "building" overlay. Kept for in-flight drafts that reach the
// Overview→Generate step the OLD way (no question nodes yet — pre-re-architecture
// drafts). New drafts build EARLY via startQuestionBuild (below) instead.
export async function startStep2Build(
  shopId: string,
  quizId: string,
  rich: RichTemplateOption,
  picked: PickedTemplate,
  goal: string,
  struggle: string,
): Promise<void> {
  await prisma.quiz.update({
    where: { id: quizId },
    data: { name: picked.quiz_name, buildState: "building" },
  });

  void buildQuizFromPicked(shopId, quizId, rich, picked, goal, struggle)
    .then(() => prisma.quiz.update({ where: { id: quizId }, data: { buildState: null } }))
    .catch(async (err) => {
      // BIC-2 A2(f) — buildState's "error:" payload renders verbatim in the
      // builder (studio_.$id BuildError), so persist generic copy only; the
      // full error goes to the log seam.
      reportError(err, { scope: "step2", msg: "detached build failed", shopId, quizId });
      await prisma.quiz
        .update({
          where: { id: quizId },
          data: { buildState: `error:${GENERIC_BUILD_ERROR}` },
        })
        .catch(() => {});
    });
}

// Re-architecture pick → build the quiz EARLY (right after Shape) so the merchant
// edits the real draft in the Question Builder step BEFORE Rec Page / Design.
// Unlike startStep2Build: NO buildState flip (the funnel polls its own stage, not
// the builder's overlay) and NO redirect. On success → stage "question_builder";
// on failure → back to Shape ("types") with a gen_error. The funnel sits on the
// polling "templating" generating screen for the build's duration.
export async function startQuestionBuild(
  shopId: string,
  quizId: string,
  rich: RichTemplateOption,
  picked: PickedTemplate,
  goal: string,
  struggle: string,
  opts?: {
    failMode?: GenFailMode;
    // FAST F2 — prep started concurrently with template generation (only the
    // templating job passes it; retry-gen / saved-template callers don't).
    prefetchedCatalog?: Promise<PrefetchedBuildCatalog | undefined>;
    // BIC-2 A3 — the templating job already checked the ceiling at ITS kick;
    // it passes true so the chained build is never interrupted mid-pipeline.
    // Direct callers (retry-gen, saved-template) leave it unset → checked here.
    budgetPrechecked?: boolean;
  },
): Promise<void> {
  // BIC-2 A3 — merchant ceiling at job kick (direct callers only, see above).
  if (!opts?.budgetPrechecked) {
    const allowed = await budgetAllowsGenJob(shopId, quizId, () =>
      opts?.failMode === "blank_questions"
        ? failToBlankQuestions(shopId, quizId)
        : writeGenError(quizId, (s) =>
            BuildSession.parse({
              ...s,
              stage: "types",
              gen_error: BUDGET_GEN_ERROR,
              gen_progress: undefined,
            }),
          ),
    );
    if (!allowed) return;
  }
  // Capture the funnel session BEFORE the build. runAiOnboardingBuild rebuilds
  // draftJson from a fresh seed and DROPS build_session, so we RESTORE the prior
  // session (grouping/goal/picked_template) with the new stage on completion —
  // not just set a stage onto the now-empty session. Without this the post-build
  // draft has no session and the funnel resets to "grouping", wiping the merchant.
  const before = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { draftJson: true },
  });
  const parsedBefore = before ? Quiz.safeParse(before.draftJson) : null;
  const priorSession: BuildSession =
    parsedBefore?.success && parsedBefore.data.build_session
      ? parsedBefore.data.build_session
      : BuildSession.parse({});

  // Set the name now (the build reads it too); the stage flip waits for success.
  await prisma.quiz.update({ where: { id: quizId }, data: { name: picked.quiz_name } });

  // FAST F3 — the long question-build pass begins (all startQuestionBuild
  // callers: templating job, retry-gen, saved-template). Written AFTER the
  // priorSession snapshot, so the completion restore below can't resurrect it.
  await writeGenProgress(quizId, "questions");
  const tBuild = Date.now();

  void buildQuizFromPicked(shopId, quizId, rich, picked, goal, struggle, opts?.prefetchedCatalog)
    .then(() => {
      logFor("step2").info({ quizId, ms: Date.now() - tBuild }, "question-build took");
      return patchBuildSession(quizId, () =>
        BuildSession.parse({
          ...priorSession,
          stage: "question_builder",
          built: true,
          gen_error: undefined,
          // priorSession predates this job but MAY carry the templating job's
          // "templates" checkpoint — clear explicitly on the stage flip.
          gen_progress: undefined,
        }),
      );
    })
    .catch(async (err) => {
      reportError(err, { scope: "step2", msg: "question build failed", shopId, quizId });
      if (opts?.failMode === "blank_questions") {
        // §1.3 (start-routing spec) — the write-a-goal route never traps the
        // merchant on Shape: land the blank Questions canvas with the notice.
        await failToBlankQuestions(shopId, quizId);
      } else {
        await writeGenError(quizId, () =>
          BuildSession.parse({
            ...priorSession,
            stage: "types",
            gen_error: friendlyGenError(err),
            gen_progress: undefined,
          }),
        );
      }
    });
}
