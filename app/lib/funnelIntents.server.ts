// BIC-2 C3b — the funnel's action: every stage-transition / autosave / design
// intent. Split out of step1Funnel.server.ts as a pure move; the intent
// bodies are byte-identical to the original. `builderPath` is surface-
// specific (studio vs embedded) so the pick hand-off lands in the right
// builder.
import {
  json,
  redirect,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import prisma from "../db.server";
import { logFor } from "./log.server";
import { withAiSpendRecording } from "./aiBudget.server";
import { Quiz, DesignDials, RecDefaults, DesignTokens, QuizType } from "./quizSchema";
import type { BuildSession } from "./quizSchema";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { suggestQuizGoal } from "./goalSuggest";
import { detectGroupingDimension } from "./groupingDetect";
import { recordIdentitySignals } from "./brandIdentityBuild.server";
import {
  persistConfirmedGroups,
  loadConfirmedBuckets,
  resyncCatalogForShop,
  startStep1Build,
  bucketRowFor,
  bucketRowsFor,
  addBuckets,
  removeBuckets,
  clearBuckets,
  type BucketType,
} from "./step1Build.server";
import {
  startStep2Types,
  startStep2Templates,
  startQuestionBuild,
  initPickedTemplate,
  startStep2Build,
} from "./step2Build.server";
import { saveTemplate, loadSavedTemplate } from "./savedTemplates.server";
import { applyManualDeciderSkeleton } from "./smartBuild";
import {
  MAX_LOGO_BYTES,
  isAllowedLogoType,
  isSafeLogoUrl,
  LOGO_SIZES,
  LOGO_ALIGNS,
} from "./logoUpload";
import { DEFAULT_TOKENS } from "./designTokens";
import { applyBrandToDesign } from "./brandSync";
import { regenerateQuestion } from "./claude";
import { parseBrandGuidelinesSafe } from "./brandGuidelines";
import { buildScopedIndex } from "./catalogIndex";
import { mergeRegeneratedAnswers } from "./regenerateMerge";
import { toGroupingProduct, loadBucketInputs } from "./bucketPersist.server";
import {
  MIN_GOAL_CHARS,
  loadFunnelDraft,
  writeDoc,
  type FunnelShop,
} from "./funnelDraft.server";

// The funnel's action — every stage transition. `builderPath` is surface-specific
// (studio → /studio/:id?mode=ai, embedded → /app/quizzes/:id/studio?mode=ai) so
// the pick hand-off lands in the right builder.
export async function runStep1FunnelAction(
  shop: FunnelShop,
  quizId: string | undefined,
  request: Request,
  opts: { builderPath: (quizId: string) => string },
): Promise<Response> {
  // Surface a DB-write / unexpected failure as a PARSEABLE JSON error instead of an
  // unhandled throw (which Remix routes to the ErrorBoundary, leaving the client's
  // useQuizDraft saveError blind → a silent "looks saved but didn't" divergence).
  // Re-throw Responses so returned/thrown redirects survive. Only the FAILURE path
  // changes — the happy path returns through runStep1FunnelActionImpl unchanged.
  try {
    return await runStep1FunnelActionImpl(shop, quizId, request, opts);
  } catch (err) {
    if (err instanceof Response) throw err;
    logFor("step1Funnel").error({ err, quizId }, "action failed");
    return json(
      { ok: false, error: "Couldn't save your change — please try again." },
      { status: 500 },
    );
  }
}

async function runStep1FunnelActionImpl(
  shop: FunnelShop,
  quizId: string | undefined,
  request: Request,
  opts: { builderPath: (quizId: string) => string },
): Promise<Response> {
  const { quiz, doc, session } = await loadFunnelDraft(shop.id, quizId);

  // JSON PUT autosave — the question_builder editing step. useQuizDraft PUTs the
  // live doc here exactly as it does against the main editor route; mirror that
  // seam (quizEditorIO.server.ts): Quiz-gate, write draftJson, leave the stage
  // untouched. The doc still carries build_session (it round-trips through the
  // client unmodified), so the stage is preserved by the write. MUST run BEFORE
  // request.formData() — a JSON body has no form fields to read.
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { doc: unknown };
    const parsed = Quiz.safeParse(body.doc);
    if (!parsed.success) {
      return json(
        { ok: false, error: "Invalid quiz document", issues: parsed.error.issues.slice(0, 5) },
        { status: 400 },
      );
    }
    // Autosave persists DOC CONTENT only. build_session / stage is owned by the
    // navigation intents — so we keep the SERVER's current session, never the
    // client doc's. This makes a debounced PUT that races a stage transition
    // safe in EITHER order: the PUT can never rewind the stage, and the merchant's
    // last edit is preserved whichever request lands last.
    await prisma.quiz.update({
      where: { id: quiz.id },
      data: { draftJson: Quiz.parse({ ...parsed.data, build_session: session }) as never },
    });
    return json({ ok: true, savedAt: new Date().toISOString() });
  }

  // Logo upload is the only multipart body. Parse it with a memory handler
  // capped per-part at MAX_LOGO_BYTES — this STREAMS and aborts past the cap
  // regardless of the content-length header (a chunked/absent header can't
  // bypass it), so memory is bounded before the precise size check below.
  let form: FormData;
  if (contentType.includes("multipart/form-data")) {
    try {
      form = await unstable_parseMultipartFormData(
        request,
        unstable_createMemoryUploadHandler({ maxPartSize: MAX_LOGO_BYTES }),
      );
    } catch {
      return json({ ok: false, error: "Logo too large (max 2 MB)." }, { status: 413 });
    }
  } else {
    form = await request.formData();
  }
  const intent = String(form.get("intent") ?? "");

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

  // ── Recommendation Buckets (RB Step 1) — continuous-save bucket browser ───
  // Membership is always re-resolved server-side; the client only sends WHICH
  // key(s) were toggled (the persistConfirmedGroups trust boundary).
  if (intent === "toggle-bucket" || intent === "select-all" || intent === "clear-visible") {
    const rawType = String(form.get("type") ?? "");
    if (rawType !== "product" && rawType !== "tag" && rawType !== "collection") {
      return json({ intent, ok: false, error: "Unknown bucket type." }, { status: 400 });
    }
    const type: BucketType = rawType;

    if (intent === "toggle-bucket") {
      const key = String(form.get("key") ?? "").trim();
      const on = String(form.get("on") ?? "") === "true";
      if (!key) return json({ intent, ok: false, error: "Missing bucket key." }, { status: 400 });
      if (!on) {
        await removeBuckets(shop.id, quiz.id, type, [key]);
        return json({ intent, ok: true });
      }
      const inputs = await loadBucketInputs(shop.id);
      const row = bucketRowFor(
        type,
        key,
        inputs.products,
        inputs.collections,
        inputs.productTitleById,
        inputs.collectionTitleById,
      );
      if (!row) {
        return json({ intent, ok: false, error: "That item is no longer available." }, { status: 400 });
      }
      await addBuckets(shop.id, quiz.id, [row]);
      return json({ intent, ok: true });
    }

    // select-all / clear-visible — the client sends the visible (filtered) keys.
    const keys = String(form.get("keys") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (intent === "clear-visible") {
      await removeBuckets(shop.id, quiz.id, type, keys);
      return json({ intent, ok: true });
    }
    const inputs = await loadBucketInputs(shop.id);
    const rows = bucketRowsFor(
      keys.map((key) => ({ type, key })),
      inputs.products,
      inputs.collections,
      inputs.productTitleById,
      inputs.collectionTitleById,
    );
    await addBuckets(shop.id, quiz.id, rows);
    return json({ intent, ok: true });
  }

  // Bulk replace the whole (homogeneous) selection — the §4 AI banner's
  // "Use this" and its Undo both swap the full set. Empty keys = clear-all
  // (the Undo of an apply over an empty selection). Same trust boundary as
  // select-all: the client sends WHICH keys, membership is always re-resolved
  // server-side. DIFF-based (review-caught): a clear-then-add would rotate
  // EVERY Category id, orphaning the draft's answer/rule target_ids even for
  // keys present in BOTH sets — so rows whose (source, sourceRef) stays in
  // the requested set are KEPT (their ids survive), only leavers delete and
  // only newcomers create. No clear-all window mid-write either.
  if (intent === "set-buckets") {
    const rawType = String(form.get("type") ?? "");
    if (rawType !== "product" && rawType !== "tag" && rawType !== "collection") {
      return json({ intent, ok: false, error: "Unknown recommendation type." }, { status: 400 });
    }
    const keys = String(form.get("keys") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const wanted = new Set(keys.map((k) => `${rawType}:${k}`));
    const normSource = (s: string) => (s === "smart_collection" ? "collection" : s);
    const existing = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, source: true, sourceRef: true },
    });
    const staysFor = (c: { source: string; sourceRef: string | null }) =>
      Boolean(c.sourceRef) && wanted.has(`${normSource(c.source)}:${c.sourceRef}`);
    const leaverIds = existing.filter((c) => !staysFor(c)).map((c) => c.id);
    if (leaverIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: leaverIds } } });
    }
    const keptKeys = new Set(
      existing.filter(staysFor).map((c) => `${normSource(c.source)}:${c.sourceRef}`),
    );
    const missing = keys.filter((k) => !keptKeys.has(`${rawType}:${k}`));
    if (missing.length > 0) {
      const inputs = await loadBucketInputs(shop.id);
      const rows = bucketRowsFor(
        missing.map((key) => ({ type: rawType as BucketType, key })),
        inputs.products,
        inputs.collections,
        inputs.productTitleById,
        inputs.collectionTitleById,
      );
      await addBuckets(shop.id, quiz.id, rows);
    }
    // Land the picker on the applied type so the merchant sees their new set.
    const next: BuildSession = {
      ...session,
      bucket_browser: {
        banner_dismissed: session.bucket_browser?.banner_dismissed ?? false,
        active_tab: rawType,
      },
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  if (intent === "switch-tab") {
    const rawType = String(form.get("type") ?? "");
    if (rawType !== "product" && rawType !== "tag" && rawType !== "collection") {
      return json({ intent, ok: false, error: "Unknown bucket type." }, { status: 400 });
    }
    // A type change with existing buckets clears them (the client only sends
    // clear=true after the TabLockModal confirm).
    if (String(form.get("clear") ?? "") === "true") await clearBuckets(shop.id, quiz.id);
    // A non-suggested tab click also dismisses the AI banner — folded in here so
    // one submit does both (a single fetcher can't fire two intents).
    const dismiss = String(form.get("dismiss") ?? "") === "true";
    const browser = session.bucket_browser;
    const next: BuildSession = {
      ...session,
      bucket_browser: {
        ...(browser ?? {}),
        active_tab: rawType,
        banner_dismissed: dismiss || (browser?.banner_dismissed ?? false),
      },
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  // Kept for legacy in-flight sessions only — since the Step-1 spec (§4),
  // "Not now" dismisses client-side for the session (sessionStorage) and the
  // client no longer calls this; a previously PERSISTED dismissal is still
  // honored by the loader.
  if (intent === "dismiss-banner") {
    const browser = session.bucket_browser;
    const next: BuildSession = {
      ...session,
      bucket_browser: { ...(browser ?? {}), banner_dismissed: true },
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  // Continue → advance to the goal stage (relabeled "Step 2" in the UI). The
  // bucket rows ARE the confirmed grouping; dimension reflects the active tab.
  if (intent === "continue-buckets") {
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    if (cats.length === 0) {
      return json(
        { intent, ok: false, error: "Add at least one recommendation to continue." },
        { status: 400 },
      );
    }
    const tab = session.bucket_browser?.active_tab;
    const dimension = tab === "tag" ? "tag" : tab === "collection" ? "collection" : "all";

    // Re-sequenced flow (owner): Buckets → Shape DIRECTLY (no standalone Goal step).
    // Derive the goal automatically from the brand identity + confirmed buckets —
    // the same deterministic suggestion the old Goal stage pre-filled — and kick the
    // tier-1 type generation now, so Shape loads with the 2 AI template options. The
    // merchant can still override via Shape's "write your goal" card (shape-goal-build).
    const shopRow = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { brandIdentity: true },
    });
    const suggestedGoal = suggestQuizGoal({
      identitySummary: parseBrandIdentitySafe(shopRow?.brandIdentity)?.summary ?? null,
      groupNames: cats.map((c) => c.name),
    });
    const next: BuildSession = {
      ...session,
      stage: "typing",
      grouping: {
        dimension,
        confirmed_category_ids: cats.map((c) => c.id),
        detected_rationale: "Selected in the recommendation buckets browser.",
      },
      goal: { goal_text: suggestedGoal, struggle_text: "" },
      gen_error: undefined,
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    const buckets = await loadConfirmedBuckets(shop.id, quiz.id);
    startStep2Types(shop.id, quiz.id, {
      goal: suggestedGoal,
      ...(buckets.length ? { buckets } : {}),
    });
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

    // Step 2 — enter the transient "typing" stage and kick the DETACHED tier-1
    // job (web research + quiz types; ~70s, outruns the edge window). The funnel
    // polls until the job writes stage:"types".
    const buckets = await loadConfirmedBuckets(shop.id, quiz.id);
    const next: BuildSession = {
      ...session,
      stage: "typing",
      goal: { goal_text: goal, struggle_text: struggle },
      gen_error: undefined, // clear any prior failure — this is a fresh attempt
    };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    startStep2Types(shop.id, quiz.id, {
      goal,
      ...(struggle ? { struggle } : {}),
      ...(buckets.length ? { buckets } : {}),
    });
    return json({ intent, ok: true });
  }

  if (intent === "pick") {
    // LOGIC v2 (L2-10d) — this legacy Step-1 path builds via startStep1Build,
    // whose re-seed does NOT thread logic_model: letting a decider draft
    // through would silently strip the stamp. Unreachable today
    // (template_options is never populated since the generator was retired) —
    // this guard closes the trapdoor.
    if (doc.logic_model === "decider") {
      return json({ intent, ok: false, error: "This flow isn't available for this quiz." }, { status: 400 });
    }
    const optionId = String(form.get("optionId") ?? "");
    const chosen = session.template_options.find((o) => o.id === optionId);
    if (!chosen) {
      return json({ intent, ok: false, error: "That direction is no longer available." }, { status: 400 });
    }
    if (!session.goal?.goal_text) {
      return json({ intent, ok: false, error: "Add a goal before building." }, { status: 400 });
    }
    // Kick the detached full build (renames the draft, flips buildState →
    // "building", consumes the confirmed buckets + the picked direction) and hand
    // off to the editor, whose polling overlay swaps in the built quiz.
    await startStep1Build(shop.id, quiz.id, chosen, session);
    return redirect(opts.builderPath(quiz.id));
  }

  // ── Step 2 intents ──────────────────────────────────────────────────────
  if (intent === "pick-type") {
    const typeId = String(form.get("typeId") ?? "");
    const chosen = session.quiz_types.find((t) => t.id === typeId);
    if (!chosen) return json({ intent, ok: false, error: "That type is no longer available." }, { status: 400 });
    const goal = session.goal?.goal_text ?? "";
    const struggle = session.goal?.struggle_text ?? "";
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, tags: true },
    });
    const next: BuildSession = { ...session, stage: "templating", picked_type_id: typeId, gen_error: undefined };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    startStep2Templates(shop.id, quiz.id, chosen, {
      goal,
      ...(struggle ? { struggle } : {}),
      ...(cats.length ? { buckets: cats } : {}),
    });
    return json({ intent, ok: true });
  }

  // Shape-Your-Quiz spec — the four-card page's AI-card "Continue": capture the
  // required scoring model + the card's experience type onto the doc, then run
  // the SAME type→templates build as pick-type. Scoring is required (the spec
  // pre-selects nothing).
  if (intent === "shape-continue") {
    const typeId = String(form.get("typeId") ?? "");
    // Shape redesign (handoff §0) — scoring is no longer merchant-facing, so an
    // absent value DEFAULTS to "direct" instead of blocking (the old four-card
    // picker that supplied it is retired). An explicit invalid value still 400s.
    const scoringRaw = String(form.get("scoring") ?? "").trim();
    const scoring = scoringRaw === "" ? "direct" : scoringRaw;
    if (scoring !== "direct" && scoring !== "weighted") {
      return json({ intent, ok: false, error: "Pick how to score this quiz first." }, { status: 400 });
    }
    // LOGIC v2 (L2-10d) — decider drafts are direct-only (the weighted picker
    // is retired for them; the UI no longer offers it — this is defense).
    if (doc.logic_model === "decider" && scoring !== "direct") {
      return json(
        { intent, ok: false, error: "This quiz uses direct mapping — each answer points at one result." },
        { status: 400 },
      );
    }
    const chosen = session.quiz_types.find((t) => t.id === typeId);
    if (!chosen) return json({ intent, ok: false, error: "That type is no longer available." }, { status: 400 });
    const goal = session.goal?.goal_text ?? "";
    const struggle = session.goal?.struggle_text ?? "";
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, tags: true },
    });
    const next: BuildSession = { ...session, stage: "templating", picked_type_id: typeId, gen_error: undefined };
    await writeDoc(quiz.id, {
      ...doc,
      scoring_model: scoring,
      experience_type: chosen.experience_type,
      build_session: next,
    });
    startStep2Templates(shop.id, quiz.id, chosen, {
      goal,
      ...(struggle ? { struggle } : {}),
      ...(cats.length ? { buckets: cats } : {}),
    });
    return json({ intent, ok: true });
  }

  // Shape spec — the "write your goal" card's "Continue": BUILD the quiz straight
  // from the merchant's typed goal (no chosen template). Synthesize a minimal
  // QuizType from the goal and run the SAME templates→build chain as the AI cards,
  // so the AI generates the questions/mapping FROM the goal. Scoring defaults to
  // "weighted" (the merchant can switch it later in the Question Builder).
  if (intent === "shape-goal-build") {
    const goal = String(form.get("goal") ?? "").trim().slice(0, 500);
    if (goal.length < MIN_GOAL_CHARS) {
      return json(
        { intent, ok: false, error: `Add a little more detail (at least ${MIN_GOAL_CHARS} characters).` },
        { status: 400 },
      );
    }
    // LOGIC v2 (L2-10d) — decider drafts are always direct; legacy keeps the
    // weighted default (the merchant can switch later in the Question Builder).
    const scoring =
      doc.logic_model === "decider"
        ? ("direct" as const)
        : String(form.get("scoring") ?? "") === "direct"
          ? ("direct" as const)
          : ("weighted" as const);
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, tags: true },
    });
    // Start-routing spec §1 — the intercept modal fires this straight from the
    // Recommendations step (Shape is SKIPPED on the write-a-goal route), so a
    // decider goal build needs selections to map onto.
    if (doc.logic_model === "decider" && cats.length === 0) {
      return json(
        { intent, ok: false, error: "Add at least one recommendation to continue." },
        { status: 400 },
      );
    }
    const syntheticType = QuizType.parse({
      id: "custom-goal",
      experience_type: "product_match",
      name: "Your goal",
      achieves: goal.slice(0, 160),
      question_range: { min: 4, max: 7 },
    });
    const struggle = session.goal?.struggle_text ?? "";
    const tabDim = session.bucket_browser?.active_tab;
    const next: BuildSession = {
      ...session,
      stage: "templating",
      goal: { goal_text: goal, struggle_text: struggle },
      gen_error: undefined,
      // When fired from the modal at the Recommendations step, the grouping
      // bookkeeping continue-buckets would have written hasn't happened yet.
      grouping: session.grouping ?? {
        dimension: tabDim === "tag" ? "tag" : tabDim === "collection" ? "collection" : "all",
        confirmed_category_ids: cats.map((c) => c.id),
        detected_rationale: "",
      },
      // O-3 (decider only, review-caught) — a goal build is a FRESH direction:
      // clear any leftover template artifacts (a stale picked_type_id would make
      // retry-gen regenerate the OLD type's templates; stale rich/picked would
      // make the saved-template retry fallback rebuild the OLD template if this
      // job is killed before its own templates persist). Legacy untouched.
      // SR §3 — the goal route SKIPS Shape, so quiz_types must be cleared too:
      // Back-from-Questions keys on quiz_types.length===0 to route to
      // Recommendations; a stale non-empty list (merchant ran AI templates, backed
      // out, then wrote a goal) would wrongly send Back to Shape.
      ...(doc.logic_model === "decider"
        ? { quiz_types: [], picked_type_id: undefined, rich_templates: [], picked_template: undefined }
        : {}),
    };
    await writeDoc(quiz.id, {
      ...doc,
      scoring_model: scoring,
      experience_type: "product_match",
      build_session: next,
    });
    startStep2Templates(
      shop.id,
      quiz.id,
      syntheticType,
      {
        goal,
        ...(struggle ? { struggle } : {}),
        ...(cats.length ? { buckets: cats } : {}),
      },
      // §1.3 — a failed goal generation lands on BLANK Questions with a notice
      // (decider; the merchant chose a goal, not Shape). Legacy keeps the
      // Shape-error treatment (its write-goal card lives ON Shape).
      doc.logic_model === "decider" ? { failMode: "blank_questions" } : undefined,
    );
    return json({ intent, ok: true });
  }

  // Start-routing spec §1.2 — "Build from a blank quiz" (the intercept modal's
  // quiet tertiary + Shape's escape link). No AI: seed the minimal-but-complete
  // decider skeleton and land straight on the Questions step. Reinstates the
  // manual path the L2-10d flip closed (this newer owner spec supersedes it) —
  // now decider-NATIVE instead of exiting into a builder with no decider UI.
  if (intent === "manual-build") {
    if (doc.logic_model !== "decider") {
      // Shape redesign — the unified Shape page now serves legacy drafts too,
      // and its "Build manually" escape fires THIS intent for both models (the
      // old four-card UI that fired shape-manual is retired). Legacy manual
      // create keeps its original semantics: straight to the builder with the
      // seed doc, scoring unset so the builder prompts (see shape-manual).
      await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "done" } });
      await prisma.quiz.update({ where: { id: quiz.id }, data: { buildState: null } });
      return redirect(opts.builderPath(quiz.id));
    }
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (cats.length === 0) {
      return json(
        { intent, ok: false, error: "Add at least one recommendation to continue." },
        { status: 400 },
      );
    }
    const firstCollection = await prisma.collection.findFirst({
      where: { shopId: shop.id },
      select: { collectionId: true },
    });
    const skeleton = applyManualDeciderSkeleton(doc, firstCollection?.collectionId ?? "manual");
    const tabDim = session.bucket_browser?.active_tab;
    const next: BuildSession = {
      ...session,
      stage: "question_builder",
      built: true, // no AI build to wait for — the skeleton IS the build
      gen_error: undefined,
      grouping: session.grouping ?? {
        dimension: tabDim === "tag" ? "tag" : tabDim === "collection" ? "collection" : "all",
        confirmed_category_ids: cats.map((c) => c.id),
        detected_rationale: "",
      },
      // SR §3 — the blank route SKIPS Shape. Clear quiz_types (alongside the other
      // template artifacts) so Back-from-Questions routes to Recommendations, not
      // Shape, even when the merchant ran AI templates then backed out to pick
      // "Build manually" (back-to-grouping preserves the stale list).
      quiz_types: [],
      picked_type_id: undefined,
      rich_templates: [],
      picked_template: undefined,
    };
    await writeDoc(quiz.id, { ...skeleton, scoring_model: "direct", build_session: next });
    return json({ intent, ok: true });
  }

  // Shape spec — "↻ Regenerate suggestions": re-run the tier-1 type generation
  // for a fresh pair of directions (mirrors save-goal's typing kick).
  if (intent === "shape-regenerate") {
    const buckets = await loadConfirmedBuckets(shop.id, quiz.id);
    const next: BuildSession = { ...session, stage: "typing", quiz_types: [], gen_error: undefined };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    startStep2Types(shop.id, quiz.id, {
      goal: session.goal?.goal_text ?? "",
      ...(session.goal?.struggle_text ? { struggle: session.goal.struggle_text } : {}),
      ...(buckets.length ? { buckets } : {}),
    });
    return json({ intent, ok: true });
  }

  // Shape spec — Card 4 "Manual Create": skip AI generation and go straight to
  // the Question Builder with the seed quiz. Scoring stays UNSET so the builder
  // prompts for it (per the question-builder spec's manual-create flow).
  if (intent === "shape-manual") {
    // LOGIC v2 (L2-10d, owner diagram 2026-07-02) — Manual Creation is removed
    // from the decider flow (a separate process later); the UI hides the card,
    // this 400 is defense. Legacy in-flight drafts keep the escape hatch.
    if (doc.logic_model === "decider") {
      return json(
        { intent, ok: false, error: "Manual creation isn't part of this flow yet." },
        { status: 400 },
      );
    }
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "done" } });
    // Manual Create leaves the funnel for the builder — graduate it out of "step1"
    // so it shows in the gallery and "Create new quiz" starts fresh (see above).
    await prisma.quiz.update({ where: { id: quiz.id }, data: { buildState: null } });
    return redirect(opts.builderPath(quiz.id));
  }

  if (intent === "retry-gen") {
    // Re-kick a stalled generation: the prior detached job died (e.g. a server
    // restart mid-run) leaving the stage stuck with no error to catch. Rebuild
    // the inputs from the persisted build_session and re-run the SAME detached
    // job; writeDoc resets updatedAt so the stall clears. If the AI genuinely
    // fails this time, the job's own catch sets gen_error (the honest "didn't
    // finish" banner + template escape).
    if (session.stage === "typing") {
      const retryBuckets = await loadConfirmedBuckets(shop.id, quiz.id);
      await writeDoc(quiz.id, { ...doc, build_session: { ...session, gen_error: undefined } });
      startStep2Types(shop.id, quiz.id, {
        goal: session.goal?.goal_text ?? "",
        ...(session.goal?.struggle_text ? { struggle: session.goal.struggle_text } : {}),
        ...(retryBuckets.length ? { buckets: retryBuckets } : {}),
      });
      return json({ intent, ok: true });
    }
    if (session.stage === "templating") {
      const retryType = session.quiz_types.find((t) => t.id === session.picked_type_id);
      if (retryType) {
        const retryCats = await prisma.category.findMany({
          where: { shopId: shop.id, quizId: quiz.id },
          select: { id: true, name: true, tags: true },
        });
        await writeDoc(quiz.id, { ...doc, build_session: { ...session, gen_error: undefined } });
        startStep2Templates(shop.id, quiz.id, retryType, {
          goal: session.goal?.goal_text ?? "",
          ...(session.goal?.struggle_text ? { struggle: session.goal.struggle_text } : {}),
          ...(retryCats.length ? { buckets: retryCats } : {}),
        });
        return json({ intent, ok: true });
      }
      // O-3 (DECIDER only — provably legacy-inert) — the saved-template kick
      // parks templating with NO picked_type_id (deliberately cleared) but the
      // session carries the template + working copy: a stalled/killed build
      // re-runs the question build directly. Also fires for a decider
      // shape-goal-build killed AFTER its templates persisted (the completion
      // seeds rich+picked at stage templating) — retrying the auto-picked
      // template is correct there too; a kill BEFORE they persist finds
      // nothing (shape-goal-build clears stale artifacts at kick) and falls
      // to the honest 400 below, same as pre-O-3.
      if (doc.logic_model === "decider") {
        const retryRich = session.rich_templates.find(
          (t) => t.id === session.picked_template?.template_id,
        );
        if (retryRich && session.picked_template) {
          await writeDoc(quiz.id, { ...doc, build_session: { ...session, gen_error: undefined } });
          await startQuestionBuild(
            shop.id,
            quiz.id,
            retryRich,
            session.picked_template,
            session.goal?.goal_text || retryRich.angle,
            session.goal?.struggle_text ?? "",
          );
          return json({ intent, ok: true });
        }
      }
    }
    return json({ intent, ok: false, error: "Nothing to retry — start over from the quiz list." }, { status: 400 });
  }

  if (intent === "pick-template") {
    const templateId = String(form.get("templateId") ?? "");
    const rich = session.rich_templates.find((t) => t.id === templateId);
    if (!rich) return json({ intent, ok: false, error: "That template is no longer available." }, { status: 400 });
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, productIds: true },
      orderBy: { createdAt: "asc" },
    });
    const picked = initPickedTemplate(
      rich,
      cats.map((c) => ({ id: c.id, name: c.name, product_ids: c.productIds })),
      new Date(),
    );
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, picked_template: picked } });
    return json({ intent, ok: true });
  }

  // Reuse a saved template — skip the AI tiers entirely. Loads the stored
  // RichTemplateOption; LEGACY drafts seed it as the sole tier-2 option + an
  // auto-named working copy and jump to the battle card (stage "configuring").
  // DECIDER drafts (O-3, owner-approved 2026-07-03) never enter the retired
  // battle card: the template seeds the working copy and kicks the SAME early
  // question build the Shape cards use → lands at Questions & Logic.
  if (intent === "use-saved-template") {
    const templateId = String(form.get("templateId") ?? "");
    const rich = await loadSavedTemplate(shop.id, templateId);
    if (!rich) return json({ intent, ok: false, error: "That saved template is no longer available." }, { status: 400 });
    const cats = await prisma.category.findMany({
      where: { shopId: shop.id, quizId: quiz.id },
      select: { id: true, name: true, productIds: true },
      orderBy: { createdAt: "asc" },
    });
    if (doc.logic_model === "decider") {
      // recommended_bucket_ids are the SOURCE quiz's Category cuids — on this
      // draft they match nothing, so initPickedTemplate would disable EVERY
      // group (empty preResolvedBuckets → bucket discovery instead of the
      // merchant's confirmed buckets). Neutralize them: the confirmed buckets
      // ARE the merchant's choice here.
      const richForDraft = { ...rich, recommended_bucket_ids: [] };
      const picked = initPickedTemplate(
        richForDraft,
        cats.map((c) => ({ id: c.id, name: c.name, product_ids: c.productIds })),
        new Date(),
      );
      // continue-buckets always seeds goal_text before Shape; angle is defense.
      const goal = session.goal?.goal_text || richForDraft.angle;
      const struggle = session.goal?.struggle_text ?? "";
      // writeDoc BEFORE startQuestionBuild — it snapshots priorSession up front
      // and restores it on completion; reversing wipes picked_template post-build
      // (the same ordering startStep2Templates uses). picked_type_id is CLEARED
      // so a later retry-gen retries THIS template instead of re-generating
      // tier-2 options from a leftover Shape pick.
      await writeDoc(quiz.id, {
        ...doc,
        scoring_model: "direct",
        experience_type: richForDraft.experience_type,
        build_session: {
          ...session,
          stage: "templating",
          picked_type_id: undefined,
          rich_templates: [richForDraft],
          picked_template: picked,
          gen_error: undefined,
        },
      });
      await startQuestionBuild(shop.id, quiz.id, richForDraft, picked, goal, struggle);
      return json({ intent, ok: true });
    }
    const picked = initPickedTemplate(
      rich,
      cats.map((c) => ({ id: c.id, name: c.name, product_ids: c.productIds })),
      new Date(),
    );
    await writeDoc(quiz.id, {
      ...doc,
      build_session: { ...session, stage: "configuring", rich_templates: [rich], picked_template: picked },
    });
    return json({ intent, ok: true });
  }

  // Autosave setters — all require a picked template.
  if (
    intent === "set-dials" ||
    intent === "set-rec" ||
    intent === "set-name" ||
    intent === "toggle-group" ||
    intent === "toggle-product"
  ) {
    const picked = session.picked_template;
    if (!picked) return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    let nextPicked = picked;

    if (intent === "set-dials") {
      const parsed = DesignDials.safeParse(safeJson(form.get("dials")));
      if (!parsed.success) return json({ intent, ok: false, error: "bad dials" }, { status: 400 });
      nextPicked = { ...picked, design_dials: parsed.data };
    } else if (intent === "set-rec") {
      const parsed = RecDefaults.safeParse(safeJson(form.get("rec")));
      if (!parsed.success) return json({ intent, ok: false, error: "bad rec" }, { status: 400 });
      nextPicked = { ...picked, rec_defaults: parsed.data };
    } else if (intent === "set-name") {
      const name = String(form.get("name") ?? "").trim().slice(0, 120);
      if (!name) return json({ intent, ok: false, error: "Name can't be empty." }, { status: 400 });
      nextPicked = { ...picked, quiz_name: name };
    } else if (intent === "toggle-group") {
      const groupId = String(form.get("groupId") ?? "");
      const enabled = String(form.get("enabled") ?? "") === "true";
      nextPicked = {
        ...picked,
        recommended_groups: picked.recommended_groups.map((g) =>
          g.group_id === groupId ? { ...g, enabled } : g,
        ),
      };
    } else {
      // toggle-product
      const groupId = String(form.get("groupId") ?? "");
      const productId = String(form.get("productId") ?? "");
      const enabled = String(form.get("enabled") ?? "") === "true";
      nextPicked = {
        ...picked,
        recommended_groups: picked.recommended_groups.map((g) => {
          if (g.group_id !== groupId) return g;
          const set = new Set(g.product_ids);
          if (enabled) set.add(productId);
          else set.delete(productId);
          return { ...g, product_ids: Array.from(set) };
        }),
      };
    }

    await writeDoc(quiz.id, { ...doc, build_session: { ...session, picked_template: nextPicked } });
    return json({ intent, ok: true });
  }

  // Rec Page on a BUILT draft — patch products-per-result + OOS behavior onto
  // EVERY result node (the build baked these uniformly; this is the merchant's
  // edit on the real nodes, not picked_template.rec_defaults which would no-op
  // post-build). Validated against RecDefaults; only max_products + oos_behavior
  // are applied (fallback stays untouched — the no-fit-→-no-products goal).
  if (intent === "set-result-rec") {
    const parsed = RecDefaults.safeParse(safeJson(form.get("rec")));
    if (!parsed.success) return json({ intent, ok: false, error: "bad rec" }, { status: 400 });
    const { max_products, oos_behavior } = parsed.data;
    const nodes = doc.nodes.map((n) =>
      n.type === "result"
        ? { ...n, data: { ...n.data, max_products, oos_behavior } }
        : n,
    );
    await writeDoc(quiz.id, { ...doc, nodes });
    return json({ intent, ok: true });
  }

  if (intent === "save-template") {
    const picked = session.picked_template;
    if (!picked) return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    const rich = session.rich_templates.find((t) => t.id === picked.template_id);
    if (!rich) return json({ intent, ok: false, error: "Template not found." }, { status: 400 });
    // Persist the merchant's edited template for reuse.
    await saveTemplate(shop.id, picked.quiz_name, {
      ...rich,
      dials: picked.design_dials,
      rec_defaults: picked.rec_defaults,
      question_count: picked.question_count,
    });
    await writeDoc(quiz.id, {
      ...doc,
      build_session: { ...session, picked_template: { ...picked, saved_as_template: true } },
    });
    return json({ intent, ok: true });
  }

  // Advance to the Design step (theme picker). Reached from Rec Page "Continue →"
  // (the re-architected order: Question Builder → Rec Page → Design) and Overview
  // "← Back".
  if (intent === "to-design") {
    // Same relaxation as to-rec-page (manual/failed-goal decider drafts).
    if (!session.picked_template && !(doc.logic_model === "decider" && session.built)) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "design" } });
    return json({ intent, ok: true });
  }

  // Rec Page "← Back": return to the Question Builder editing step. The draft is
  // already built (question nodes present), so this is a pure stage change.
  if (intent === "to-question-builder") {
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "question_builder" } });
    return json({ intent, ok: true });
  }

  // Design "Continue →": advance to the Recommendation Page step (rec settings).
  if (intent === "to-rec-page") {
    // Start-routing spec: manual/blank + failed-goal DECIDER drafts carry no
    // picked_template — a built doc (result node present) is the credential.
    if (!session.picked_template && !(doc.logic_model === "decider" && session.built)) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "rec_page" } });
    return json({ intent, ok: true });
  }

  // Questions & Logic spec §3.1/§7 — per-question AI regenerate. Replaces a
  // question's text + answers with a fresh generation, but PRESERVES the bucket
  // mapping (answer.points / points_alt) for answers whose text the AI kept
  // unchanged, and marks the question ai_generated. Ported from the editor's
  // regenerate-node (quizEditorIO.server.ts) with two funnel-specific changes:
  //  (1) persist via writeDoc({...doc, build_session: session}) — NOT
  //      prisma.quiz.update — so a regenerate can't rewind the funnel stage
  //      (the editor has no stage to keep; the funnel does);
  //  (2) carry points/points_alt onto unchanged-text answers (the editor merge
  //      drops them — and in the inline-mapping model the bucket mapping IS
  //      answer.points). Credit depletion is surfaced distinctly so the client
  //      shows an actionable Retry, not a silent no-op ([[standalone-ai-credits]]).
  if (intent === "regenerate-node") {
    const nodeId = String(form.get("nodeId") ?? "");
    const target = doc.nodes.find((n) => n.id === nodeId && n.type === "question");
    if (!target || target.type !== "question") {
      return json({ intent, nodeId, ok: false, error: "Question not found" }, { status: 404 });
    }

    const [allProducts, allCollections, shopRow] = await Promise.all([
      prisma.product.findMany({ where: { shopId: shop.id } }),
      prisma.collection.findMany({ where: { shopId: shop.id } }),
      prisma.shop.findUnique({ where: { id: shop.id }, select: { brandGuidelines: true } }),
    ]);
    const indexed = buildScopedIndex(allProducts, allCollections, doc.scope.collection_ids);
    const brandGuidelines = parseBrandGuidelinesSafe(shopRow?.brandGuidelines);

    let regen;
    try {
      // BIC-2 A3 — record the regenerate's token usage against the shop.
      regen = await withAiSpendRecording(shop.id, () =>
        regenerateQuestion({
          catalogSummary: indexed.summary,
          existingQuestion: target.data,
          steeringPrompt: "",
          ...(brandGuidelines ? { brandGuidelines } : {}),
        }),
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const credit = /credit balance is too low|insufficient.*credit|billing/i.test(raw);
      return json(
        {
          intent,
          nodeId,
          ok: false,
          code: credit ? "ai_credits" : "ai_error",
          error: credit
            ? "AI credits are depleted — add credits and try again."
            : "Regenerate failed — try again.",
        },
        { status: credit ? 402 : 502 },
      );
    }

    // Merge the AI answers with the prior ones, preserving bucket mappings on
    // unchanged-text answers (text-keyed) + reusing id/edge_handle_id by index so
    // aligned per-answer routing edges resolve. Pure + unit-tested in regenerateMerge.
    const mergedAnswers = mergeRegeneratedAnswers(
      target.data.answers,
      regen.answers,
      () => `a_${Math.random().toString(36).slice(2, 10)}`,
      () => `h_${Math.random().toString(36).slice(2, 10)}`,
    );

    // Prune per-answer routing edges whose source handle no longer exists.
    const handlesNow = new Set(mergedAnswers.map((a) => a.edge_handle_id));
    const prunedEdges = doc.edges.filter(
      (e) => e.source !== nodeId || !e.source_handle || handlesNow.has(e.source_handle),
    );

    const updatedNode = {
      ...target,
      data: {
        ...target.data,
        text: regen.text,
        question_type: regen.question_type,
        required: regen.required,
        ...(regen.max_selections !== undefined ? { max_selections: regen.max_selections } : {}),
        answers: mergedAnswers,
        ai_generated: true,
      },
    };

    const updatedDoc = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === nodeId ? updatedNode : n)),
      edges: prunedEdges,
      build_session: session, // preserve the server's stage — never rewind
    };

    const reparsed = Quiz.safeParse(updatedDoc);
    if (!reparsed.success) {
      return json(
        {
          intent,
          nodeId,
          ok: false,
          code: "ai_error",
          error:
            "Regenerated question failed validation: " +
            reparsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
        },
        { status: 500 },
      );
    }

    await writeDoc(quiz.id, reparsed.data);
    return json({ intent, nodeId, ok: true, action: "regenerate-node" as const, doc: reparsed.data });
  }

  // Design step — apply a theme preset's tokens to the draft. The build threads
  // doc.design_tokens as its base, so this survives generation. Validated against
  // the DesignTokens schema (the tokens come from the client).
  if (intent === "set-design") {
    const parsed = DesignTokens.safeParse(safeJson(form.get("tokens")));
    if (!parsed.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    // §5/D6: a template replaces the whole token set wholesale; scope it to the rec
    // page's design when de-linked + editing the rec page, else the quiz design.
    const { write } = designScopeTarget(doc, form);
    await writeDoc(quiz.id, write(parsed.data));
    return json({ intent, ok: true });
  }

  // Design step — patch ONE whitelisted design-token field (shape / button style)
  // onto the draft, merged into the current tokens (so it layers on the chosen
  // preset). The build threads design_tokens, so these survive generation.
  if (intent === "set-design-field") {
    const field = String(form.get("field") ?? "");
    const value = String(form.get("value") ?? "");
    const ALLOWED: Record<string, readonly string[]> = {
      radius: ["square", "rounded", "pill"],
      button_style: ["filled", "outline", "ghost"],
    };
    if (!(field in ALLOWED) || !ALLOWED[field]!.includes(value)) {
      return json({ intent, ok: false, error: "Invalid design option." }, { status: 400 });
    }
    // §5/D6: merge onto — and write back to — the scoped token set (rec page vs quiz).
    const { base, write } = designScopeTarget(doc, form);
    const merged = DesignTokens.safeParse({ ...base, [field]: value });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §3 — the Style Bar (image density / lines / spacing, 0-100).
  // Merged onto the chosen template's tokens so the sliders fine-tune it; the
  // runtime applies them via the --qz-radius/--qz-pad/--qz-image-density vars.
  if (intent === "set-style-bar") {
    const parsed = DesignTokens.shape.style_bar.safeParse(safeJson(form.get("style_bar")));
    if (!parsed.success) {
      return json({ intent, ok: false, error: "Invalid style bar." }, { status: 400 });
    }
    // §5/D6: fine-tune the scoped token set's style bar (rec page vs quiz).
    const { base, write } = designScopeTarget(doc, form);
    await writeDoc(
      quiz.id,
      write({ ...base, style_bar: { ...base.style_bar, ...parsed.data } }),
    );
    return json({ intent, ok: true });
  }

  // Design step §1 — Brand Identity color. §5: a `scope` of "rec_page" (only when
  // de-linked) edits the rec page's own design instead of the quiz's.
  if (intent === "set-design-color") {
    const key = String(form.get("key") ?? "");
    const value = String(form.get("value") ?? "");
    const ALLOWED = ["primary", "background", "text", "accent", "secondary", "muted"];
    if (!ALLOWED.includes(key) || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      return json({ intent, ok: false, error: "Invalid color." }, { status: 400 });
    }
    const { base, write } = designScopeTarget(doc, form);
    const merged = DesignTokens.safeParse({ ...base, colors: { ...base.colors, [key]: value } });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §1 — Brand Identity font (merge a curated family into a typography
  // slot). §5: a "rec_page" scope (de-linked only) targets the rec page's design.
  if (intent === "set-design-font") {
    const slot = String(form.get("slot") ?? "");
    const family = String(form.get("family") ?? "").trim();
    if (!["heading", "body"].includes(slot) || !family) {
      return json({ intent, ok: false, error: "Invalid font." }, { status: 400 });
    }
    const { base, write } = designScopeTarget(doc, form);
    const typo = (base.typography ?? {}) as Record<string, unknown>;
    const slotTokens = (typo[slot] ?? {}) as Record<string, unknown>;
    const merged = DesignTokens.safeParse({
      ...base,
      typography: { ...typo, [slot]: { ...slotTokens, family, source: "google" } },
    });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §5 — Quiz↔Rec-Page design LINK. De-link seeds rec_page_design from
  // the quiz design (starts identical, then the rec scope diverges); re-link clears
  // it (the UI confirms first). Result/end nodes render from rec_page_design when
  // de-linked (QuizRuntime §5).
  if (intent === "set-design-linked") {
    const linked = String(form.get("linked") ?? "") === "true";
    if (linked) {
      const { rec_page_design: _drop, ...rest } = doc;
      await writeDoc(quiz.id, { ...rest, design_linked: true } as Quiz);
    } else {
      const seeded = doc.rec_page_design ?? doc.design_tokens;
      await writeDoc(quiz.id, { ...doc, design_linked: false, rec_page_design: seeded });
    }
    return json({ intent, ok: true });
  }

  // Design step §1 — Brand Identity LOGO. Three shapes share this intent:
  //  • clear=1            → remove the logo (no header renders)
  //  • a `logo` File      → uploaded image, stored as a base64 data URL
  //  • a `url` string     → pasted https asset (lightweight alternative)
  //  • size / align only  → adjust the existing logo's header rendering
  // Stored on design_tokens.logo so it cascades + survives the build/publish.
  if (intent === "set-design-logo") {
    const { base, write } = designScopeTarget(doc, form);
    const current = (base.logo ?? {}) as {
      url?: string;
      size?: string;
      align?: string;
    };

    // Remove the logo entirely.
    if (String(form.get("clear") ?? "") === "1") {
      const { logo: _drop, ...rest } = base;
      const merged = DesignTokens.safeParse(rest);
      if (!merged.success) {
        return json({ intent, ok: false, error: "Invalid theme." }, { status: 400 });
      }
      await writeDoc(quiz.id, write(merged.data));
      return json({ intent, ok: true });
    }

    // Resolve the new URL: an uploaded file wins, else a pasted URL, else keep
    // the existing one (a size/align-only update).
    let nextUrl = current.url;
    const file = form.get("logo");
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const f = file as File;
      if (!isAllowedLogoType(f.type)) {
        return json(
          { intent, ok: false, error: "Use a PNG, JPG, SVG, WEBP or GIF image." },
          { status: 400 },
        );
      }
      if (f.size === 0 || f.size > MAX_LOGO_BYTES) {
        return json({ intent, ok: false, error: "Logo must be 1 byte–2 MB." }, { status: 400 });
      }
      const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
      nextUrl = `data:${f.type.toLowerCase()};base64,${b64}`;
    } else {
      const pasted = String(form.get("url") ?? "").trim();
      if (pasted) {
        if (!isSafeLogoUrl(pasted)) {
          return json(
            { intent, ok: false, error: "Logo URL must be an https or data:image link." },
            { status: 400 },
          );
        }
        nextUrl = pasted;
      }
    }

    // size / align (optional; default the unset side when a logo first appears).
    const sizeIn = String(form.get("size") ?? "");
    const alignIn = String(form.get("align") ?? "");
    const size =
      (LOGO_SIZES as readonly string[]).includes(sizeIn) ? sizeIn : (current.size ?? "md");
    const align =
      (LOGO_ALIGNS as readonly string[]).includes(alignIn) ? alignIn : (current.align ?? "center");

    if (!nextUrl) {
      return json({ intent, ok: false, error: "No logo provided." }, { status: 400 });
    }

    const merged = DesignTokens.safeParse({
      ...base,
      logo: { url: nextUrl, size, align },
    });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid logo." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §1 — Reset to system default (the merchant confirms in the UI).
  // §5: scope-aware — resets the rec page's own design when de-linked + rec scope,
  // else the quiz design. (Must match the scoped Brand Identity panel it lives in,
  // or Reset would silently wipe the quiz while the merchant edits the rec page.)
  if (intent === "reset-design") {
    const { write } = designScopeTarget(doc, form);
    const merged = DesignTokens.safeParse(JSON.parse(JSON.stringify(DEFAULT_TOKENS)));
    if (!merged.success) {
      return json({ intent, ok: false, error: "Reset failed." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design step §1 — Re-sync from Shopify: overlay the shop's brand (colors /
  // fonts / logo persisted in shop.brandTokens at install by themeSync). §5: same
  // scope as the panel — applies to the rec page's design when editing it.
  if (intent === "resync-design") {
    const { base, write } = designScopeTarget(doc, form);
    const shopRow = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { brandTokens: true },
    });
    const brand = DesignTokens.safeParse(shopRow?.brandTokens ?? {});
    const { next, applied } = applyBrandToDesign(base, brand.success ? brand.data : {});
    if (applied.length === 0) {
      return json(
        {
          intent,
          ok: false,
          error: "No Shopify brand found yet — connect your store or set colors above.",
        },
        { status: 400 },
      );
    }
    const merged = DesignTokens.safeParse(next);
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid brand." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true, applied });
  }

  // Design step §4 — Per-Quiz Formatting. One intent for every formatting token:
  // answer_layout / answer_grid_columns (D4a), progress_bar (D4b),
  // question_image_position (D4c). Each merges into design_tokens; unset tokens
  // never get written, so a quiz stays byte-stable until the merchant opts in.
  if (intent === "set-format") {
    // §5/D6: per-quiz formatting is scope-aware too — a de-linked rec page carries
    // its own answer layout / progress bar / question image, not just colors/fonts.
    const { base, write } = designScopeTarget(doc, form);
    const key = String(form.get("key") ?? "");
    let patch: Record<string, unknown> | null = null;
    if (key === "answer_layout") {
      const v = String(form.get("value") ?? "");
      if (!["grid", "list", "auto"].includes(v)) {
        return json({ intent, ok: false, error: "Invalid answer layout." }, { status: 400 });
      }
      patch = { answer_layout: v };
    } else if (key === "answer_grid_columns") {
      const n = Number(form.get("value"));
      if (n !== 2 && n !== 3) {
        return json({ intent, ok: false, error: "Invalid column count." }, { status: 400 });
      }
      patch = { answer_grid_columns: n };
    } else if (key === "question_image_position") {
      const v = String(form.get("value") ?? "");
      if (!["none", "top", "side"].includes(v)) {
        return json({ intent, ok: false, error: "Invalid image position." }, { status: 400 });
      }
      patch = { question_image_position: v };
    } else if (key === "progress_bar") {
      const parsed = DesignTokens.shape.progress_bar.safeParse(safeJson(form.get("value")));
      if (!parsed.success) {
        return json({ intent, ok: false, error: "Invalid progress bar." }, { status: 400 });
      }
      patch = { progress_bar: { ...base.progress_bar, ...parsed.data } };
    } else {
      return json({ intent, ok: false, error: "Unknown format key." }, { status: 400 });
    }
    const merged = DesignTokens.safeParse({ ...base, ...patch });
    if (!merged.success) {
      return json({ intent, ok: false, error: "Invalid formatting." }, { status: 400 });
    }
    await writeDoc(quiz.id, write(merged.data));
    return json({ intent, ok: true });
  }

  // Design "Continue →": park at the Overview review step before the build.
  // The build itself still fires from Overview via generate-build (below).
  if (intent === "to-overview") {
    if (!session.picked_template) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }
    await writeDoc(quiz.id, { ...doc, build_session: { ...session, stage: "overview" } });
    return json({ intent, ok: true });
  }

  if (intent === "generate-build") {
    const picked = session.picked_template;
    // Start-routing spec: manual/blank + failed-goal DECIDER drafts have no
    // picked_template; built:true is their finalize credential (the graduate
    // branch below never reads `picked`). Legacy behavior unchanged.
    if (!picked && !(doc.logic_model === "decider" && session.built)) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }

    // Re-architected flow: the quiz is ALREADY built (the question build ran at
    // the Question Builder step). Generate is a NON-AI finalize — just open the
    // already-built draft in the builder. Re-running startStep2Build would strip +
    // rebuild the sb_ question nodes (fresh answer ids) and re-bake result nodes,
    // DESTROYING every Question Builder / Rec Page / Design edit. The merchant's
    // last design/rec edits already live on the draft (autosaved), so nothing else
    // to apply.
    if (session.built) {
      // Graduate the draft out of the "step1" in-flight state: the funnel is done,
      // so it should now appear in the gallery AND "Create new quiz" should start a
      // FRESH draft instead of resuming this finished one (findOrCreateStep1Draft
      // only resumes buildState:"step1" drafts).
      await prisma.quiz.update({ where: { id: quiz.id }, data: { buildState: null } });
      return redirect(opts.builderPath(quiz.id));
    }

    // LOGIC v2 / O-3 trapdoor — a decider draft mid-build (built:false, and the
    // saved-template path now also seeds picked_template) must never reach the
    // legacy startStep2Build below: it would strip + rebuild outside the decider
    // pipeline. Only the built:true non-AI finalize above is decider-legal.
    if (doc.logic_model === "decider") {
      return json({ intent, ok: false, error: "The quiz is still building — give it a moment." }, { status: 400 });
    }

    // Legacy in-flight draft that reached Overview the OLD way (no build yet) →
    // run the real detached build, landing in the builder via the buildState overlay.
    // (A missing picked_template only passes the top guard on decider+built drafts,
    // and both of those branches returned above — this re-check narrows the type.)
    if (!picked) {
      return json({ intent, ok: false, error: "No template selected." }, { status: 400 });
    }
    const rich = session.rich_templates.find((t) => t.id === picked.template_id);
    if (!rich) return json({ intent, ok: false, error: "Template not found." }, { status: 400 });
    if (!session.goal?.goal_text) return json({ intent, ok: false, error: "Add a goal before building." }, { status: 400 });
    await startStep2Build(
      shop.id,
      quiz.id,
      rich,
      picked,
      session.goal.goal_text,
      session.goal.struggle_text ?? "",
    );
    return redirect(opts.builderPath(quiz.id));
  }

  // LOGIC v2 / O-3 — decider drafts never use the retired battle card; the
  // saved-template path re-seeds rich_templates + picked_template, so this
  // navigation intent must stay closed (stale tabs, scripted posts).
  if (intent === "back-to-configuring" && doc.logic_model === "decider") {
    return json({ intent, ok: false, error: "That step isn't part of this flow." }, { status: 400 });
  }

  if (
    intent === "back-to-grouping" ||
    intent === "back-to-goal" ||
    intent === "back-to-types" ||
    intent === "back-to-configuring"
  ) {
    const stage =
      intent === "back-to-grouping"
        ? "grouping"
        : intent === "back-to-goal"
          ? "goal"
          : intent === "back-to-configuring"
            ? "configuring"
            : // Start-routing spec §3 — Back from Questions goes to Shape only
              // when the merchant came THROUGH it (tier-1 types exist). The
              // write-a-goal and blank-quiz routes skip Shape, so their Back
              // returns to Recommendations. Decider-gated: legacy in-flight
              // drafts keep today's destination byte-identically.
              doc.logic_model === "decider" && session.quiz_types.length === 0
              ? "grouping"
              : "types";
    const next: BuildSession = { ...session, stage };
    await writeDoc(quiz.id, { ...doc, build_session: next });
    return json({ intent, ok: true });
  }

  return json({ intent, ok: false, error: "Unknown action" }, { status: 400 });
}

// Parse a form value as JSON, returning null on any failure (the Zod safeParse
// downstream rejects nulls cleanly).
function safeJson(v: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(v ?? "null"));
  } catch {
    return null;
  }
}

// §5 — a design intent targets the quiz design by default, or the rec page's own
// design when scope="rec_page" AND the quiz is de-linked. Returns the token object
// to merge into + a writer that puts the result back on the right field.
function designScopeTarget(doc: Quiz, form: FormData): {
  base: Quiz["design_tokens"];
  write: (next: Quiz["design_tokens"]) => Quiz;
} {
  const recScope = String(form.get("scope") ?? "") === "rec_page" && doc.design_linked === false;
  const base = recScope ? (doc.rec_page_design ?? doc.design_tokens) : doc.design_tokens;
  return {
    base,
    write: (next) => (recScope ? { ...doc, rec_page_design: next } : { ...doc, design_tokens: next }),
  };
}
