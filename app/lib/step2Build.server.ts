import prisma from "../db.server";
import { buildScopedIndex } from "./catalogIndex";
import { detectGroupingDimension } from "./groupingDetect";
import { parseBrandIdentitySafe } from "./brandIdentity";
import {
  runWebResearchForQuizTypes,
  generateQuizTypes,
  generateQuizTemplates,
} from "./claude";
import { Quiz, BuildSession, PickedTemplate } from "./quizSchema";
import { dialsToBuildDirectives, autoQuizName } from "./dialDirectives";
import { runAiOnboardingBuild } from "./onboardingBuild.server";
import type { DesignTokensT } from "./designTokens";
import type { GroupingProduct } from "./categoryGrouping";
import type { QuizType, RichTemplateOption } from "./quizSchema";

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

async function loadStep2Context(shopId: string) {
  const [products, collections, shop] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { brandIdentity: true } }),
  ]);
  const indexed = buildScopedIndex(products, collections, []);
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

// Best-effort live web research for the shop's positioning (the slow ~40s pass;
// in the funnel it runs inside the detached typing job, never synchronously).
export async function runStep2WebResearch(shopId: string): Promise<string> {
  const ctx = await loadStep2Context(shopId);
  return runWebResearchForQuizTypes({
    industry: ctx.positioning.industry,
    vertical: ctx.positioning.vertical,
    priceTier: ctx.positioning.price_tier,
    demographic: ctx.positioning.demographic,
  });
}

// Tier 1: brand-tailored quiz types. `webResearchText` is passed in (the caller
// runs runStep2WebResearch first, detached); `skipWebResearch` runs the fast
// degraded path (model knowledge only).
export async function generateStep2Types(
  shopId: string,
  input: {
    goal: string;
    struggle?: string;
    buckets?: Array<{ name: string; tags: string[] }>;
    webResearchText?: string;
    skipWebResearch?: boolean;
  },
): Promise<{ types: QuizType[]; webResearchSummary: string }> {
  const ctx = await loadStep2Context(shopId);
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
  chosenType: QuizType,
  input: { goal: string; struggle?: string; buckets?: Array<{ id: string; name: string; tags: string[] }> },
): Promise<RichTemplateOption[]> {
  const ctx = await loadStep2Context(shopId);
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

// The funnel's "typing" job — web research + quiz types, DETACHED (research ~40s +
// types ~31s outruns the edge window; measured at T2). On success → stage "types"
// with the cards; on failure → back to "goal" so the merchant can retry.
export function startStep2Types(
  shopId: string,
  quizId: string,
  input: { goal: string; struggle?: string; buckets?: Array<{ name: string; tags: string[] }> },
): void {
  void (async () => {
    try {
      const webResearchText = await runStep2WebResearch(shopId);
      const { types } = await generateStep2Types(shopId, { ...input, webResearchText });
      await patchBuildSession(quizId, (s) =>
        BuildSession.parse({
          ...s,
          stage: "types",
          quiz_types: types,
          web_research_summary: webResearchText.slice(0, 600),
          gen_error: undefined,
        }),
      );
    } catch (err) {
      console.error("[step2] type generation failed:", err instanceof Error ? err.message : err);
      await patchBuildSession(quizId, (s) =>
        BuildSession.parse({ ...s, stage: "goal", gen_error: friendlyGenError(err) }),
      );
    }
  })();
}

// The funnel's "templating" job — rich battle-card templates for the chosen type,
// DETACHED. On success → stage "configuring" (rich_templates ready, none picked
// yet); on failure → back to "types".
export function startStep2Templates(
  shopId: string,
  quizId: string,
  chosenType: QuizType,
  input: { goal: string; struggle?: string; buckets?: Array<{ id: string; name: string; tags: string[] }> },
): void {
  void (async () => {
    try {
      const templates = await generateStep2Templates(shopId, chosenType, input);
      await patchBuildSession(quizId, (s) =>
        BuildSession.parse({
          ...s,
          stage: "configuring",
          rich_templates: templates,
          picked_template: undefined,
          gen_error: undefined,
        }),
      );
    } catch (err) {
      console.error("[step2] template generation failed:", err instanceof Error ? err.message : err);
      await patchBuildSession(quizId, (s) =>
        BuildSession.parse({ ...s, stage: "types", gen_error: friendlyGenError(err) }),
      );
    }
  })();
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

// Pick → the detached full build. Applies the battle-card edits to the quiz's
// Category rows (prune disabled groups, narrow enabled groups to the merchant's
// product subset), threads dials → tokenPatch + directives and rec_defaults →
// recOverride, then runs the existing detached build (buildState "building").
export async function startStep2Build(
  shopId: string,
  quizId: string,
  rich: RichTemplateOption,
  picked: PickedTemplate,
  goal: string,
  struggle: string,
): Promise<void> {
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
  const draftTokens =
    (draftDoc?.draftJson as { design_tokens?: DesignTokensT } | null)?.design_tokens ?? null;

  await prisma.quiz.update({
    where: { id: quizId },
    data: { name: picked.quiz_name, buildState: "building" },
  });

  void runAiOnboardingBuild({
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
  })
    .then(() => prisma.quiz.update({ where: { id: quizId }, data: { buildState: null } }))
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.quiz
        .update({ where: { id: quizId }, data: { buildState: `error:${msg.slice(0, 300)}` } })
        .catch(() => {});
    });
}
