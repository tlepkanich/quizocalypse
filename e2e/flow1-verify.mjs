// FLOW-1 probe — the "Write Your Goal" goal-first flow on the LOCAL prod build
// + LOCAL DB. Drives the REAL front-door UI (the /studio/goal page), then
// deletes its own probe draft (name-prefixed "flow1-probe-") in `finally`.
// Never touches existing fixtures beyond read.
//
// Two modes (run each against its own server):
//   PROBE_MODE=fail  — server started WITH A BLANK ANTHROPIC KEY:
//       ANTHROPIC_API_KEY= SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x \
//         SHOPIFY_APP_URL=http://localhost:3000 PORT=3000 npm run start
//     Proves: goal entry UI (form gating), pre-pick FAILED banner (four-outcome
//     copy) + Retry, the catalog browser as the manual way forward, the
//     headless confirm's failure path (blank-Questions landing + notice), and
//     the STALLED backstop (aged updatedAt → stalled banner + Retry).
//   PROBE_MODE=happy — server started WITH the real key (real AI spend:
//     1 pre-pick call + the types→templates→question-build pipeline):
//     Proves: goal → pre-picked buckets render → confirm → headless build
//     progresses (gen_progress checkpoints polled) → lands on the Questions
//     step with generated question nodes. Reports the AiUsage delta.
//
// Run:  set -a; source .env; set +a; PROBE_MODE=fail node e2e/flow1-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const MODE = process.env.PROBE_MODE ?? "fail";
const DIR = process.env.SHOT_DIR ?? "/tmp/flow1-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });

