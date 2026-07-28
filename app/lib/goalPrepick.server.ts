// FLOW-1 (funnel-reconfig Flow 1) — the "Write Your Goal" front door's server
// half: claim/seed the draft with the goal brief, then run the DETACHED AI
// product pre-pick that populates the recs surface for the merchant to refine.
//
// The pre-pick follows the funnel gen-job discipline exactly (step2Build):
// void-ed promise inside withAiSpendRecording, ONE budget check at kick, a
// gen_progress checkpoint at the real pass boundary, never-throw failure
// writes, and the shared 200s updatedAt-stall + retry-gen backstop (the loader
// treats goal_first.prepick === "picking" as gen-in-flight). The persisted
// selections are ordinary bucket Category rows — resolved server-side through
// bucketRowsFor (the persistConfirmedGroups trust boundary), so the AI's keys
// are only ever *which* catalog objects, never memberships.
import prisma from "../db.server";
import { logFor, reportError } from "./log.server";
import { withAiSpendRecording } from "./aiBudget.server";
import { Quiz, BuildSession } from "./quizSchema";
import { pickGoalBuckets } from "./claude";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { normalizeTags } from "./enrichTags";
import { suggestBucketStrategy } from "./bucketDetect";
import { inverseCollectionIndex } from "./categoryGrouping";
import { loadBucketInputs, toGroupingProduct } from "./bucketPersist.server";
import {
  bucketRowsFor,
  addBuckets,
  clearBuckets,
  type BucketType,
} from "./step1Build.server";
import {
  budgetAllowsGenJob,
  patchBuildSession,
  writeGenProgress,
} from "./step2Build.server";
import { claimGoalFirstDraft, loadFunnelDraft, writeDoc } from "./funnelDraft.server";
import { foldGoalBrief, friendlyPrepickError, resolveGoalPickRows } from "./goalPrepick";

// Candidate-product cap for the prompt (large catalogs steer through tags /
// collections anyway; the list is marked truncated past this).
const MAX_CANDIDATE_PRODUCTS = 150;

// ── The front door's begin step ──────────────────────────────────────────────

export interface GoalFirstBrief {
  goal: string;
  audience: string;
  factors: string;
  questionLength: number | null;
}

// Claim (or seed) the goal-first draft, write the brief + the flow marker onto
// its session, and kick the detached pre-pick. Returns the quiz id to redirect
// into the funnel at the recs step.
export async function beginGoalFirstFlow(
  shop: { id: string },
  brief: GoalFirstBrief,
): Promise<string> {
  const quizId = await claimGoalFirstDraft(shop.id);
  const { doc, session } = await loadFunnelDraft(shop.id, quizId);
  // A re-claimed goal-first draft may carry a prior pre-pick's selections —
  // the new goal replaces them (nothing downstream references them: the claim
  // guarantees nothing is built).
  await clearBuckets(shop.id, quizId);
  const goalBrief = foldGoalBrief(brief.goal, brief.audience, brief.factors);
  const next = BuildSession.parse({
    ...session,
    stage: "grouping",
    goal: { goal_text: goalBrief, struggle_text: session.goal?.struggle_text ?? "" },
    goal_first: {
      prepick: "picking",
      ...(brief.questionLength ? { question_length: brief.questionLength } : {}),
    },
    gen_error: undefined,
    gen_progress: undefined,
    quiz_types: [],
    picked_type_id: undefined,
    rich_templates: [],
    picked_template: undefined,
  });
  await writeDoc(quizId, { ...doc, build_session: next });
  startGoalPrepick(shop.id, quizId);
  return quizId;
}

// ── The detached pre-pick job ────────────────────────────────────────────────

// Persist a failed pre-pick onto goal_first (NOT gen_error — the recs surface
// renders this state as its own banner with the browser as the way forward,
// while gen_error's generic treatment carries a template escape that doesn't
// apply here). Never-throw: a throw in the void async would strand "picking"
// until the stall backstop.
async function failPrepick(quizId: string, error: string): Promise<void> {
  try {
    await patchBuildSession(quizId, (s) =>
      BuildSession.parse({
        ...s,
        goal_first: { ...(s.goal_first ?? { prepick: "picking" }), prepick: "failed", error },
        gen_progress: undefined,
      }),
    );
  } catch (e) {
    reportError(e, { scope: "goalPrepick", msg: "failed to persist prepick failure", quizId });
  }
}

