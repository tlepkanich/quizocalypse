import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import type { Quiz as QuizDoc, OosBehavior } from "./quizSchema";
import type { DesignTokensT } from "./designTokens";
import { buildSeedQuiz } from "./seedQuiz";
import {
  buildScopedIndex,
  scopeCatalogToChosen,
  toneSampleFromCatalog,
  suggestPlacement,
} from "./catalogIndex";
import { ingestWebsite } from "./websiteIngest.server";
import {
  discoverAndPersistBuckets,
  BucketDiscoveryError,
} from "./bucketDiscovery.server";
import { CategoryDiscoveryError } from "./categoryDiscover";
import { reconcileBucketsToResultNodes } from "./bucketReconcile";
import { generateQuestionFlow, type QuizTone } from "./claude";
import { applyQuestionFlow, applyDeciderQuestionFlow, type SmartBuildBucket } from "./smartBuild";
import { parseBrandGuidelinesSafe, type BrandGuidelines } from "./brandGuidelines";
import { identityToBrandGuidelines, parseBrandIdentitySafe } from "./brandIdentity";

// Step 1 — generation reads the BRAND IDENTITY first (its voice, via the
// dormant adapter, activated here as the first real consumer), falling back to
// any uploaded brand guidelines. The identity is the on-brand seed for every
// AI build now.
function effectiveBrandGuidelines(
  shopRow: { brandGuidelines: unknown; brandIdentity: unknown } | null | undefined,
): BrandGuidelines | null {
  const fromIdentity = identityToBrandGuidelines(parseBrandIdentitySafe(shopRow?.brandIdentity));
  return fromIdentity ?? parseBrandGuidelinesSafe(shopRow?.brandGuidelines);
}

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
  // Wizard Step-4 choices baked into the built quiz. When placement is absent,
  // suggestPlacement() picks a smart default; collectEmailOnResult sets the
  // result-page email-capture toggle when provided.
  placement?: "page" | "popup" | "inline" | "product_widget";
  collectEmailOnResult?: boolean;
  // Experiences E2 — shapes the whole build: survey/lead_capture skip the
  // catalog phases entirely; personality keeps the product path with persona
  // framing. Absent = product_match.
  experienceType?: "product_match" | "personality" | "lead_capture" | "survey";
  // The wizard's picked goals (labels) — extra context for the AI prompt.
  goalLabels?: string[];
  // When set, build into this EXISTING quiz row instead of creating one — used
  // by startAiOnboardingBuild for the detached/async path (the row is
  // pre-created so the request can redirect immediately). Omitted = legacy
  // synchronous path (the function creates the row itself).
  quizId?: string;
  // Step 1 funnel — the merchant already CONFIRMED the grouping (Category rows
  // persisted), so skip the AI bucket-discovery phase and reconcile these
  // straight into result pages. Absent = the wizard path (discover buckets).
  preResolvedBuckets?: Array<{ id: string; name: string; tags: string[] }>;
  // Step 1 funnel — the picked direction's angle + its sample questions, woven
  // into the goal context so the full build honors the direction the merchant
  // saw on the card (expand-and-refine, not copy).
  directionAngle?: string;
  sampleQuestionSeeds?: string[];
  // Step 2 battle-card overrides. `tokenPatch` overlays the seed design tokens
  // (radius/spacing from the Lines/Graphics dials); `dialDirectives` append to the
  // generation goal context (imagery/word-forward/graphics steering); `recOverride`
  // is applied to every built result node's ResultData.
  tokenPatch?: Partial<DesignTokensT>;
  dialDirectives?: string;
  recOverride?: { max_products: number; oos_behavior: OosBehavior; fallback_collection_id: string };
  // LOGIC v2 (L2-10c) — build a ONE-DECIDER doc: the seed is stamped
  // logic_model="decider" (and the stamp survives every persist path, because
  // this function re-seeds draftJson), the flow takes the bucket path
  // unconditionally, email_gate is forced OFF (the §7 reveal capture owns
  // contact), and applyDeciderQuestionFlow wires the flow instead of the
  // legacy per-bucket branch choreography. Absent → byte-identical legacy build.
  logicModel?: "decider";
  // The draft's existing Step-4 config (capture toggles, §6 fallbacks, copy),
  // threaded through the re-seed exactly like design_tokens — without it a
  // Shape-step regenerate would silently wipe the merchant's rec-page setup.
  recPageSettings?: QuizDoc["rec_page_settings"];
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

  // 1. Seed the quiz, applying the merchant's picked design tokens. Reuse a
  // pre-created row when quizId is supplied (async path); otherwise create one
  // (legacy synchronous path). seedDoc is the in-memory working copy either way.
  const xtype = input.experienceType ?? "product_match";
  let goalContext =
    input.goalLabels && input.goalLabels.length > 0
      ? `${input.goalPrompt}\n\nMerchant goals: ${input.goalLabels.join(", ")}.`
      : input.goalPrompt;
  // Step 1 funnel — weave the picked direction into the goal so the full build
  // honors the card the merchant chose (expand-and-refine, never copy verbatim).
  if (input.directionAngle) {
    goalContext += `\n\nQuiz direction: ${input.directionAngle}`;
  }
  if (input.sampleQuestionSeeds && input.sampleQuestionSeeds.length > 0) {
    goalContext += `\n\nThe merchant picked a direction with these example questions — build in the same spirit, expanding and refining (don't copy them verbatim):\n${input.sampleQuestionSeeds
      .map((q) => `- ${q}`)
      .join("\n")}`;
  }
  // Step 2 — the design dials' generation directives (imagery/word-forward/graphics).
  if (input.dialDirectives) {
    goalContext += `\n\n${input.dialDirectives}`;
  }
  const seed = buildSeedQuiz(name, xtype);
  // Step 2 — overlay the dials' tokenPatch (radius/spacing) onto the base tokens
  // (the merchant's designTokens if any, else the seed's house tokens).
  const baseTokens = input.designTokens ?? seed.design_tokens;
  const finalTokens = input.tokenPatch ? { ...baseTokens, ...input.tokenPatch } : baseTokens;
  // LOGIC v2 — stamp the SEED (not just the final doc): every degraded /
  // fallback persist path below writes seedDoc or a derivative, so the stamp
  // can never be lost mid-build (the stamp-loss risk).
  const decider = input.logicModel === "decider";
  const seedDoc: QuizDoc =
    input.designTokens || input.tokenPatch || decider
      ? Quiz.parse({
          ...seed,
          design_tokens: finalTokens,
          ...(decider ? { logic_model: "decider" as const } : {}),
          // Carry the merchant's Step-4 config through the re-seed (the
          // design_tokens pattern); applyDeciderQuestionFlow's ?? guard then
          // keeps it instead of seeding fresh defaults.
          ...(decider && input.recPageSettings
            ? { rec_page_settings: input.recPageSettings }
            : {}),
        })
      : seed;
  // §7 — the decider reveal owns contact capture; a generated email gate would
  // double-gate shoppers, so force the flow flag off for decider builds.
  const flow = decider ? { ...input.flow, email_gate: false } : input.flow;
  const quizId =
    input.quizId ??
    (
      await prisma.quiz.create({
        data: { shopId, name, status: "draft", draftJson: seedDoc as never },
      })
    ).id;

  // Experiences E2 — survey/lead_capture don't need the catalog at all:
  // generate questions straight onto the seed (no buckets, no result pages;
  // applyQuestionFlow wires questions → end when no results exist).
  // LOGIC v2 — decider builds ALWAYS take the bucket path below (the funnel
  // supplies preResolvedBuckets; a bucketless decider doc can't pass V1).
  if ((xtype === "survey" || xtype === "lead_capture") && !decider) {
    const shopRow = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { brandGuidelines: true, brandIdentity: true },
    });
    const bg = effectiveBrandGuidelines(shopRow);
    const siteText = input.websiteUrl ? await ingestWebsite(input.websiteUrl) : "";
    try {
      const generated = await generateQuestionFlow({
        goalPrompt: goalContext,
        questionCount: input.questionCount,
        catalogSummary: "",
        buckets: [],
        flow,
        tone: input.tone,
        experienceType: xtype,
        ...(siteText ? { websiteText: siteText } : {}),
        ...(bg ? { brandGuidelines: bg } : {}),
      });
      const wired = applyQuestionFlow(seedDoc, generated, []);
      const ok = Quiz.safeParse(wired);
      if (ok.success) {
        const finalDoc: QuizDoc = {
          ...ok.data,
          placement: input.placement ?? "page",
          ...(input.collectEmailOnResult !== undefined
            ? { collect_email_on_result: input.collectEmailOnResult }
            : {}),
        };
        await persist(quizId, finalDoc);
        return { quizId };
      }
      await persist(quizId, seedDoc);
      return { quizId, degraded: "AI built a draft but it needs a tweak in the builder." };
    } catch (err) {
      await persist(quizId, seedDoc);
      const msg = err instanceof Error ? err.message : String(err);
      return { quizId, degraded: `AI couldn't write questions (${msg}) — add them in the builder.` };
    }
  }

  // 2. Catalog: a fallback collection is REQUIRED to create result pages.
  const [allProducts, allCollections, shop] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { brandGuidelines: true, brandIdentity: true },
    }),
  ]);
  const firstCollection = allCollections[0]?.collectionId ?? "";
  if (!firstCollection) {
    return {
      quizId,
      degraded: `Sync at least one Shopify collection so AI can build result pages — ${STARTED_BLANK}.`,
    };
  }

  // 3. Buckets. The Step-1 funnel already confirmed + persisted the grouping, so
  // use those rows directly (skip the AI discovery phase entirely); the wizard
  // path discovers them. On any failure, keep the blank seed.
  let buckets: Array<{ id: string; name: string; tags: string[] }>;
  if (input.preResolvedBuckets) {
    buckets = input.preResolvedBuckets;
  } else {
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
  }
  if (buckets.length === 0) {
    return { quizId, degraded: `AI didn't find product groups — ${STARTED_BLANK}.` };
  }

  // 4. Reconcile buckets → result pages (bound via category_id). LOGIC v2 —
  // the legacy per-bucket result choreography never applies to decider docs
  // (ONE reveal terminus, created by applyDeciderQuestionFlow below), so the
  // reconcile + smartBuckets stage is skipped entirely for them.
  let doc = seedDoc;
  const smartBuckets: SmartBuildBucket[] = [];
  if (!decider) {
    doc = reconcileBucketsToResultNodes(
      seedDoc,
      buckets.map((b) => ({ id: b.id, name: b.name })),
      firstCollection,
    );
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
  }

  // 5. Generate the question flow + wire it. On failure, keep the bound pages.
  // Owner intent: the quiz the Shape page generates — its QUESTIONS and ANSWERS,
  // not just its type/template name — must ground in the merchant's CHOSEN
  // recommended products (the confirmed buckets), NOT the whole catalog. Scope the
  // catalog summary the question-writer AI reads to the union of those buckets'
  // products. scopeCatalogToChosen falls back to the full catalog when the quiz has
  // no buckets or the ids are stale, so this never starves generation (and is
  // byte-identical to the prior full-catalog behavior in the no-bucket case).
  const chosenProductIds = new Set(
    (
      await prisma.category.findMany({ where: { shopId, quizId }, select: { productIds: true } })
    ).flatMap((c) => c.productIds),
  );
  const chosenScope = scopeCatalogToChosen(allProducts, allCollections, chosenProductIds);
  const indexed = buildScopedIndex(
    chosenScope.products,
    chosenScope.collections,
    doc.scope.collection_ids,
  );
  const brandGuidelines = effectiveBrandGuidelines(shop);
  // Optional enrichment: catalog tone sample + merchant website text. Both are
  // best-effort — ingestWebsite returns "" on any failure, never throwing.
  const toneSample = toneSampleFromCatalog(allProducts);
  const websiteText = input.websiteUrl ? await ingestWebsite(input.websiteUrl) : "";

  let generated;
  try {
    generated = await generateQuestionFlow({
      goalPrompt: goalContext,
      experienceType: xtype,
      questionCount: input.questionCount,
      catalogSummary: indexed.summary,
      buckets: (decider ? buckets : smartBuckets).map((b) => ({
        id: b.id,
        name: b.name,
        tags: b.tags,
      })),
      flow,
      tone: input.tone,
      ...(decider ? { logicModel: "decider" as const } : {}),
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

  doc = decider
    ? applyDeciderQuestionFlow(
        seedDoc,
        generated,
        buckets,
        // The merchant's rec-defaults fallback (when set) is the fallback the
        // engine should actually use — seed BOTH the legacy node field and the
        // §6 emptyFallbackCol from it, so the two knobs never silently diverge.
        input.recOverride?.fallback_collection_id || firstCollection,
      )
    : applyQuestionFlow(doc, generated, smartBuckets);
  const parsed = Quiz.safeParse(doc);
  if (!parsed.success) {
    // Should not happen (both merges are tested), but never persist a corrupt
    // draft. Decider fallback = the stamped seed (reconcile deliberately
    // no-ops result creation for decider docs); legacy = the reconciled pages.
    const fallback = decider
      ? seedDoc
      : reconcileBucketsToResultNodes(
          seedDoc,
          buckets.map((b) => ({ id: b.id, name: b.name })),
          firstCollection,
        );
    await persist(quizId, fallback);
    return { quizId, degraded: "AI built a draft but it needs a tweak in the builder." };
  }

  // Placement: the wizard's explicit choice wins; otherwise AI pre-selects by
  // catalog size (Dev Spec §2 Phase 4). collectEmailOnResult is baked when set.
  const withFinalFields: QuizDoc = {
    ...parsed.data,
    placement: input.placement ?? suggestPlacement(allProducts.length),
    ...(input.collectEmailOnResult !== undefined
      ? { collect_email_on_result: input.collectEmailOnResult }
      : {}),
  };
  // Step 2 — bake the battle-card recommendation settings onto every result node.
  const finalDoc = input.recOverride
    ? applyRecOverride(withFinalFields, input.recOverride)
    : withFinalFields;
  await prisma.quiz.update({ where: { id: quizId }, data: { draftJson: finalDoc as never } });
  return { quizId };
}

// Step 2 — apply the merchant's rec_defaults to every result node's ResultData
// (max_products + oos_behavior always; fallback only when the merchant set one,
// else the build's required firstCollection fallback stands).
function applyRecOverride(
  doc: QuizDoc,
  rec: NonNullable<OnboardingBuildInput["recOverride"]>,
): QuizDoc {
  const nodes = doc.nodes.map((n) =>
    n.type === "result"
      ? {
          ...n,
          data: {
            ...n.data,
            max_products: rec.max_products,
            oos_behavior: rec.oos_behavior,
            ...(rec.fallback_collection_id
              ? { fallback_collection_id: rec.fallback_collection_id }
              : {}),
          },
        }
      : n,
  );
  return { ...doc, nodes };
}

async function persist(quizId: string, doc: QuizDoc): Promise<void> {
  const parsed = Quiz.parse(doc);
  await prisma.quiz.update({ where: { id: quizId }, data: { draftJson: parsed as never } });
}

/**
 * Start an AI onboarding build WITHOUT blocking the request. Creates the quiz
 * row immediately (status draft, buildState "building", seeded draft) so the
 * caller can redirect straight into the editor, then runs the real build
 * DETACHED. The editor polls `buildState`: it clears to null on completion
 * (success OR a graceful degraded result) or becomes "error:<msg>" on an
 * unexpected throw.
 *
 * Safe on Fly because the app runs an always-on machine (min_machines_running=1),
 * so the floating promise survives after the response is sent. This decoupling
 * is REQUIRED: the full build (~75s of sequential AI calls) outruns the edge
 * proxy's ~60s connection timeout, so it cannot complete inline.
 */
export async function startAiOnboardingBuild(
  input: Omit<OnboardingBuildInput, "quizId">,
): Promise<{ quizId: string }> {
  const seed = buildSeedQuiz(input.name, input.experienceType);
  // LOGIC v2 — stamp the immediately-visible pre-build draft too, so the row
  // is a decider doc from the very first read (never retroactively mid-build).
  const seedDoc: QuizDoc =
    input.designTokens || input.logicModel === "decider"
      ? Quiz.parse({
          ...seed,
          ...(input.designTokens ? { design_tokens: input.designTokens } : {}),
          ...(input.logicModel === "decider" ? { logic_model: "decider" as const } : {}),
        })
      : seed;
  const created = await prisma.quiz.create({
    data: {
      shopId: input.shopId,
      name: input.name,
      status: "draft",
      buildState: "building",
      draftJson: seedDoc as never,
    },
  });
  const quizId = created.id;

  // Detached — intentionally NOT awaited. runAiOnboardingBuild swallows its own
  // failures (returns a degraded draft), so .then handles the normal path;
  // .catch only fires on an unexpected throw.
  void runAiOnboardingBuild({ ...input, quizId })
    .then(() =>
      prisma.quiz.update({ where: { id: quizId }, data: { buildState: null } }),
    )
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.quiz
        .update({ where: { id: quizId }, data: { buildState: `error:${msg.slice(0, 300)}` } })
        .catch(() => {});
    });

  return { quizId };
}