const mask = (s) => String(s).replaceAll(KEY, "***");
const results = [];
const check = (name, ok, extra = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} [${MODE}] ${name}${extra ? ` — ${mask(extra)}` : ""}`);

const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readDraft = async (id) => {
  const q = await prisma.quiz.findUnique({ where: { id }, select: { name: true, draftJson: true, buildState: true } });
  return q ? { name: q.name, doc: q.draftJson, session: q.draftJson?.build_session ?? {} } : null;
};

const GOAL_TEXT =
  "Help shoppers find the right snowboard setup for their terrain and skill level";

const usageBefore = await prisma.aiUsage.findMany({ select: { shopId: true, day: true, inputTokens: true, outputTokens: true, calls: true } });

// The goal front door may legitimately CLAIM a pre-existing pristine in-flight
// draft (claimGoalFirstDraft). Snapshot every step1 draft up front: a claimed
// pre-existing draft is RESTORED byte-for-byte in `finally` (never deleted);
// only a genuinely new probe draft is deleted.
const preExisting = new Map(
  (
    await prisma.quiz.findMany({
      where: { buildState: "step1" },
      select: { id: true, name: true, draftJson: true },
    })
  ).map((q) => [q.id, { name: q.name, draftJson: q.draftJson }]),
);
const preExistingCats = await prisma.category.findMany({
  where: { quizId: { in: [...preExisting.keys()] } },
});

const browser = await chromium.launch();
let ctx;
let quizId = null;
try {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // ── 1 · The goal front door (real UI) ─────────────────────────────────────
  await page.goto(`${BASE}/studio/goal?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-goal-page", { timeout: 20000 });
  check("goal page renders (title + brief tracker)",
    (await page.locator("h1", { hasText: "Write your goal" }).count()) === 1 &&
    (await page.locator(".qz-sm-track").count()) === 1);
  const cta = page.locator(".qz-sm-gen");
  check("CTA disabled before goal + length", await cta.isDisabled());
  await page.screenshot({ path: `${DIR}/${MODE}-1-goal-entry.png`, fullPage: true });

  await page.fill("#qz-goal-goal", GOAL_TEXT);
  await page.fill("#qz-goal-aud", "First-time riders buying a starter setup");
  await page.fill("#qz-goal-fac", "Terrain, experience level, budget");
  check("CTA still disabled without a length", await cta.isDisabled());
  await page.locator(".qz-sm-segb", { hasText: /^5$/ }).click();
  check("CTA enables once goal + length are set", !(await cta.isDisabled()));
  check("tracker reads 4 of 4", (await page.locator(".qz-sm-tcnt").textContent())?.trim() === "4 of 4 complete");
  await page.screenshot({ path: `${DIR}/${MODE}-2-goal-filled.png`, fullPage: true });

  // ── 2 · Submit → draft created, lands on the recs step ────────────────────
  await cta.click();
  await page.waitForURL(/\/studio\/onboarding\//, { timeout: 30000 });
  quizId = page.url().match(/onboarding\/([a-z0-9]+)/)?.[1] ?? null;
  check("submit redirects into the funnel", Boolean(quizId), `quiz ${quizId}`);
  // Cleanup discipline: our own probe draft, name-prefixed immediately.
  await prisma.quiz.update({ where: { id: quizId }, data: { name: `flow1-probe-${Date.now()}` } });

  let d = await readDraft(quizId);
  check("draft is decider + goal_first flow at grouping",
    d.doc.logic_model === "decider" &&
    d.session.stage === "grouping" &&
    d.session.goal_first != null,
    `prepick=${d.session.goal_first?.prepick}`);
  check("goal brief folded into session.goal",
    (d.session.goal?.goal_text ?? "").startsWith(GOAL_TEXT) &&
    (d.session.goal?.goal_text ?? "").includes("Audience:") &&
    (d.session.goal?.goal_text ?? "").includes("Deciding factors:"));
  check("question length captured", d.session.goal_first?.question_length === 5);

  await page.waitForSelector(".qz-rb", { timeout: 20000 });

  if (MODE === "fail") {
    // ── 3f · Pre-pick fails (no AI key) → failed banner + manual way forward ─
    for (let i = 0; i < 40; i++) {
      d = await readDraft(quizId);
      if (d.session.goal_first?.prepick === "failed") break;
      await sleep(1500);
    }
    check("pre-pick lands FAILED without a key", d.session.goal_first?.prepick === "failed",
      `error=${d.session.goal_first?.error}`);
    check("failure copy is the four-outcome class (no raw error)",
      /choose (your products|them) below/i.test(d.session.goal_first?.error ?? "") &&
      !/api|anthropic|401|key/i.test(d.session.goal_first?.error ?? ""));
    // The page polls itself; wait for the failed banner to paint.
    await page.waitForSelector(".qz-gf-banner.is-weak", { timeout: 20000 });
    check("failed banner renders with Retry",
      (await page.locator(".qz-gf-banner.is-weak button", { hasText: "Try again" }).count()) === 1);
    await page.screenshot({ path: `${DIR}/${MODE}-3-prepick-failed.png`, fullPage: true });

    // Manual way forward: the browser still works — pick one product for real.
    await page.locator(".qz-rb-card").first().click();
    await sleep(1200);
    const railCount = (await page.locator(".qz-rb-count").textContent())?.trim();
    check("manual pick still works after failure", railCount === "1", `rail=${railCount}`);
    await page.screenshot({ path: `${DIR}/${MODE}-4-manual-pick.png`, fullPage: true });

    // ── 4f · Headless confirm's failure path → blank Questions + notice ──────
    const gen = page.locator(".qz-rb-rail-foot button", { hasText: "Generate my quiz" });
    check("flow-1 Continue reads 'Generate my quiz →' (no intercept modal)", (await gen.count()) === 1);
    await gen.click();
    // typing job fails fast without a key → failToBlankQuestions.
    for (let i = 0; i < 60; i++) {
      d = await readDraft(quizId);
      if (d.session.stage === "question_builder") break;
      await sleep(1500);
    }
    check("failed headless chain lands on Questions (never Shape)",
      d.session.stage === "question_builder" && d.session.built === true,
      `stage=${d.session.stage}`);
    check("blank-questions notice persisted", /starting blank|blank/i.test(d.session.gen_error ?? ""),
      d.session.gen_error ?? "(none)");
    check("no start pop-up was involved (modal never rendered)",
      (await page.locator(".qz-sm-rows").count()) === 0);
    await page.waitForTimeout(4000); // let the poll flip the stage client-side
    await page.screenshot({ path: `${DIR}/${MODE}-5-blank-questions-landing.png`, fullPage: true });

    // ── 5f · STALLED backstop: age the draft mid-"picking" ──────────────────
    d = await readDraft(quizId);
    await prisma.quiz.update({
      where: { id: quizId },
      data: {
        draftJson: {
          ...d.doc,
          build_session: { ...d.session, stage: "grouping", gen_error: undefined, goal_first: { prepick: "picking", question_length: 5 } },
        },
      },
    });
    // Age via the Prisma client (explicit updatedAt overrides @updatedAt and
    // round-trips on the NODE clock). Raw SQL is a trap here twice over: DB
    // now() is clock-skewed vs Date.now(), and a raw Date param goes through a
    // session-timezone conversion on the tz-less column (~9h shift).
    await prisma.quiz.update({
      where: { id: quizId },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await page.goto(`${BASE}/studio/onboarding/${quizId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-gf-banner", { timeout: 20000 });
    check("stalled pre-pick shows the stall banner + Try again",
      (await page.locator(".qz-gf-banner", { hasText: "taking longer" }).count()) === 1 &&
      (await page.locator(".qz-gf-banner button", { hasText: "Try again" }).count()) === 1);
    await page.screenshot({ path: `${DIR}/${MODE}-6-prepick-stalled.png`, fullPage: true });
    // Retry re-kicks the job (which fails again without a key) — proves the
    // retry-gen wiring end-to-end.
    await page.locator(".qz-gf-banner button", { hasText: "Try again" }).click();
    for (let i = 0; i < 30; i++) {
      d = await readDraft(quizId);
      if (d.session.goal_first?.prepick === "failed") break;
      await sleep(1500);
    }
    check("retry-gen re-kicked the pre-pick (fails honestly again)",
      d.session.goal_first?.prepick === "failed");
  } else {
    // ── 3h · HAPPY: pre-pick lands ready with real selections ────────────────
    for (let i = 0; i < 80; i++) {
      d = await readDraft(quizId);
      if (d.session.goal_first?.prepick !== "picking") break;
      await sleep(1500);
    }
    check("pre-pick lands READY", d.session.goal_first?.prepick === "ready",
      `state=${d.session.goal_first?.prepick} err=${d.session.goal_first?.error ?? ""}`);
    const cats = await prisma.category.findMany({ where: { quizId }, select: { name: true, source: true, productIds: true } });
    check("AI persisted ≥2 bucket Category rows with members",
      cats.length >= 2 && cats.every((c) => c.productIds.length > 0),
      cats.map((c) => `${c.source}:${c.name}(${c.productIds.length})`).join(", "));
    await page.waitForSelector(".qz-gf-banner.is-applied", { timeout: 20000 });
    check("ready banner narrates the pick", true);
    const railCount = (await page.locator(".qz-rb-count").textContent())?.trim();
    check("recs rail is pre-populated", Number(railCount) === cats.length, `rail=${railCount}`);
    await page.screenshot({ path: `${DIR}/${MODE}-3-prepicked-recs.png`, fullPage: true });

    // ── 4h · Confirm → headless build (poll gen_progress) → Questions ───────
    await page.locator(".qz-rb-rail-foot button", { hasText: "Generate my quiz" }).click();
    const seenProgress = new Set();
    const seenStages = new Set();
    let landed = false;
    for (let i = 0; i < 280; i++) {
      d = await readDraft(quizId);
      if (d.session.gen_progress) seenProgress.add(d.session.gen_progress);
      seenStages.add(d.session.stage);
      if (d.session.stage === "question_builder") { landed = true; break; }
      if (i === 8) {
        await page.screenshot({ path: `${DIR}/${MODE}-4-headless-generating.png`, fullPage: true });
      }
      await sleep(1500);
    }
    check("headless chain progressed through typing→templating",
      seenStages.has("typing") && seenStages.has("templating"),
      [...seenStages].join("→"));
    check("gen_progress checkpoints observed", seenProgress.size >= 1, [...seenProgress].join(","));
    check("never parked on Shape (types) for a choice", !seenStages.has("types"));
    check("lands on the Questions step, built", landed && d.session.built === true,
      `stage=${d.session.stage}`);
    check("headless auto-pick recorded (type + template + pinned length)",
      d.session.picked_type_id != null &&
      d.session.picked_template != null &&
      d.session.quiz_types?.[0]?.question_range?.min === 5 &&
      d.session.quiz_types?.[0]?.question_range?.max === 5,
      `type=${d.session.picked_type_id}`);
    const qNodes = (d.doc.nodes ?? []).filter((n) => n.type === "question");
    check("generated question nodes present", qNodes.length >= 3, `${qNodes.length} questions`);
    check("no gen_error on the happy path", d.session.gen_error == null, d.session.gen_error ?? "");
    // The build's re-seed drops scoring_model on EVERY decider flow (decider
    // docs are direct by construction — the engine never reads it); the
    // contract is only that it can never come out "weighted".
    check("scoring is direct-or-absent (never weighted)", d.doc.scoring_model !== "weighted",
      `scoring=${d.doc.scoring_model ?? "(absent)"}`);
    // Let the client poll flip to the builder shell, then shoot the landing.
    await page.waitForSelector(".qz-s3, [data-qz-step3], .qz-qb, .qz-topbar3", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${DIR}/${MODE}-5-questions-landing.png`, fullPage: true });
  }

  // ── AI spend report ────────────────────────────────────────────────────────
  const usageAfter = await prisma.aiUsage.findMany({ select: { shopId: true, day: true, inputTokens: true, outputTokens: true, calls: true } });
  const beforeKey = new Map(usageBefore.map((u) => [`${u.shopId}:${u.day}`, u]));
  let dIn = 0, dOut = 0, dCalls = 0;
  for (const u of usageAfter) {
    const b = beforeKey.get(`${u.shopId}:${u.day}`);
    dIn += u.inputTokens - (b?.inputTokens ?? 0);
    dOut += u.outputTokens - (b?.outputTokens ?? 0);
    dCalls += u.calls - (b?.calls ?? 0);
  }
  results.push(`INFO [${MODE}] AiUsage delta: ${dCalls} calls, ${dIn} in / ${dOut} out tokens (~$${((dIn * 3 + dOut * 15) / 1e6).toFixed(4)})`);
} catch (e) {
  results.push(`FAIL [${MODE}] probe crashed — ${mask(e?.stack ?? e?.message ?? String(e))}`);
} finally {
  // Fixture discipline: a claimed PRE-EXISTING draft is restored byte-for-byte;
  // a genuinely new probe draft is deleted (categories first — quiz-scoped
  // rows, not covered by a Quiz cascade).
  if (quizId) {
    await prisma.category.deleteMany({ where: { quizId } }).catch(() => {});
    const prior = preExisting.get(quizId);
    if (prior) {
      await prisma.quiz
        .update({ where: { id: quizId }, data: { name: prior.name, draftJson: prior.draftJson, buildState: "step1" } })
        .catch(() => {});
      for (const c of preExistingCats.filter((c) => c.quizId === quizId)) {
        const { id: _drop, createdAt: _c, updatedAt: _u, ...data } = c;
        await prisma.category.create({ data }).catch(() => {});
      }
      results.push(`INFO [${MODE}] claimed pre-existing draft ${quizId} restored`);
    } else {
      await prisma.quiz.delete({ where: { id: quizId } }).catch(() => {});
      results.push(`INFO [${MODE}] probe draft ${quizId} deleted`);
    }
  }
  await ctx?.close();
  await browser.close();
  await prisma.$disconnect();
  const fails = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(results.join("\n"));
  console.log(`\n${results.filter((r) => r.startsWith("PASS")).length} passed, ${fails} failed — shots in ${DIR}`);
  process.exit(fails ? 1 : 0);
}
