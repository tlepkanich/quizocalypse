// QRTZ-G1 — speculative question-gen prefetch: the I/O half.
//
// The owner-relayed feedback: the wait between choosing recommendations and
// seeing generated questions "takes a lotttt of time". The FAST program
// already prefetches web research at funnel entry; this extends the same
// pattern one stage deeper — while the merchant's chosen pool SITS SETTLED on
// the buckets step, run the exact chain their Continue would kick (types →
// templates → question build) and HOLD the result in the draft-side
// build_session.speculative field. On Continue: a matching READY result
// applies instantly; a matching in-flight run is attached to; anything else
// runs the normal path untouched.
//
// Load-bearing guards (each has a decision table in specPrefetch.ts):
//  • the visible funnel stage is NEVER advanced by speculation — only the
//    Continue intents (funnelIntents.server.ts) move the stage machine;
//  • one live speculation per draft: a new settle with a different signature
//    replaces the marker, and the superseded chain halts at its next pass
//    boundary (specAlive) — it can never write results;
//  • speculative spend goes through the SAME merchant aiBudget guard as every
//    gen job: checked at kick (the intent), recorded via withAiSpendRecording;
//  • failure honesty: an UN-committed speculative failure is silently
//    tombstoned (the merchant never sees an error for work they didn't ask
//    for); a COMMITTED failure lands the same blank-Questions notice the
//    normal headless chain uses.
import prisma from "../db.server";
import { logFor, reportError } from "./log.server";
import { withAiSpendRecording } from "./aiBudget.server";
import { Quiz, BuildSession, QuizType as QuizTypeSchema } from "./quizSchema";
import type { Quiz as QuizDocT } from "./quizSchema";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { suggestQuizGoal } from "./goalSuggest";
import {
  generateStep2Types,
  generateStep2Templates,
  initPickedTemplate,
  buildQuizFromPicked,
  failToBlankQuestions,
  patchBuildSession,
  writeGenProgress,
} from "./step2Build.server";
import {
  getOrStartShopWebResearch,
  peekFreshShopWebResearch,
} from "./shopWebResearch.server";
import { poolSignature } from "./specPrefetch";
import { loadGenerationBuckets, refreshBucketMembership } from "./bucketPersist.server";
import { MIN_GOAL_CHARS } from "./funnelDraft.server";

type SpeculativeState = NonNullable<BuildSession["speculative"]>;

// The held artifacts a finished chain produces — the same set the normal
// headless chain persists into the session, plus the captured doc.
type SpecArtifacts = Pick<
  SpeculativeState,
  | "quiz_types"
  | "picked_type_id"
  | "rich_templates"
  | "picked_template"
  | "web_research_summary"
  | "doc"
>;

export interface SpecInputs {
  signature: string;
  goal: string;
  struggle: string;
  questionLength?: number;
  flow: "goal_first" | "ai_generate";
  cats: Array<{ id: string; name: string; tags: string[]; productIds: string[] }>;
}

