// FLOW-3 (funnel-reconfig Flow 3) — the "Generate Quiz Templates" front door's
// server half: claim/seed the draft, run the DETACHED candidate generation
// (the Shape typing/types middle pass repurposed — the SAME generateStep2Types
// call, surfaced as candidate cards instead of a Shape stage), and turn a card
// click into a pre-populated recs entry.
//
// The job follows the funnel gen-job discipline exactly (step2Build): void-ed
// promise inside withAiSpendRecording, ONE budget check at kick, a gen_progress
// checkpoint at the real pass boundary, never-throw failure writes, and the
// shared 200s updatedAt-stall backstop (the templates page computes it from
// quiz.updatedAt and re-kicks via its retry intent). Candidates persist in the
// session's existing quiz_types field, so the confirm + retry-gen machinery
// downstream reads them exactly like a Shape pick.
//
// AI-SPEND POSTURE: the candidate pass resolves web research from the shop
// cache ONLY (peekFreshShopWebResearch — cached text or the degraded
// model-knowledge path). A homepage browse surface must never block ~40s or
// bill a research run just to draw candidate cards; the whole flow-3 happy path
// stays at 3 calls (candidates → confirm's templates → question build).
import prisma from "../db.server";
import { logFor, reportError } from "./log.server";
import { withAiSpendRecording } from "./aiBudget.server";
import { Quiz, BuildSession } from "./quizSchema";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { suggestQuizGoal } from "./goalSuggest";
import { detectGroupingDimension } from "./groupingDetect";
import { suggestBucketStrategy } from "./bucketDetect";
import { isDetachedJobStalled } from "./stall.server";
import { peekFreshShopWebResearch } from "./shopWebResearch.server";
import { toGroupingProduct, loadBucketInputs } from "./bucketPersist.server";
import { bucketRowsFor, addBuckets, clearBuckets } from "./step1Build.server";
import {
  budgetAllowsGenJob,
  generateStep2Types,
  patchBuildSession,
  writeGenProgress,
} from "./step2Build.server";
import { loadSavedTemplate } from "./savedTemplates.server";
import { claimTemplateFirstDraft, loadFunnelDraft, writeDoc } from "./funnelDraft.server";
import { TEMPLATE_GEN_LIMIT_ERROR, friendlyTemplateGenError } from "./templateCandidates";

// ── The front door's begin step ──────────────────────────────────────────────

// Claim (or seed) the template-first draft and make sure candidates exist or
// are on their way. Kicks the detached generation ONLY on a draft that has
// never attempted it (template_first absent) — a failed or stalled run waits
// for the merchant's explicit Retry (the loader polls; auto-re-kicking here
// would loop spend on every poll). Returns the quiz id the page works against.
export async function ensureTemplateCandidates(shop: { id: string }): Promise<string> {
  const quizId = await claimTemplateFirstDraft(shop.id);
  const { session } = await loadFunnelDraft(shop.id, quizId);
  if (session.template_first === undefined) {
    await beginTemplateCandidates(shop.id, quizId);
  }
  return quizId;
}

// Write the flow marker + a derived goal onto the session and kick the detached
// candidate generation. Also the Retry re-kick (writeDoc resets updatedAt, so
// the stall clears — the retry-gen precedent).
export async function beginTemplateCandidates(shopId: string, quizId: string): Promise<void> {
  const { doc, session } = await loadFunnelDraft(shopId, quizId);
  // Derive the goal deterministically (the continue-buckets precedent): brand
  // identity + detected groups. No AI call; the merchant's own goal (a resumed
  // template-first draft) always wins.
  const [products, collections, shopRow] = await Promise.all([
    prisma.product.findMany({ where: { shopId } }),
    prisma.collection.findMany({ where: { shopId } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { brandIdentity: true } }),
  ]);
  const detect = detectGroupingDimension(
    products.map(toGroupingProduct),
    collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
  );
  const suggestedGoal = suggestQuizGoal({
    identitySummary: parseBrandIdentitySafe(shopRow?.brandIdentity)?.summary ?? null,
    groupNames: detect.proposed.map((g) => g.name),
  });
  const next = BuildSession.parse({
    ...session,
    stage: "grouping",
    goal: session.goal?.goal_text ? session.goal : { goal_text: suggestedGoal, struggle_text: "" },
    template_first: { gen: "picking" },
    quiz_types: [],
    picked_type_id: undefined,
    gen_error: undefined,
    gen_progress: undefined,
  });
  await writeDoc(quizId, { ...doc, build_session: next });
  startTemplateCandidates(shopId, quizId);
}

