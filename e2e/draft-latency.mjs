// DRAFT-FAST / QBUILD-FAST — the latency probe for the generating screen's
// two AI rows ("Drafting tailored quiz types", "Writing your questions"):
// the headless chain's passes, called as DIRECT server functions (no route,
// nothing deployed) against a real local draft's confirmed buckets — the
// same seams the detached jobs call.
//
// Variants (DRAFT_VARIANT):
//   baseline  — generateStep2Types → pickHeadlessType → generateStep2Templates
//               (the two sequential passes the headless chains ran before
//               DRAFT-FAST; still the Shape route's passes).
//   direction — generateStep2Direction, the ONE merged pass the headless
//               chains run now.
//   questions — the "Writing your questions" row: runAiOnboardingBuild in
//               CAPTURE mode (nothing persists) for ONE fixed direction, so
//               every trial builds from identical inputs. DRAFT_DIRECTION_FROM
//               reuses the direction saved in an earlier questions report
//               (apples-to-apples across code changes); DRAFT_QUESTION_FLOW
//               (single | planned) pins the build's question-flow strategy —
//               one Sonnet response vs an outline + parallel writes. Needs a
//               shop with a synced collection (the build's fallback page).
//   chain     — the whole headless chain after research, as the detached
//               jobs run it: draftHeadlessDirection (the direction pass, with
//               the question plan beside it for a small pool), then the build
//               in capture mode. DRAFT_OVERLAP=off runs the two in sequence
//               (direction, then a build that plans inline) for comparison.
//
// Run:  set -a; source .env; set +a; \
//       DRAFT_QUIZ=<local quiz id> DRAFT_TRIALS=5 DRAFT_VARIANT=baseline \
//       [DRAFT_RESEARCH=none] [DRAFT_GOAL="…"] [DRAFT_OUT=report.json] \
//       node_modules/.bin/vite-node --config vitest.config.ts e2e/draft-latency.mjs
//
// Requires ANTHROPIC_API_KEY (real API spend: Haiku, ~2 calls per baseline
// trial, 1 per direction trial; Sonnet for a questions trial, ~$0.03–0.06).
// Writes NOTHING to the draft — the only DB write is the bucket-membership
// refresh every generation already performs.
// Output: one JSON line per trial + a summary on stdout; the full report
// (with every generated card, for the quality read) to DRAFT_OUT when set.
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { setAiUsageEmitter } from "../app/lib/claude";
import * as step2 from "../app/lib/step2Build.server";
import { pickHeadlessType } from "../app/lib/headlessTypePick";
import { loadGenerationBuckets } from "../app/lib/bucketPersist.server";
import { parseBrandIdentitySafe } from "../app/lib/brandIdentity";
import { suggestQuizGoal } from "../app/lib/goalSuggest";
import { parseWebResearchRecord } from "../app/lib/shopWebResearch.server";
import { runAiOnboardingBuild } from "../app/lib/onboardingBuild.server";
import { dialsToBuildDirectives } from "../app/lib/dialDirectives";

const QUIZ_ID = process.env.DRAFT_QUIZ ?? "cmr7khgd50001vkhscvox8dgt";
const TRIALS = Number(process.env.DRAFT_TRIALS ?? 3);
const VARIANT = process.env.DRAFT_VARIANT ?? "baseline";
const GOAL_OVERRIDE = process.env.DRAFT_GOAL;
const OUT = process.env.DRAFT_OUT;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing — source .env first. Probe NOT run.");
  process.exit(1);
}
if (!["baseline", "direction", "questions", "chain"].includes(VARIANT)) {
  console.error(`Unknown DRAFT_VARIANT "${VARIANT}" — use baseline | direction | questions | chain.`);
  process.exit(1);
}
if (VARIANT !== "baseline" && typeof step2.generateStep2Direction !== "function") {
  console.error("generateStep2Direction is not exported on this tree. Probe NOT run.");
  process.exit(1);
}

const prisma = new PrismaClient();
const quiz = await prisma.quiz.findUnique({
  where: { id: QUIZ_ID },
  select: { id: true, shopId: true, name: true },
});
if (!quiz) {
  console.error(`Quiz ${QUIZ_ID} not found in the LOCAL DB (deploy fixtures never cross).`);
  process.exit(1);
}
const shop = await prisma.shop.findUnique({
  where: { id: quiz.shopId },
  select: { brandIdentity: true, webResearch: true },
});
const cats = await loadGenerationBuckets(quiz.shopId, quiz.id);
if (cats.length === 0) {
  console.error(`Quiz ${QUIZ_ID} has no confirmed buckets — pick a draft that does.`);
  process.exit(1);
}
// The same deterministic goal continue-buckets derives (FLOW-2), unless pinned.
const goal =
  GOAL_OVERRIDE ??
  suggestQuizGoal({
    identitySummary: parseBrandIdentitySafe(shop?.brandIdentity)?.summary ?? null,
    groupNames: cats.map((c) => c.name),
  });