// ONE derivation for both sides of the contract: the settle ping (speculate
// intent) and the Continue intents compute the signature through this exact
// function, so a match means the chains' inputs are equivalent by
// construction. Returns null when the draft/flow isn't speculable:
//  • legacy (non-decider) docs — never speculated, byte-identical forever;
//  • FLOW-3 (template_first) — its confirm short-circuits the middle passes
//    differently; it keeps the normal path;
//  • goal-first drafts whose pre-pick hasn't landed (or whose goal is too
//    short to pass flow1-confirm's own gate);
//  • an empty pool.
export async function resolveSpecInputs(
  shopId: string,
  quizId: string,
  doc: QuizDocT,
  session: BuildSession,
): Promise<SpecInputs | null> {
  if (doc.logic_model !== "decider") return null;
  if (session.template_first?.picked) return null;
  let flow: "goal_first" | "ai_generate";
  let goal = "";
  let struggle = "";
  let questionLength: number | undefined;
  if (session.goal_first) {
    if (session.goal_first.prepick !== "ready") return null;
    goal = session.goal?.goal_text ?? "";
    if (goal.trim().length < MIN_GOAL_CHARS) return null;
    struggle = session.goal?.struggle_text ?? "";
    questionLength = session.goal_first.question_length;
    flow = "goal_first";
  } else {
    // FLOW-2 (continue-buckets): the goal is DERIVED, exactly as the intent
    // derives it — deterministic given the identity + the pool's names.
    flow = "ai_generate";
  }
  // Refresh collection/tag membership snapshots BEFORE deriving the pool
  // signature, so settle-time and Continue-time both sign the LIVE membership —
  // otherwise a catalog resync mid-browse would guarantee a signature mismatch
  // and waste every speculation. loadGenerationBuckets keeps invisible
  // ai-discovery leftovers out of the pool, matching the Continue intents.
  await refreshBucketMembership(shopId, quizId);
  const cats = await loadGenerationBuckets(shopId, quizId);
  if (cats.length === 0) return null;
  if (flow === "ai_generate") {
    const shopRow = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { brandIdentity: true },
    });
    goal = suggestQuizGoal({
      identitySummary: parseBrandIdentitySafe(shopRow?.brandIdentity)?.summary ?? null,
      groupNames: cats.map((c) => c.name),
    });
  }
  const signature = poolSignature({
    pool: cats.map((c) => ({ id: c.id, name: c.name, members: c.productIds })),
    goal,
    struggle,
    ...(questionLength !== undefined ? { questionLength } : {}),
    flow,
  });
  return {
    signature,
    goal,
    struggle,
    ...(questionLength !== undefined ? { questionLength } : {}),
    flow,
    cats,
  };
}

// Fresh-read the draft's session (the no-clobber discipline for detached jobs).
async function readSession(quizId: string): Promise<BuildSession | null> {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { draftJson: true },
  });
  if (!quiz) return null;
  const parsed = Quiz.safeParse(quiz.draftJson);
  if (!parsed.success) return null;
  return parsed.data.build_session ?? BuildSession.parse({});
}

// Is OUR speculation still the live one? A replaced/cleared marker means we
// were superseded — halt without another AI pass (the "cancel" semantics: the
// one in-flight model call finishes, nothing further runs, nothing lands).
async function specAlive(
  quizId: string,
  signature: string,
): Promise<{ committed: boolean } | null> {
  const session = await readSession(quizId);
  const spec = session?.speculative;
  if (!spec || spec.signature !== signature || spec.status !== "running") return null;
  return { committed: spec.committed === true };
}

// Apply held artifacts onto the draft: the captured doc becomes draftJson and
// the funnel lands at question_builder with built:true — the SAME end state
// the normal headless chain's completion writes (startQuestionBuild's restore
// + the templating job's artifact persists), assembled in one write. The
// session is FRESH-read so merchant state written since (bucket_browser tab,
// attach-time grouping/goal/flow markers) survives; `extras` carries the
// Continue intent's flow-specific bookkeeping for the ready-at-Continue path
// (the committed path's attach write already put those on the session).
// Returns false when the held result is unusable — the caller falls back to
// the fresh path (failure honesty: never a merchant-visible error).
export async function applySpeculativeArtifacts(
  quizId: string,
  artifacts: SpecArtifacts,
  extras: Partial<BuildSession>,
): Promise<boolean> {
  const picked = artifacts.picked_template;
  if (!picked) return false;
  const parsedDoc = Quiz.safeParse(artifacts.doc);
  if (!parsedDoc.success) return false;
  const session = await readSession(quizId);
  if (!session) return false;
  const next = BuildSession.parse({
    ...session,
    ...extras,
    stage: "question_builder",
    built: true,
    quiz_types: artifacts.quiz_types ?? [],
    picked_type_id: artifacts.picked_type_id,
    rich_templates: artifacts.rich_templates ?? [],
    picked_template: picked,
    web_research_summary: artifacts.web_research_summary,
    gen_error: undefined,
    gen_progress: undefined,
    speculative: undefined,
  });
  await prisma.quiz.update({
    where: { id: quizId },
    data: {
      // The normal chain names the quiz at build kick; capture mode defers it
      // to apply so a discarded speculation never renames anything visible.
      name: picked.quiz_name,
      draftJson: Quiz.parse({ ...parsedDoc.data, build_session: next }) as never,
    },
  });
  return true;
}

