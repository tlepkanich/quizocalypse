import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import type { Quiz as QuizDoc } from "./quizSchema";
import type { DesignTokensT } from "./designTokens";
import { buildSeedQuiz } from "./seedQuiz";
import { buildScopedIndex, toneSampleFromCatalog, suggestPlacement } from "./catalogIndex";
import { ingestWebsite } from "./websiteIngest.server";
import {
  discoverAndPersistBuckets,
  BucketDiscoveryError,
} from "./bucketDiscovery.server";
import { CategoryDiscoveryError } from "./categoryDiscover";
import { reconcileBucketsToResultNodes } from "./bucketReconcile";
import { generateQuestionFlow, type QuizTone } from "./claude";
import { applyQuestionFlow, type SmartBuildBucket } from "./smartBuild";
import { parseBrandGuidelinesSafe } from "./brandGuidelines";

// ───────────────────────────────────────────────────────────────────────────
// AI onboarding orchestrator (Phase 4). Chains the EXISTING building blocks
// into a one-shot "AI builds the whole quiz" path:
//   create (seed + design) → discover buckets → reconcile to result pages →
//   generateQuestionFlow → applyQuestionFlow → persist.
// Every failure path degrades to a valid draft (never a corrupt quiz) and
// returns a `degraded` hint so the wizard still lands the merchant in Studio.
// No engine/publish/runtime changes — this is pure orchestration.
// ───────────────────────────────────────────────────────────────────────────

export interface OnboardingBuildInput {
  shopId: string;
  name: string;
  goalPrompt: string;
  questionCount: number;
  tone: QuizTone;
  flow: { welcome_message: boolean; email_gate: boolean; mixed_input_types: boolean };
  designTokens?: DesignTokensT | null;
  // Optional brand-website URL (Dev Spec §3.2). Ingested for richer, on-brand
  // generated copy. Failures are swallowed — enrichment never blocks the build.
  websiteUrl?: string;
}

export interface OnboardingBuildResult {
  quizId: string;
  // Present when AI couldn't complete the full build; the merchant still gets a
  // valid (possibly partial) draft + this human-readable explanation.
  degraded?: string;
}

const STARTED_BLANK = "we created a blank quiz to start";

export async function runAiOnboardingBuild(
  input: OnboardingBuildInput,
): Promise<OnboardingBuildResult> {
  const { shopId, name } = input;

  // 1. Seed the quiz, applying the merchant's picked design tokens, and create.
  const seed = buildSeedQuiz(name);
  const seedDoc: QuizDoc = input.designTokens
    ? Quiz.parse({ ...seed, design_tokens: input.designTokens })
    : seed;
  const created = await prisma.quiz.create({
    data: { shopId, name, status: "draft", draftJson: seedDoc as never },
  });
  const quizId = created.id;

  // 2. Catalog: a fallback collection is REQUIRED to create result pages.
  const [allProducts, allCollections, shop] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { brandGuidelines: true } }),
  ]);
  const firstCollection = allCollections[0]?.collectionId ?? "";
  if (!firstCollection) {
    return {
      quizId,
      degraded: `Sync at least one Shopify collection so AI can build result pages — ${STARTED_BLANK}.`,
    };
  }

  // 3. Discover buckets (quiz-scoped). On any failure, keep the blank seed.
  let buckets;
  try {
    const res = await discoverAndPersistBuckets(shopId, quizId);
    buckets = res.buckets;
  } catch (err) {
    const msg =
      err instanceof BucketDiscoveryError || err instanceof CategoryDiscoveryError
        ? err.message
        : "AI couldn't analyze your catalog";
    return { quizId, degraded: `${msg} — ${STARTED_BLANK}.` };
  }
  if (buckets.length === 0) {
    return { quizId, degraded: `AI didn't find product groups — ${STARTED_BLANK}.` };
  }

  // 4. Reconcile buckets → result pages (bound via category_id).
  let doc = reconcileBucketsToResultNodes(
    seedDoc,
    buckets.map((b) => ({ id: b.id, name: b.name })),
    firstCollection,
  );

  const smartBuckets: SmartBuildBucket[] = [];
  for (const b of buckets) {
    const node = doc.nodes.find(
      (n) => n.type === "result" && n.data.category_id === b.id,
    );
    if (node) smartBuckets.push({ id: b.id, name: b.name, tags: b.tags, resultNodeId: node.id });
  }
  if (smartBuckets.length === 0) {
    await persist(quizId, doc);
    return { quizId, degraded: "We set up your result pages — add questions in the builder." };
  }

  // 5. Generate the question flow + wire it. On failure, keep the bound pages.
  const indexed = buildScopedIndex(allProducts, allCollections, doc.scope.collection_ids);
  const brandGuidelines = parseBrandGuidelinesSafe(shop?.brandGuidelines);
  // Optional enrichment: catalog tone sample + merchant website text. Both are
  // best-effort — ingestWebsite returns "" on any failure, never throwing.
  const toneSample = toneSampleFromCatalog(allProducts);
  const websiteText = input.websiteUrl ? await ingestWebsite(input.websiteUrl) : "";

  let generated;
  try {
    generated = await generateQuestionFlow({
      goalPrompt: input.goalPrompt,
      questionCount: input.questionCount,
      catalogSummary: indexed.summary,
      buckets: smartBuckets.map((b) => ({ id: b.id, name: b.name, tags: b.tags })),
      flow: input.flow,
      tone: input.tone,
      ...(toneSample ? { toneSample } : {}),
      ...(websiteText ? { websiteText } : {}),
      ...(brandGuidelines ? { brandGuidelines } : {}),
    });
  } catch (err) {
    await persist(quizId, doc);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      quizId,
      degraded: `AI set up your products + pages but couldn't write questions (${msg}) — add them in the builder.`,
    };
  }

  doc = applyQuestionFlow(doc, generated, smartBuckets);
  const parsed = Quiz.safeParse(doc);
  if (!parsed.success) {
    // Should not happen (applyQuestionFlow is tested), but never persist a
    // corrupt draft — fall back to the reconciled (questions-less) doc.
    const fallback = reconcileBucketsToResultNodes(
      seedDoc,
      buckets.map((b) => ({ id: b.id, name: b.name })),
      firstCollection,
    );
    await persist(quizId, fallback);
    return { quizId, degraded: "AI built a draft but it needs a tweak in the builder." };
  }

  // AI placement pre-selection (Dev Spec §2 Phase 4) — smart default by catalog
  // size; the merchant overrides via the editor's placement picker.
  const withPlacement = { ...parsed.data, placement: suggestPlacement(allProducts.length) };
  await prisma.quiz.update({ where: { id: quizId }, data: { draftJson: withPlacement as never } });
  return { quizId };
}

async function persist(quizId: string, doc: QuizDoc): Promise<void> {
  const parsed = Quiz.parse(doc);
  await prisma.quiz.update({ where: { id: quizId }, data: { draftJson: parsed as never } });
}