export function startGoalPrepick(shopId: string, quizId: string): void {
  // BIC-2 A3 — the job bills the shop's merchant budget; ceiling checked ONCE
  // at kick. Every path below is caught or never-throw, so the void is safe.
  void withAiSpendRecording(shopId, async () => {
    const allowed = await budgetAllowsGenJob(shopId, quizId, () =>
      failPrepick(
        quizId,
        "Today's AI generation limit for this shop is reached — choose your products below, or try again tomorrow.",
      ),
    );
    if (!allowed) return;
    try {
      await writeGenProgress(quizId, "products");
      const t = Date.now();

      const [products, collections, shopRow, draft] = await Promise.all([
        prisma.product.findMany({ where: { shopId } }),
        prisma.collection.findMany({
          where: { shopId },
          select: { collectionId: true, title: true },
        }),
        prisma.shop.findUnique({ where: { id: shopId }, select: { brandIdentity: true } }),
        prisma.quiz.findUnique({ where: { id: quizId }, select: { draftJson: true } }),
      ]);
      const parsed = draft ? Quiz.safeParse(draft.draftJson) : null;
      const goal = parsed?.success ? parsed.data.build_session?.goal?.goal_text ?? "" : "";
      const grouping = products.map(toGroupingProduct);

      // Candidate lists — the same identities the recs browser offers, so the
      // AI can only pick things the merchant could have clicked. Tags tally by
      // NORMALIZED key (round-trips through resolveByTag); collections carry
      // real member counts; products cap at MAX_CANDIDATE_PRODUCTS.
      const tagTally = new Map<string, { label: string; count: number }>();
      for (const p of grouping) {
        const seen = new Set<string>();
        for (const raw of p.tags) {
          const [norm] = normalizeTags([raw], new Set());
          if (!norm || seen.has(norm)) continue;
          seen.add(norm);
          const entry = tagTally.get(norm);
          if (entry) entry.count += 1;
          else tagTally.set(norm, { label: raw.trim() || norm, count: 1 });
        }
      }
      const invIdx = inverseCollectionIndex(grouping);
      const candidates = {
        products: grouping
          .slice(0, MAX_CANDIDATE_PRODUCTS)
          .map((p) => ({ id: p.productId, title: p.title })),
        tags: [...tagTally.entries()]
          .map(([key, v]) => ({ key, label: v.label, count: v.count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        collections: collections
          .map((c) => ({
            key: c.collectionId,
            label: c.title,
            count: (invIdx.get(c.collectionId) ?? []).length,
          }))
          .filter((c) => c.count > 0)
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      };

      const identity = parseBrandIdentitySafe(shopRow?.brandIdentity);
      const pick = await pickGoalBuckets({
        goal,
        brandSummary: identity?.summary ?? "",
        candidates,
      });

      const inputs = await loadBucketInputs(shopId);
      let rows = resolveGoalPickRows(pick, inputs);
      let strategy: BucketType = pick.strategy;
      let rationale = pick.rationale;
      if (rows.length === 0) {
        // Every key dropped in resolution (stale/hallucinated) — fall back to
        // the deterministic bucket-strategy suggestion before giving up.
        const suggestion = suggestBucketStrategy(
          grouping,
          collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
        );
        if (suggestion.apply) {
          rows = bucketRowsFor(
            suggestion.apply.keys.map((key) => ({ type: suggestion.apply!.type, key })),
            inputs.products,
            inputs.collections,
            inputs.productTitleById,
            inputs.collectionTitleById,
          );
          strategy = suggestion.apply.type;
          rationale = suggestion.reason;
        }
      }
      if (rows.length === 0) {
        await failPrepick(
          quizId,
          "We couldn't match products to that goal — choose them below.",
        );
        return;
      }

      // Replace the draft's selections with the pick (the claim/begin step
      // already cleared any prior set; clearing again keeps a Retry honest).
      await clearBuckets(shopId, quizId);
      await addBuckets(shopId, quizId, rows);
      await patchBuildSession(quizId, (s) =>
        BuildSession.parse({
          ...s,
          goal_first: {
            ...(s.goal_first ?? { prepick: "picking" }),
            prepick: "ready",
            rationale: rationale.slice(0, 300),
            error: undefined,
          },
          bucket_browser: {
            banner_dismissed: s.bucket_browser?.banner_dismissed ?? false,
            active_tab: strategy,
          },
          gen_progress: undefined,
        }),
      );
      logFor("goalPrepick").info(
        { quizId, ms: Date.now() - t, strategy, picked: rows.length },
        "goal pre-pick done",
      );
    } catch (err) {
      reportError(err, { scope: "goalPrepick", msg: "goal pre-pick failed", shopId, quizId });
      await failPrepick(quizId, friendlyPrepickError(err));
    }
  });
}