// Whatever research the shop has cached — every trial and variant sees the
// same text, so the comparison is apples-to-apples ("" degrades both alike).
// DRAFT_RESEARCH=none forces "" (the chain's cache-miss input).
const webResearchText =
  process.env.DRAFT_RESEARCH === "none"
    ? ""
    : (parseWebResearchRecord(shop?.webResearch)?.text ?? "");
const buckets = cats.map((c) => ({ id: c.id, name: c.name, tags: c.tags }));

console.log(
  `variant=${VARIANT} quiz=${quiz.id} "${quiz.name}" buckets=[${buckets.map((b) => b.name).join(" · ")}] research=${webResearchText.length} chars trials=${TRIALS}`,
);
console.log(`goal: ${goal}`);

// Every model response emits once through the shared createMessage seam, so
// the emitter counts API calls (retries included) + tokens per pass.
// input_tokens is the BILLED-equivalent count (prompt-cache writes at 1.25×,
// reads at 0.1×); cache_read is the raw tokens served from the cache.
const zeroUsage = () => ({ calls: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0 });
let usage = zeroUsage();
setAiUsageEmitter((u) => {
  usage.calls += 1;
  usage.input_tokens += u.input_tokens;
  usage.output_tokens += u.output_tokens;
  usage.cache_read += u.cache_read_input_tokens ?? 0;
  usage.cache_write += u.cache_creation_input_tokens ?? 0;
});
async function timed(fn) {
  usage = zeroUsage();
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0, ...usage };
}
const meta = ({ ms, calls, input_tokens, output_tokens, cache_read, cache_write }) => ({
  ms,
  calls,
  input_tokens,
  output_tokens,
  ...(cache_read || cache_write ? { cache_read, cache_write } : {}),
});

async function runBaseline() {
  const types = await timed(() =>
    step2.generateStep2Types(quiz.shopId, quiz.id, { goal, buckets, webResearchText }),
  );
  const top = pickHeadlessType(types.value.types);
  if (!top) throw new Error("types pass returned no type");
  const templates = await timed(() =>
    step2.generateStep2Templates(quiz.shopId, quiz.id, top, { goal, buckets }),
  );
  return {
    passes: { types: meta(types), templates: meta(templates) },
    picked: { type: top, template: templates.value[0] },
  };
}

async function runDirection() {
  const direction = await timed(() =>
    step2.generateStep2Direction(quiz.shopId, quiz.id, { goal, buckets, webResearchText }),
  );
  return {
    passes: { direction: meta(direction) },
    picked: { type: direction.value.type, template: direction.value.template },
  };
}

// ONE direction for every questions trial (and, via DRAFT_DIRECTION_FROM, for
// every run being compared) — the question build's inputs stay identical.
let fixedDirection = null;
if (VARIANT === "questions") {
  fixedDirection = process.env.DRAFT_DIRECTION_FROM
    ? JSON.parse(readFileSync(process.env.DRAFT_DIRECTION_FROM, "utf8")).direction
    : await step2.generateStep2Direction(quiz.shopId, quiz.id, { goal, buckets, webResearchText });
  console.log(
    `direction: "${fixedDirection.template.title}" — ${fixedDirection.template.question_count} questions`,
  );
}