// Continue found a READY marker with a matching signature → use it now.
export async function applySpeculativeReady(
  quizId: string,
  spec: SpeculativeState,
  extras: Partial<BuildSession>,
): Promise<boolean> {
  if (spec.status !== "ready") return false;
  return applySpeculativeArtifacts(quizId, spec, extras);
}

// The detached speculative chain. Mirrors the normal headless pipeline
// (startStep2Types headless → startStep2Templates → startQuestionBuild) pass
// for pass — same generation functions, same auto-picks, same question-length
// pin, same gen_progress checkpoints (harmless while the merchant is on
// buckets; honest if they attach mid-run) — but every session/stage write is
// replaced by marker bookkeeping, and the question build runs in captureDoc
// mode so draftJson is never touched.
export function startSpeculativeBuild(
  shopId: string,
  quizId: string,
  inputs: SpecInputs,
): void {
  const { signature } = inputs;
  const log = logFor("specBuild");
  void withAiSpendRecording(shopId, async () => {
    try {
      // Settle race — the pool may have moved between the intent's derivation
      // and this detached start. Recompute through the same seam; a mismatch
      // means an imminent supersede or a genuinely changed pool: release the
      // marker (if still ours) and stop before any AI spend.
      const quizRow = await prisma.quiz.findUnique({
        where: { id: quizId },
        select: { draftJson: true },
      });
      const parsed = quizRow ? Quiz.safeParse(quizRow.draftJson) : null;
      if (!parsed?.success) return;
      const live = await resolveSpecInputs(
        shopId,
        quizId,
        parsed.data,
        parsed.data.build_session ?? BuildSession.parse({}),
      );
      if (!live || live.signature !== signature) {
        await releaseMarker(quizId, signature);
        return;
      }
      if (!(await specAlive(quizId, signature))) return;

      // Research — the FAST F1 shop-level cache (prefetched at funnel entry)
      // makes this instant in the common case.
      const cachedResearch = await peekFreshShopWebResearch(shopId);
      if (cachedResearch === null) await writeGenProgress(quizId, "research");
      const webResearchText = cachedResearch ?? (await getOrStartShopWebResearch(shopId));

      if (!(await specAlive(quizId, signature))) return;
      await writeGenProgress(quizId, "types");
      const tTypes = Date.now();
      const { types } = await generateStep2Types(shopId, quizId, {
        goal: inputs.goal,
        ...(inputs.struggle ? { struggle: inputs.struggle } : {}),
        buckets: inputs.cats.map((c) => ({ name: c.name, tags: c.tags })),
        webResearchText,
      });
      log.info({ quizId, ms: Date.now() - tTypes }, "speculative types took");
      const top = types[0];
      if (!top) {
        await finishFailed(shopId, quizId, signature);
        return;
      }
      // The flow1 question-length pin (the headless startStep2Types precedent).
      const effectiveType = inputs.questionLength
        ? QuizTypeSchema.parse({
            ...top,
            question_range: { min: inputs.questionLength, max: inputs.questionLength },
          })
        : top;

      if (!(await specAlive(quizId, signature))) return;
      await writeGenProgress(quizId, "templates");
      const tTemplates = Date.now();
      const templates = await generateStep2Templates(shopId, quizId, effectiveType, {
        goal: inputs.goal,
        ...(inputs.struggle ? { struggle: inputs.struggle } : {}),
        buckets: inputs.cats.map((c) => ({ id: c.id, name: c.name, tags: c.tags })),
      });
      log.info({ quizId, ms: Date.now() - tTemplates }, "speculative templates took");
      const topTemplate = templates[0];
      if (!topTemplate) {
        await finishFailed(shopId, quizId, signature);
        return;
      }
      const picked = initPickedTemplate(
        topTemplate,
        inputs.cats.map((c) => ({ id: c.id, name: c.name, product_ids: c.productIds })),
        new Date(),
      );

      if (!(await specAlive(quizId, signature))) return;
      await writeGenProgress(quizId, "questions");
      const tBuild = Date.now();
      const result = await buildQuizFromPicked(
        shopId,
        quizId,
        topTemplate,
        picked,
        inputs.goal,
        inputs.struggle,
        undefined,
        /* captureDoc */ true,
      );
      log.info({ quizId, ms: Date.now() - tBuild }, "speculative question-build took");
      if (result.degraded || !result.doc) {
        await finishFailed(shopId, quizId, signature);
        return;
      }

      await finishReady(quizId, signature, {
        quiz_types: inputs.questionLength ? [effectiveType, ...types.slice(1)] : types,
        picked_type_id: top.id,
        rich_templates: templates,
        picked_template: picked,
        web_research_summary: webResearchText.slice(0, 600),
        doc: result.doc,
      });
    } catch (err) {
      reportError(err, { scope: "specBuild", msg: "speculative build failed", shopId, quizId });
      await finishFailed(shopId, quizId, signature);
    }
  });
}

