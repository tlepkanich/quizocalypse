// FLOW-2 probe — the manual flow's start pop-up, scoped + re-routed
// (funnel-reconfig Flow 2 / Phase 3), on the LOCAL prod build + LOCAL DB.
// Drives the REAL funnel UI, name-prefixes its probe draft ("flow2-probe-"),
// and restores/deletes it in `finally`. Never touches existing fixtures
// beyond read (a claimed pre-existing draft is restored byte-for-byte).
//
// Asserts (per docs/funnel-reconfig.md Flow 2 + the Phase-3 cleanup):
//   • A MANUAL decider draft (neither goal_first nor template_first) still
//     sees the "How do you want to start?" pop-up — screen 1 only.
//   • Its three choices route correctly:
//       Generate with AI → continue-buckets → HEADLESS typing/templating chain
//         (never stage "types"/Shape) → the Questions step.
//       Write your goal  → navigates to /studio/goal (the Flow-1 front door;
//         the in-modal goal-brief second screen is retired).
//       Start from blank → manual-build → blank Questions (decider skeleton).
//   • goal-first and template-first drafts NEVER see the pop-up (their
//     Continue confirms via flow1/flow3-confirm directly).
//   • The gen-error banner + stalled generating screen link
//     /studio/templates — no /studio/new redirect-bounce anywhere.
//
// Two modes (run each against its own server):
//   PROBE_MODE=fail  — server started WITH A BLANK ANTHROPIC KEY ($0):
//       ANTHROPIC_API_KEY= SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x \
//         SHOPIFY_APP_URL=http://localhost:3000 PORT=3000 npm run start
//     The AI-generate choice's failure path must land the blank-Questions
//     notice (never Shape), and every leak assert runs at $0.
//   PROBE_MODE=happy — server started WITH the real key (real AI spend:
//     the types→templates→question-build pipeline, ~3 calls): the AI-generate
//     choice lands on Questions with generated nodes. Reports AiUsage delta.
//
// Run:  set -a; source .env; set +a; PROBE_MODE=fail node e2e/flow2-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const MODE = process.env.PROBE_MODE ?? "fail";
const DIR = process.env.SHOT_DIR ?? "/tmp/flow2-shots";
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
  const q = await prisma.quiz.findUnique({
    where: { id },
    select: { name: true, draftJson: true, buildState: true },
  });
  return q ? { name: q.name, doc: q.draftJson, session: q.draftJson?.build_session ?? {} } : null;
};
const writeSession = async (id, mutate) => {
  const d = await readDraft(id);
  await prisma.quiz.update({
    where: { id },
    data: { draftJson: { ...d.doc, build_session: mutate(d.session) } },
  });
};

const usageBefore = await prisma.aiUsage.findMany({
  select: { shopId: true, day: true, inputTokens: true, outputTokens: true, calls: true },
});

// The front door may legitimately RESUME a pre-existing in-flight draft.
// Snapshot every step1 draft up front: anything we touched that pre-existed is
// RESTORED byte-for-byte in `finally`; only a genuinely new draft is deleted.
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

// A synthetic starter-shaped RichTemplateOption for the template-first leak
// assert (the o3-verify precedent — bucket ids deliberately stale).
const SYNTH_RICH = {
  id: "flow2-probe-template",
  experience_type: "product_match",
  title: "Flow2 Probe Terrain Finder",
  angle: "Probe-seeded template exercising the flow3-confirm no-pop-up path.",
  rationale: "",
  sample_questions: ["Where do you ride most?", "What matters most in a board?"],
  feature_notes: ["Probe-seeded"],
  dials: { imagery: "medium", graphics: "medium", word_forward: "medium", lines: "sharp" },
  rec_defaults: { max_products: 4, oos_behavior: "show_with_badge", fallback_collection_id: "" },
  recommended_bucket_ids: [],
  question_count: 5,
};