// ── The detached candidate-generation job ────────────────────────────────────

// Persist a failed run onto template_first (NOT gen_error — the templates page
// renders this state as its own banner with the starter rail as the way
// forward). Never-throw: a throw in the void async would strand "picking"
// until the stall backstop.
async function failTemplateGen(quizId: string, error: string): Promise<void> {
  try {
    await patchBuildSession(quizId, (s) =>
      BuildSession.parse({
        ...s,
        template_first: { ...(s.template_first ?? {}), gen: "failed", error },
        gen_progress: undefined,
      }),
    );
  } catch (e) {
    reportError(e, { scope: "flow3", msg: "failed to persist template-gen failure", quizId });
  }
}

export function startTemplateCandidates(shopId: string, quizId: string): void {
  // BIC-2 A3 — the job bills the shop's merchant budget; ceiling checked ONCE
  // at kick. Every path below is caught or never-throw, so the void is safe.
  void withAiSpendRecording(shopId, async () => {
    const allowed = await budgetAllowsGenJob(shopId, quizId, () =>
      failTemplateGen(quizId, TEMPLATE_GEN_LIMIT_ERROR),
    );
    if (!allowed) return;
    try {
      await writeGenProgress(quizId, "types");
      const t = Date.now();
      // Cached research only — see the module header's spend posture.
      const cachedResearch = (await peekFreshShopWebResearch(shopId)) ?? "";
      const draft = await prisma.quiz.findUnique({
        where: { id: quizId },
        select: { draftJson: true },
      });
      const parsed = draft ? Quiz.safeParse(draft.draftJson) : null;
      const goal = parsed?.success ? parsed.data.build_session?.goal?.goal_text ?? "" : "";
      // The SAME middle pass Shape's typing job runs (generated-to-differ:
      // the types schema demands 2-3 cards spanning distinct experience types).
      const { types } = await generateStep2Types(shopId, quizId, {
        goal,
        webResearchText: cachedResearch,
      });
      await patchBuildSession(quizId, (s) =>
        BuildSession.parse({
          ...s,
          quiz_types: types,
          web_research_summary: cachedResearch.slice(0, 600),
          template_first: { ...(s.template_first ?? {}), gen: "ready", error: undefined },
          gen_progress: undefined,
        }),
      );
      logFor("flow3").info(
        { quizId, ms: Date.now() - t, candidates: types.length },
        "template candidates ready",
      );
    } catch (err) {
      reportError(err, { scope: "flow3", msg: "template candidate generation failed", shopId, quizId });
      await failTemplateGen(quizId, friendlyTemplateGenError(err));
    }
  });
}

// ── Picks (a card click → the pre-populated recs entry) ──────────────────────

export type PickResult = { ok: true } | { ok: false; error: string };