// Mirrors buildQuizFromPicked's assembly (step2Build.server.ts), in capture
// mode: the finished doc is returned, never written.
async function buildQuestions(template, prefetchedQuestions) {
  const { tokenPatch, promptDirectives } = dialsToBuildDirectives(template.dials);
  const strategy = process.env.DRAFT_QUESTION_FLOW;
  const build = await timed(() =>
    runAiOnboardingBuild({
      shopId: quiz.shopId,
      quizId: quiz.id,
      name: template.title,
      goalPrompt: goal,
      questionCount: template.question_count,
      tone: "friendly",
      flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
      experienceType: "product_match",
      logicModel: "decider",
      preResolvedBuckets: buckets,
      directionAngle: template.angle,
      sampleQuestionSeeds: template.sample_questions,
      designTokens: null,
      tokenPatch,
      dialDirectives: promptDirectives,
      recOverride: {
        max_products: template.rec_defaults.max_products,
        oos_behavior: template.rec_defaults.oos_behavior,
        fallback_collection_id: template.rec_defaults.fallback_collection_id,
      },
      captureDoc: true,
      ...(strategy ? { questionFlow: strategy } : {}),
      ...(prefetchedQuestions ? { prefetchedQuestions } : {}),
    }),
  );
  if (!build.value.doc) throw new Error(`degraded build: ${build.value.degraded}`);
  const questions = build.value.doc.nodes
    .filter((n) => n.type === "question")
    .map((n) => ({
      text: n.data.text,
      type: n.data.question_type,
      role: n.data.role ?? null,
      section: n.data.section_label ?? null,
      helper: n.data.helper_text ?? null,
      education: n.data.education_card_before ?? null,
      answers: n.data.answers.map((a) => ({ text: a.text, tags: a.tags })),
    }));
  // The deterministic mapper's verdict on the deciding question: how many of
  // the quiz's buckets its answers reach (the routing-quality signal).
  const decider = build.value.doc.nodes.find(
    (n) => n.type === "question" && n.data.role === "decides",
  );
  const reached = new Set((decider?.data.answers ?? []).flatMap((a) => (a.target_id ? [a.target_id] : [])));
  return {
    passes: {
      questions: {
        ...meta(build),
        questions: questions.length,
        decider: `${reached.size}/${buckets.length}`,
        roles: questions.map((q) => (q.role ?? "?")[0]).join(""),
        helpers: questions.filter((q) => q.helper).length,
      },
    },
    built: questions,
  };
}

const runQuestions = () => buildQuestions(fixedDirection.template);

async function runChain() {
  const overlap = process.env.DRAFT_OVERLAP !== "off";
  // DRAFT_PLAN_MODEL / DRAFT_WRITE_MODEL — a model id per planned-build step
  // (side-by-side comparisons; the app itself runs both on Sonnet).
  const plannedModels = {
    ...(process.env.DRAFT_PLAN_MODEL ? { plan: process.env.DRAFT_PLAN_MODEL } : {}),
    ...(process.env.DRAFT_WRITE_MODEL ? { write: process.env.DRAFT_WRITE_MODEL } : {}),
  };
  const draft = await timed(() =>
    overlap
      ? step2.draftHeadlessDirection(quiz.shopId, quiz.id, {
          goal,
          cats: buckets,
          webResearchText,
          ...(Object.keys(plannedModels).length ? { plannedModels } : {}),
        })
      : step2.generateStep2Direction(quiz.shopId, quiz.id, { goal, buckets, webResearchText }),
  );
  const built = await buildQuestions(draft.value.template, draft.value.prefetchedQuestions);
  return {
    passes: {
      drafting: { ...meta(draft), plan: Boolean(draft.value.prefetchedQuestions) },
      questions: built.passes.questions,
    },
    picked: { type: draft.value.type, template: draft.value.template },
    built: built.built,
  };
}

const RUNNERS = {
  baseline: runBaseline,
  direction: runDirection,
  questions: runQuestions,
  chain: runChain,
};
const trials = [];
for (let i = 1; i <= TRIALS; i++) {
  const t0 = Date.now();
  try {
    const r = await RUNNERS[VARIANT]();
    const trial = { trial: i, ok: true, totalMs: Date.now() - t0, ...r };
    trials.push(trial);
    console.log(JSON.stringify({ trial: i, ok: true, totalMs: trial.totalMs, passes: r.passes }));
  } catch (err) {
    const trial = { trial: i, ok: false, totalMs: Date.now() - t0, error: String(err) };
    trials.push(trial);
    console.log(JSON.stringify(trial));
  }
}

const okMs = trials.filter((t) => t.ok).map((t) => t.totalMs).sort((a, b) => a - b);
const summary = {
  variant: VARIANT,
  quiz: quiz.id,
  trials: TRIALS,
  failed: trials.length - okMs.length,
  minMs: okMs[0] ?? null,
  medianMs: okMs.length ? okMs[Math.floor((okMs.length - 1) / 2)] : null,
  maxMs: okMs[okMs.length - 1] ?? null,
  meanMs: okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : null,
  extraCalls: trials
    .filter((t) => t.ok)
    .reduce(
      (n, t) =>
        n + Object.values(t.passes).reduce((m, p) => m + Math.max(0, p.calls - 1), 0),
      0,
    ),
};
console.log("SUMMARY " + JSON.stringify(summary));
if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      { summary, goal, buckets, ...(fixedDirection ? { direction: fixedDirection } : {}), trials },
      null,
      2,
    ),
  );
  console.log(`report → ${OUT}`);
}
await prisma.$disconnect();