const browser = await chromium.launch();
let ctx;
let quizId = null;
const graduated = new Set(); // pre-existing drafts we parked aside — restored in finally
try {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // ── 1 · Front door → a MANUAL decider draft at Recommendations ────────────
  for (let i = 0; i < 5 && !quizId; i++) {
    await page.goto(`${BASE}/studio/onboarding?key=${KEY}`, { waitUntil: "domcontentloaded" });
    const id = page.url().match(/onboarding\/([a-z0-9]+)/)?.[1] ?? null;
    if (!id) break;
    const d = await readDraft(id);
    const s = d?.session ?? {};
    if (
      d?.doc?.logic_model === "decider" &&
      (s.stage ?? "grouping") === "grouping" &&
      !s.goal_first &&
      !s.template_first?.picked &&
      s.built !== true
    ) {
      quizId = id;
      break;
    }
    // Park a non-manual/in-flight draft aside so the front door seeds fresh.
    graduated.add(id);
    await writeSession(id, (sess) => ({ ...sess, stage: "done", built: true }));
  }
  check("front door yields a manual decider draft at grouping", Boolean(quizId), quizId ?? "none");
  if (!quizId) throw new Error("no manual draft");
  if (!preExisting.has(quizId)) {
    await prisma.quiz.update({ where: { id: quizId }, data: { name: `flow2-probe-${Date.now()}` } });
  }
  const funnelUrl = `${BASE}/studio/onboarding/${quizId}`;

  // ── 2 · Pick a recommendation, Continue → the pop-up (manual flow keeps it) ─
  await page.waitForSelector(".qz-rb", { timeout: 20000 });
  const cont = page.locator(".qz-rb-rail-foot .qz-btn-accent").first();
  if (await cont.isDisabled()) {
    await page.locator('.qz-rb-card[aria-pressed="false"]').first().click();
    await page.waitForFunction(
      () => !document.querySelector(".qz-rb-rail-foot .qz-btn-accent")?.disabled,
      { timeout: 10000 },
    );
  }
  check(
    "manual Continue reads 'Continue →' (not the confirm label)",
    ((await cont.textContent()) ?? "").includes("Continue"),
    (await cont.textContent()) ?? "",
  );
  await cont.click();
  await page.waitForSelector(".qz-sm-title", { timeout: 8000 });
  check(
    "pop-up opens for the manual flow",
    (await page.locator(".qz-sm-title").textContent())?.trim() === "How do you want to start?",
  );
  const rowLabels = await page.locator(".qz-sm-row h3").allTextContents();
  check(
    "three rows, exact labels",
    JSON.stringify(rowLabels) ===
      JSON.stringify(["Generate with AI", "Write your goal", "Start from blank"]),
    JSON.stringify(rowLabels),
  );
  check(
    "no second screen anymore (goal brief retired from the modal)",
    (await page.locator(".qz-sm-track").count()) === 0 &&
      (await page.locator(".qz-sm-back").count()) === 0,
  );
  check(
    "Write-your-goal row is a LINK to /studio/goal",
    (await page.locator('a.qz-sm-row[href="/studio/goal"]').count()) === 1,
  );
  await page.screenshot({ path: `${DIR}/${MODE}-1-popup.png` });
  // Esc closes, side-effect-free.
  await page.keyboard.press("Escape");
  await sleep(400);
  let d = await readDraft(quizId);
  check(
    "Esc closes with nothing changed (still grouping)",
    (await page.locator(".qz-sm-title").count()) === 0 && d.session.stage === "grouping",
  );

  // ── 3 · Choice (b): Write your goal → the Flow-1 goal page ────────────────
  await cont.click();
  await page.waitForSelector(".qz-sm-title", { timeout: 8000 });
  await page.locator('a.qz-sm-row[href="/studio/goal"]').click();
  await page.waitForURL(/\/studio\/goal/, { timeout: 15000 });
  await page.waitForSelector(".qz-goal-page", { timeout: 20000 });
  check("write-goal routes into the Flow-1 goal page (reused, not duplicated)", true, page.url());
  await page.screenshot({ path: `${DIR}/${MODE}-2-goal-page.png`, fullPage: true });
  d = await readDraft(quizId);
  check("navigation alone leaves the draft untouched", d.session.stage === "grouping");

  // ── 4 · Choice (c): Start from blank → blank Questions ────────────────────
  await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-rb", { timeout: 20000 });
  await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().click();
  await page.waitForSelector(".qz-sm-title", { timeout: 8000 });
  await page.locator(".qz-sm-row", { hasText: "Start from blank" }).click();
  for (let i = 0; i < 20; i++) {
    d = await readDraft(quizId);
    if (d.session.stage === "question_builder") break;
    await sleep(800);
  }
  const resultNodes = (d.doc.nodes ?? []).filter((n) => n.type === "result");
  check(
    "blank → Questions (decider skeleton, built, no AI)",
    d.session.stage === "question_builder" &&
      d.session.built === true &&
      resultNodes.length === 1 &&
      d.session.gen_error == null,
    `stage=${d.session.stage}`,
  );
  check("blank route leaves no headless marker", d.session.ai_generate == null);
  await page.waitForTimeout(3500); // let the poll flip the client stage
  await page.screenshot({ path: `${DIR}/${MODE}-3-blank-questions.png`, fullPage: true });

  // ── 5 · Choice (a): Generate with AI → HEADLESS chain, never Shape ────────
  // Reset the draft to the recs step (fresh manual run).
  await writeSession(quizId, (s) => ({
    ...s,
    stage: "grouping",
    built: undefined,
    gen_error: undefined,
    ai_generate: undefined,
    quiz_types: [],
    picked_type_id: undefined,
    rich_templates: [],
    picked_template: undefined,
  }));
  await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-rb", { timeout: 20000 });
  await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().click();
  await page.waitForSelector(".qz-sm-title", { timeout: 8000 });
  await page.locator(".qz-sm-row.is-pri", { hasText: "Generate with AI" }).click();
  const seenStages = new Set();
  const seenProgress = new Set();
  let sawHeadlessMarker = false;
  let landed = false;
  for (let i = 0; i < (MODE === "happy" ? 280 : 80); i++) {
    d = await readDraft(quizId);
    seenStages.add(d.session.stage);
    if (d.session.gen_progress) seenProgress.add(d.session.gen_progress);
    if (d.session.ai_generate === true) sawHeadlessMarker = true;
    if (d.session.stage === "question_builder") {
      landed = true;
      break;
    }
    if (i === 4) await page.screenshot({ path: `${DIR}/${MODE}-4-ai-generating.png`, fullPage: true });
    await sleep(1500);
  }
  // The blank-key chain fails in <1s, so the transient "typing" stage can slip
  // between polls — the persisted ai_generate marker is the proof the headless
  // decider branch ran; happy mode additionally observes the stage itself.
  check("AI-generate kicked the headless chain (ai_generate marker persisted)", sawHeadlessMarker, [...seenStages].join("→"));
  if (MODE === "happy") {
    check("typing stage observed", seenStages.has("typing"), [...seenStages].join("→"));
  }
  check("never parked on Shape (stage 'types')", !seenStages.has("types"), [...seenStages].join("→"));
  check("scoring folded to direct at confirm", d.doc.scoring_model !== "weighted", `scoring=${d.doc.scoring_model ?? "(absent)"}`);
  if (MODE === "fail") {
    check(
      "blank-key failure lands the blank-Questions notice (never Shape)",
      landed && d.session.built === true && /blank/i.test(d.session.gen_error ?? ""),
      `stage=${d.session.stage} gen_error=${d.session.gen_error ?? "(none)"}`,
    );
    // The gen-error banner's escape must target /studio/templates now.
    await page.waitForSelector(".qz-banner, [class*=qz-banner]", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const tplLinks = await page.locator('a[href="/studio/templates"]', { hasText: "Start from a template" }).count();
    const newLinks = await page.locator('a[href="/studio/new"]').count();
    check("gen-error banner links /studio/templates (not /studio/new)", tplLinks >= 1 && newLinks === 0, `templates=${tplLinks} new=${newLinks}`);
    await page.screenshot({ path: `${DIR}/${MODE}-5-ai-failed-blank-questions.png`, fullPage: true });
  } else {
    check(
      "happy headless chain lands on Questions, built",
      landed && d.session.built === true && d.session.gen_error == null,
      `stage=${d.session.stage} gen_error=${d.session.gen_error ?? ""}`,
    );
    check("progressed through templating with checkpoints", seenStages.has("templating") && seenProgress.size >= 1, `stages=${[...seenStages].join("→")} progress=${[...seenProgress].join(",")}`);
    check(
      "headless auto-pick recorded (type + template)",
      d.session.picked_type_id != null && d.session.picked_template != null,
      `type=${d.session.picked_type_id}`,
    );
    const qNodes = (d.doc.nodes ?? []).filter((n) => n.type === "question");
    check("generated question nodes present", qNodes.length >= 3, `${qNodes.length} questions`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${DIR}/${MODE}-5-ai-questions-landing.png`, fullPage: true });
  }

  if (MODE === "fail") {
    // ── 6 · Stalled generating screen links /studio/templates ───────────────
    await writeSession(quizId, (s) => ({
      ...s,
      stage: "typing",
      built: undefined,
      gen_error: undefined,
      ai_generate: true,
    }));
    await prisma.quiz.update({
      where: { id: quizId },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-gen", { timeout: 20000 });
    check(
      "stalled screen renders Try again + the template escape",
      (await page.locator(".qz-gen-actions button", { hasText: "Try again" }).count()) === 1 &&
        (await page.locator('.qz-gen-actions a[href="/studio/templates"]').count()) === 1 &&
        (await page.locator('a[href="/studio/new"]').count()) === 0,
    );
    await page.screenshot({ path: `${DIR}/${MODE}-6-stalled-template-link.png`, fullPage: true });

    // ── 7 · Leak assert: a GOAL-FIRST draft never sees the pop-up ───────────
    await writeSession(quizId, (s) => ({
      ...s,
      stage: "grouping",
      built: undefined,
      gen_error: undefined,
      ai_generate: undefined,
      quiz_types: [],
      picked_type_id: undefined,
      rich_templates: [],
      picked_template: undefined,
      goal: {
        goal_text: "Help shoppers find the right snowboard setup for their terrain and skill",
        struggle_text: "",
      },
      goal_first: { prepick: "ready", rationale: "Probe-seeded goal-first state." },
    }));
    await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-rb", { timeout: 20000 });
    check(
      "goal-first recs shows the goal banner + confirm label",
      (await page.locator(".qz-gf-banner").count()) >= 1 &&
        ((await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().textContent()) ?? "").includes(
          "Generate my quiz",
        ),
    );
    await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().click();
    await sleep(1500);
    check(
      "goal-first NEVER sees the pop-up (flow1-confirm fires directly)",
      (await page.locator(".qz-sm-title").count()) === 0,
    );
    await page.screenshot({ path: `${DIR}/${MODE}-7-goalfirst-no-popup.png`, fullPage: true });
    // The blank-key headless chain fails to blank Questions ($0) — let it land
    // so the next seed starts from a settled draft.
    for (let i = 0; i < 40; i++) {
      d = await readDraft(quizId);
      if (d.session.stage === "question_builder") break;
      await sleep(1000);
    }

    // ── 8 · Leak assert: a TEMPLATE-FIRST draft never sees the pop-up ───────
    await writeSession(quizId, (s) => ({
      ...s,
      stage: "grouping",
      built: undefined,
      gen_error: undefined,
      ai_generate: undefined,
      goal_first: undefined,
      quiz_types: [],
      picked_type_id: undefined,
      rich_templates: [SYNTH_RICH],
      picked_template: undefined,
      template_first: { picked: "template" },
    }));
    await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-rb", { timeout: 20000 });
    check(
      "template-first recs shows the pick banner + confirm label",
      (await page.locator(".qz-rb-banner", { hasText: "Building from" }).count()) === 1 &&
        ((await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().textContent()) ?? "").includes(
          "Generate my quiz",
        ),
    );
    await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().click();
    await sleep(1500);
    check(
      "template-first NEVER sees the pop-up (flow3-confirm fires directly)",
      (await page.locator(".qz-sm-title").count()) === 0,
    );
    await page.screenshot({ path: `${DIR}/${MODE}-8-templatefirst-no-popup.png`, fullPage: true });
  }

  // ── AI spend report ────────────────────────────────────────────────────────
  const usageAfter = await prisma.aiUsage.findMany({
    select: { shopId: true, day: true, inputTokens: true, outputTokens: true, calls: true },
  });
  const beforeKey = new Map(usageBefore.map((u) => [`${u.shopId}:${u.day}`, u]));
  let dIn = 0,
    dOut = 0,
    dCalls = 0;
  for (const u of usageAfter) {
    const b = beforeKey.get(`${u.shopId}:${u.day}`);
    dIn += u.inputTokens - (b?.inputTokens ?? 0);
    dOut += u.outputTokens - (b?.outputTokens ?? 0);
    dCalls += u.calls - (b?.calls ?? 0);
  }
  results.push(
    `INFO [${MODE}] AiUsage delta: ${dCalls} calls, ${dIn} in / ${dOut} out tokens (~$${((dIn * 3 + dOut * 15) / 1e6).toFixed(4)})`,
  );
} catch (e) {
  results.push(`FAIL [${MODE}] probe crashed — ${mask(e?.stack ?? e?.message ?? String(e))}`);
} finally {
  // Fixture discipline: restore every pre-existing draft we touched (claimed
  // or parked aside) byte-for-byte; delete only a genuinely new probe draft.
  const touched = new Set([...graduated, ...(quizId ? [quizId] : [])]);
  for (const id of touched) {
    const prior = preExisting.get(id);
    if (prior) {
      await prisma.category.deleteMany({ where: { quizId: id } }).catch(() => {});
      await prisma.quiz
        .update({
          where: { id },
          data: { name: prior.name, draftJson: prior.draftJson, buildState: "step1" },
        })
        .catch(() => {});
      for (const c of preExistingCats.filter((c) => c.quizId === id)) {
        const { id: _drop, createdAt: _c, updatedAt: _u, ...data } = c;
        await prisma.category.create({ data }).catch(() => {});
      }
      results.push(`INFO [${MODE}] pre-existing draft ${id} restored`);
    } else {
      await prisma.category.deleteMany({ where: { quizId: id } }).catch(() => {});
      await prisma.quiz.delete({ where: { id } }).catch(() => {});
      results.push(`INFO [${MODE}] probe draft ${id} deleted`);
    }
  }
  await ctx?.close();
  await browser.close();
  await prisma.$disconnect();
  const fails = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(results.join("\n"));
  console.log(
    `\n${results.filter((r) => r.startsWith("PASS")).length} passed, ${fails} failed — shots in ${DIR}`,
  );
  process.exit(fails ? 1 : 0);
}