// Drop OUR running marker (the settle-race early-out) so a later Continue
// can't attach to a chain that never ran. Guarded inside the fresh-read write
// so someone else's marker is never touched.
async function releaseMarker(quizId: string, signature: string): Promise<void> {
  try {
    await patchBuildSession(quizId, (s) =>
      s.speculative?.signature === signature && s.speculative.status === "running"
        ? BuildSession.parse({ ...s, speculative: undefined })
        : s,
    );
  } catch (e) {
    reportError(e, { scope: "specBuild", msg: "failed to release marker", quizId });
  }
}

// Success. Committed (the merchant attached mid-run) → apply now: they're on
// the generating screen and the stage flip is the payoff. Un-committed → hold
// everything in the marker; Continue applies it later. The post-write
// re-check closes the attach race: if Continue set `committed` between our
// read and the ready write, apply immediately — nothing else would.
async function finishReady(
  quizId: string,
  signature: string,
  artifacts: SpecArtifacts,
): Promise<void> {
  try {
    const alive = await specAlive(quizId, signature);
    if (!alive) return; // superseded/cleared — discard silently
    if (alive.committed) {
      await applySpeculativeArtifacts(quizId, artifacts, {});
      return;
    }
    await patchBuildSession(quizId, (s) =>
      s.speculative?.signature === signature && s.speculative.status === "running"
        ? BuildSession.parse({
            ...s,
            gen_progress: undefined,
            speculative: {
              signature,
              status: "ready",
              started_at: s.speculative.started_at,
              ...(s.speculative.committed ? { committed: true } : {}),
              ...artifacts,
            },
          })
        : s,
    );
    const after = await readSession(quizId);
    if (
      after?.speculative?.signature === signature &&
      after.speculative.status === "ready" &&
      after.speculative.committed
    ) {
      await applySpeculativeArtifacts(quizId, artifacts, {});
    }
  } catch (e) {
    reportError(e, { scope: "specBuild", msg: "failed to land ready result", quizId });
  }
}

// Failure. Un-committed → a silent tombstone (never speculate the same
// signature twice; the merchant never sees an error for work they didn't ask
// for). Committed → the merchant is waiting on the generating screen: land
// the same blank-Questions notice the normal headless chain's failures use.
async function finishFailed(
  shopId: string,
  quizId: string,
  signature: string,
): Promise<void> {
  try {
    const alive = await specAlive(quizId, signature);
    if (!alive) return; // superseded/cleared — discard silently
    if (alive.committed) {
      await patchBuildSession(quizId, (s) =>
        s.speculative?.signature === signature
          ? BuildSession.parse({ ...s, speculative: undefined })
          : s,
      );
      await failToBlankQuestions(shopId, quizId);
      return;
    }
    await patchBuildSession(quizId, (s) =>
      s.speculative?.signature === signature && s.speculative.status === "running"
        ? BuildSession.parse({
            ...s,
            gen_progress: undefined,
            speculative: {
              signature,
              status: "failed",
              started_at: s.speculative.started_at,
            },
          })
        : s,
    );
  } catch (e) {
    reportError(e, { scope: "specBuild", msg: "failed to land failure state", quizId });
  }
}