// A generated candidate card. Stores the pick (picked_type_id + the flow
// marker) so flow3-confirm short-circuits the types pass, then pre-populates
// the recs surface with the deterministic bucket suggestion — the same
// catalog-grounded scope the candidate generation read (the "derivable scope"
// of a generated candidate). $0: no AI call anywhere on this path.
export async function pickTemplateCandidate(
  shop: { id: string },
  quizId: string,
  typeId: string,
): Promise<PickResult> {
  const { doc, session } = await loadFunnelDraft(shop.id, quizId);
  if (doc.logic_model !== "decider" || session.template_first === undefined) {
    return { ok: false, error: "This flow isn't available for this quiz." };
  }
  const type = session.quiz_types.find((t) => t.id === typeId);
  if (!type) return { ok: false, error: "That candidate is no longer available." };
  const next = BuildSession.parse({
    ...session,
    stage: "grouping",
    picked_type_id: type.id,
    // A candidate pick starts a FRESH chain — stale starter artifacts from a
    // prior pick would misroute retry-gen (the flow1-confirm precedent).
    rich_templates: [],
    picked_template: undefined,
    template_first: { ...session.template_first, picked: "candidate" },
    gen_error: undefined,
  });
  await writeDoc(quizId, { ...doc, build_session: next });
  await suggestBucketsForPick(shop.id, quizId);
  return { ok: true };
}

// A starter / shop-saved template pill. Stores the RichTemplateOption (bucket
// ids neutralized — the use-saved-template precedent: source-quiz Category
// cuids match nothing here) so flow3-confirm short-circuits BOTH middle passes
// straight into the question build. A starter's scope is not derivable from
// this shop's catalog, so no buckets are pre-populated — the recs browser (and
// its own AI suggestion banner) is the way forward.
export async function pickStarterTemplate(
  shop: { id: string },
  quizId: string,
  templateId: string,
): Promise<PickResult> {
  const { doc, session } = await loadFunnelDraft(shop.id, quizId);
  if (doc.logic_model !== "decider") {
    return { ok: false, error: "This flow isn't available for this quiz." };
  }
  const rich = await loadSavedTemplate(shop.id, templateId);
  if (!rich) return { ok: false, error: "That template is no longer available." };
  const richForDraft = { ...rich, recommended_bucket_ids: [] };
  const next = BuildSession.parse({
    ...session,
    stage: "grouping",
    picked_type_id: undefined,
    rich_templates: [richForDraft],
    picked_template: undefined,
    template_first: { ...(session.template_first ?? {}), picked: "template" },
    goal: session.goal?.goal_text
      ? session.goal
      : { goal_text: richForDraft.angle, struggle_text: "" },
    gen_error: undefined,
  });
  await writeDoc(quizId, { ...doc, build_session: next });
  return { ok: true };
}

// Pre-populate the recs surface from the deterministic bucket-strategy
// suggestion (bucketDetect — the §4 banner's exact "Use this" set). Membership
// re-resolves through bucketRowsFor (the persistConfirmedGroups trust
// boundary). Best-effort: an empty/no-apply result simply leaves the browser
// empty, which the recs surface already handles.
async function suggestBucketsForPick(shopId: string, quizId: string): Promise<void> {
  try {
    const inputs = await loadBucketInputs(shopId);
    const suggestion = suggestBucketStrategy(
      inputs.products,
      inputs.collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
    );
    const apply = suggestion.apply;
    if (!apply) return;
    const rows = bucketRowsFor(
      apply.keys.map((key) => ({ type: apply.type, key })),
      inputs.products,
      inputs.collections,
      inputs.productTitleById,
      inputs.collectionTitleById,
    );
    if (rows.length === 0) return;
    // Replace any prior pick's selections (a re-pick is a fresh direction —
    // the goalPrepick precedent; the claim guarantees nothing downstream
    // references them).
    await clearBuckets(shopId, quizId);
    await addBuckets(shopId, quizId, rows);
    await patchBuildSession(quizId, (s) =>
      BuildSession.parse({
        ...s,
        bucket_browser: {
          banner_dismissed: s.bucket_browser?.banner_dismissed ?? false,
          active_tab: apply.type,
        },
      }),
    );
  } catch (e) {
    reportError(e, { scope: "flow3", msg: "bucket pre-population failed", shopId, quizId });
  }
}

// The templates page's stall verdict (shared 200s rule) — computed here so the
// route stays a thin wrapper.
export function templateGenStalled(session: BuildSession, updatedAt: Date): boolean {
  return session.template_first?.gen === "picking" && isDetachedJobStalled(updatedAt);
}
