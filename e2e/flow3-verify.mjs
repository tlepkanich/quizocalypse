// FLOW-3 probe — the "Generate Quiz Templates" template-first flow on the
// LOCAL prod build + LOCAL DB. Drives the REAL front-door UI (the
// /studio/templates page), then deletes its own probe draft (name-prefixed
// "flow3-probe-") in `finally`. Never touches existing fixtures beyond read.
// Requires the local DB seeded with the 8 PORT-10 starters
// (node scripts/seed-templates.mjs).
//
// Two modes (run each against its own server):
//   PROBE_MODE=fail  — server started WITH A BLANK ANTHROPIC KEY:
//       ANTHROPIC_API_KEY= SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x \
//         SHOPIFY_APP_URL=http://localhost:3000 PORT=3000 npm run start
//     Proves: the templates page + relocated 8-pill starter rail, candidate
//     generation FAILING with four-outcome copy + Retry, the STALLED backstop
//     (aged updatedAt → stalled banner), a starter pick entering the funnel
//     pre-marked (template_first.picked + industry payload), the recs surface's
//     flow-3 Continue (no start pop-up), the failed confirm landing on BLANK
//     Questions (never Shape), the 4-step rail, Shape's starter rail REMOVED,
//     and old-draft-at-"types" compatibility (renders, folds onto Questions).
//   PROBE_MODE=happy — server started WITH the real key (real AI spend,
//     HARD-CAPPED: at most 3 calls for the whole run — candidates → confirm's
//     templates → question build; web research is pre-warmed via the app's own
//     shop cache BEFORE the baseline, as any prior funnel visit would):
//     Proves: 2-3 generated-to-differ candidate cards → pick → recs
//     PRE-POPULATED (deterministic bucket suggestion) → confirm → templating
//     (types pass short-circuited) → Questions with generated question nodes.
//
// Run:  set -a; source .env; set +a; PROBE_MODE=fail node e2e/flow3-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const MODE = process.env.PROBE_MODE ?? "fail";
const DIR = process.env.SHOT_DIR ?? "/tmp/flow3-shots";
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

const usageDelta = (before, after) => {
  const beforeKey = new Map(before.map((u) => [`${u.shopId}:${u.day}`, u]));
  let dIn = 0, dOut = 0, dCalls = 0;
  for (const u of after) {
    const b = beforeKey.get(`${u.shopId}:${u.day}`);
    dIn += u.inputTokens - (b?.inputTokens ?? 0);
    dOut += u.outputTokens - (b?.outputTokens ?? 0);
    dCalls += u.calls - (b?.calls ?? 0);
  }
  return { dIn, dOut, dCalls };
};
const readUsage = () =>
  prisma.aiUsage.findMany({
    select: { shopId: true, day: true, inputTokens: true, outputTokens: true, calls: true },
  });

// The templates front door may legitimately CLAIM a pre-existing pristine
// draft (claimTemplateFirstDraft). Snapshot every step1 draft up front: a
// claimed pre-existing draft is RESTORED byte-for-byte in `finally`; only a
// genuinely new probe draft is deleted (the flow1-verify discipline).
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
let usageBefore = await readUsage();
try {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  if (MODE === "happy") {
    // ── 0h · Pre-warm the shop web-research cache via the app itself (the
    // funnel loader's own entry prefetch — exactly what any prior merchant
    // visit does). Excluded from the run's 3-call cap by re-baselining after.
    await page.goto(`${BASE}/studio/onboarding?key=${KEY}`, { waitUntil: "domcontentloaded" });
    let warmed = false;
    for (let i = 0; i < 80; i++) {
      const shops = await prisma.shop.findMany({ select: { webResearch: true } });
      warmed = shops.some((s) => {
        const r = s.webResearch;
        return r && typeof r === "object" && typeof r.text === "string" && r.text.length > 0;
      });
      if (warmed) break;
      await sleep(1500);
    }
    results.push(`INFO [${MODE}] research cache warmed: ${warmed}`);
    usageBefore = await readUsage();
  }

  // ── 1 · The templates front door (real UI) ─────────────────────────────────
  await page.goto(`${BASE}/studio/templates?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-tf-page", { timeout: 20000 });
  quizId = await page.locator(".qz-tf-page").getAttribute("data-quiz-id");
  check("templates page renders + carries its draft id", Boolean(quizId), `quiz ${quizId}`);
  // Cleanup discipline: our own probe draft, name-prefixed immediately.
  await prisma.quiz.update({ where: { id: quizId }, data: { name: `flow3-probe-${Date.now()}` } });

  let d = await readDraft(quizId);
  check(
    "draft is decider + template_first flow at grouping",
    d.doc.logic_model === "decider" &&
      d.session.stage === "grouping" &&
      d.session.template_first != null,
    `gen=${d.session.template_first?.gen}`,
  );

  // The relocated PORT-10 starter rail renders immediately, whatever the
  // candidate generation is doing.
  const starterPills = page.locator("[data-starter-rail] .qz-shape-savedpill");
  check("8 starter pills on the templates page", (await starterPills.count()) === 8,
    `${await starterPills.count()}`);
  const pillTexts = await starterPills.allTextContents();
  check(
    "starter pills are ✦-labeled with a vertical tag",
    pillTexts.every((t) => t.trim().startsWith("✦")) &&
      pillTexts.some((t) => t.includes("Gift finder") && t.includes("Gifting")),
    JSON.stringify(pillTexts.slice(0, 3)),
  );
  await page.screenshot({ path: `${DIR}/${MODE}-1-templates-page.png`, fullPage: true });

  if (MODE === "fail") {
    // ── 2f · Candidate generation fails (no AI key) → four-outcome copy ──────
    for (let i = 0; i < 40; i++) {
      d = await readDraft(quizId);
      if (d.session.template_first?.gen === "failed") break;
      await sleep(1500);
    }
    check("candidate gen lands FAILED without a key", d.session.template_first?.gen === "failed",
      `error=${d.session.template_first?.error}`);
    check(
      "failure copy is the four-outcome class (starter rail as the way forward, no raw error)",
      /ready-made template below/i.test(d.session.template_first?.error ?? "") &&
        !/api|anthropic|401|key/i.test(d.session.template_first?.error ?? ""),
    );
    await page.waitForSelector(".qz-tf-banner", { timeout: 20000 });
    check(
      "failed banner renders with Retry",
      (await page.locator(".qz-tf-banner button", { hasText: "Try again" }).count()) === 1,
    );
    await page.screenshot({ path: `${DIR}/${MODE}-2-gen-failed.png`, fullPage: true });

    // Retry re-kicks the job (fails honestly again) — the re-kick wiring E2E.
    // The no-key failure can flash picking→failed faster than a poll, so the
    // proof is the draft WRITE (updatedAt advanced) + the honest failed state.
    const beforeRetry = (
      await prisma.quiz.findUnique({ where: { id: quizId }, select: { updatedAt: true } })
    ).updatedAt.getTime();
    await page.locator(".qz-tf-banner button", { hasText: "Try again" }).click();
    let retryWrote = false;
    for (let i = 0; i < 30; i++) {
      const row = await prisma.quiz.findUnique({
        where: { id: quizId },
        select: { updatedAt: true, draftJson: true },
      });
      d = { doc: row.draftJson, session: row.draftJson?.build_session ?? {} };
      retryWrote = row.updatedAt.getTime() > beforeRetry;
      if (retryWrote && d.session.template_first?.gen === "failed") break;
      await sleep(1000);
    }
    check("retry re-kicked the generation (draft re-written → failed honestly again)",
      retryWrote && d.session.template_first?.gen === "failed",
      `gen=${d.session.template_first?.gen}`);

    // ── 3f · STALLED backstop: age the draft mid-"picking" ───────────────────
    d = await readDraft(quizId);
    await prisma.quiz.update({
      where: { id: quizId },
      data: {
        draftJson: {
          ...d.doc,
          build_session: { ...d.session, template_first: { gen: "picking" } },
        },
      },
    });
    // Age via the Prisma client — explicit updatedAt overrides @updatedAt on
    // the node clock (raw SQL is a tz/skew trap; see flow1-verify).
    await prisma.quiz.update({
      where: { id: quizId },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await page.goto(`${BASE}/studio/templates`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-tf-banner", { timeout: 20000 });
    check(
      "stalled generation shows the stall banner + Try again",
      (await page.locator(".qz-tf-banner", { hasText: "taking longer" }).count()) === 1 &&
        (await page.locator(".qz-tf-banner button", { hasText: "Try again" }).count()) === 1,
    );
    await page.screenshot({ path: `${DIR}/${MODE}-3-gen-stalled.png`, fullPage: true });

    // ── 4f · Starter pick → funnel entry pre-marked ──────────────────────────
    await page.locator("[data-starter-rail] .qz-shape-savedpill", { hasText: "Gift finder" }).click();
    await page.waitForURL(/\/studio\/onboarding\//, { timeout: 30000 });
    check("starter pick redirects into the funnel at the recs step",
      page.url().includes(`/studio/onboarding/${quizId}`));
    d = await readDraft(quizId);
    check(
      "template_first.picked = template, rich template stored with the industry payload",
      d.session.template_first?.picked === "template" &&
        d.session.rich_templates?.[0]?.id === "starter-gift-finder" &&
        d.session.rich_templates?.[0]?.industry?.category === "gifting",
      `picked=${d.session.template_first?.picked} rich=${d.session.rich_templates?.[0]?.id}`,
    );
    check(
      "recommended_bucket_ids neutralized for this draft",
      Array.isArray(d.session.rich_templates?.[0]?.recommended_bucket_ids) &&
        d.session.rich_templates[0].recommended_bucket_ids.length === 0,
    );

    // ── 5f · The recs surface in flow-3 mode + the 4-step rail ───────────────
    await page.waitForSelector(".qz-rb", { timeout: 20000 });
    check(
      "4-step rail, current = Recommendations (Shape pill gone)",
      (await page.locator(".qz-topbar-nav .qz-stepnav-pill").count()) === 4 &&
        ((await page.locator(".qz-topbar-nav .qz-stepnav-pill.is-current").textContent()) ?? "")
          .includes("Recommendations") &&
        !((await page.locator(".qz-topbar-nav").textContent()) ?? "").includes("Shape"),
    );
    check(
      "template banner names the pick",
      ((await page.locator(".qz-gf-banner").textContent()) ?? "").includes("Building from"),
    );
    const genBtn = page.locator(".qz-rb-rail-foot button", { hasText: "Generate my quiz" });
    check("flow-3 Continue reads 'Generate my quiz →'", (await genBtn.count()) === 1);
    await page.screenshot({ path: `${DIR}/${MODE}-4-recs-template-first.png`, fullPage: true });

    // A starter's scope is not derivable, so the pick ADDS nothing itself —
    // but a claimed pre-existing draft may carry its own prior selections.
    // Ensure ≥1 via the browser (an UNPRESSED card — the manual way forward).
    const railBefore = Number((await page.locator(".qz-rb-count").textContent())?.trim() ?? "0");
    if (railBefore === 0) {
      await page.locator('.qz-rb-card[aria-pressed="false"]').first().click();
      await sleep(1200);
    }
    const railCount = Number((await page.locator(".qz-rb-count").textContent())?.trim() ?? "0");
    check("the catalog browser is the way forward (≥1 selection)", railCount >= 1,
      `rail=${railCount}`);

    // ── 6f · Confirm (no pop-up) → failed chain lands BLANK Questions ────────
    await genBtn.click();
    check("no start pop-up rendered", (await page.locator(".qz-sm-rows").count()) === 0);
    const seenStages = new Set();
    for (let i = 0; i < 60; i++) {
      d = await readDraft(quizId);
      seenStages.add(d.session.stage);
      if (d.session.stage === "question_builder") break;
      await sleep(1500);
    }
    check(
      "failed confirm lands on Questions (never Shape)",
      d.session.stage === "question_builder" && d.session.built === true && !seenStages.has("types"),
      `stages=${[...seenStages].join("→")}`,
    );
    check("blank-questions notice persisted", /blank/i.test(d.session.gen_error ?? ""),
      d.session.gen_error ?? "(none)");
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${DIR}/${MODE}-5-blank-questions-landing.png`, fullPage: true });

    // ── 7f · Old-draft-at-shape compatibility: a draft parked at "types" must
    // render (no 500), fold onto Questions on the 4-step rail, and show NO
    // starter rail on Shape any more.
    d = await readDraft(quizId);
    await prisma.quiz.update({
      where: { id: quizId },
      data: {
        draftJson: {
          ...d.doc,
          build_session: {
            stage: "types",
            web_research_summary: "probe",
            quiz_types: [
              {
                id: "probe-type-a",
                experience_type: "product_match",
                name: "Probe Terrain Finder",
                achieves: "Match riders to the right board",
                question_range: { min: 4, max: 7 },
                best_practice_note: "",
                rationale: "probe",
                web_research_excerpt: "",
              },
              {
                id: "probe-type-b",
                experience_type: "personality",
                name: "Probe Rider Type",
                achieves: "Turn a personality read into a gear match",
                question_range: { min: 5, max: 7 },
                best_practice_note: "",
                rationale: "probe",
                web_research_excerpt: "",
              },
            ],
          },
        },
      },
    });
    const resp = await page.goto(`${BASE}/studio/onboarding/${quizId}`, {
      waitUntil: "domcontentloaded",
    });
    check("draft AT shape does not 500", resp.ok(), `${resp.status()}`);
    await page.waitForSelector(".qz-shape-page", { timeout: 20000 });
    check(
      "shape-parked draft folds onto the 4-step rail (Questions current)",
      (await page.locator(".qz-topbar-nav .qz-stepnav-pill").count()) === 4 &&
        ((await page.locator(".qz-topbar-nav .qz-stepnav-pill.is-current").textContent()) ?? "")
          .includes("Questions"),
    );
    await page.locator(".qz-shape-other summary").click();
    check(
      "Shape's starter rail is GONE (relocated); its other escapes remain",
      (await page.locator("[data-starter-rail]").count()) === 0 &&
        ((await page.locator(".qz-shape-other-body").textContent()) ?? "").includes(
          "Write your own goal",
        ),
    );
    await page.screenshot({ path: `${DIR}/${MODE}-6-shape-legacy-4rail.png`, fullPage: true });
  } else {
    // ── 2h · HAPPY: candidates land ready ────────────────────────────────────
    for (let i = 0; i < 80; i++) {
      d = await readDraft(quizId);
      if (d.session.template_first?.gen !== "picking") break;
      await sleep(1500);
    }
    check("candidate generation lands READY", d.session.template_first?.gen === "ready",
      `gen=${d.session.template_first?.gen} err=${d.session.template_first?.error ?? ""}`);
    const candidates = d.session.quiz_types ?? [];
    check("2-3 candidates generated", candidates.length >= 2 && candidates.length <= 3,
      candidates.map((t) => `${t.experience_type}:${t.name}`).join(" · "));
    check(
      "candidates are generated-to-differ (≥2 distinct experience types)",
      new Set(candidates.map((t) => t.experience_type)).size >= 2,
    );
    // The page polls itself; wait for the cards to paint.
    await page.waitForSelector(".qz-tf-card", { timeout: 20000 });
    check("candidate cards render", (await page.locator(".qz-tf-card").count()) === candidates.length);
    await page.screenshot({ path: `${DIR}/${MODE}-2-candidates.png`, fullPage: true });
    const afterGen = usageDelta(usageBefore, await readUsage());
    results.push(`INFO [${MODE}] candidate pass spend: ${afterGen.dCalls} call(s)`);

    // ── 3h · Pick the top candidate → recs PRE-POPULATED ─────────────────────
    await page.locator(".qz-tf-card .qz-tf-use").first().click();
    await page.waitForURL(/\/studio\/onboarding\//, { timeout: 30000 });
    d = await readDraft(quizId);
    check(
      "pick stored (picked_type_id + template_first.picked=candidate)",
      d.session.template_first?.picked === "candidate" &&
        d.session.picked_type_id === candidates[0].id,
      `type=${d.session.picked_type_id}`,
    );
    const cats = await prisma.category.findMany({
      where: { quizId },
      select: { name: true, source: true, productIds: true },
    });
    check(
      "recs pre-populated from the deterministic suggestion (≥1 bucket with members)",
      cats.length >= 1 && cats.every((c) => c.productIds.length > 0),
      cats.map((c) => `${c.source}:${c.name}(${c.productIds.length})`).join(", "),
    );
    await page.waitForSelector(".qz-rb", { timeout: 20000 });
    const railCount = (await page.locator(".qz-rb-count").textContent())?.trim();
    check("recs rail shows the pre-population", Number(railCount) === cats.length, `rail=${railCount}`);
    check(
      "template banner + flow-3 Continue present",
      ((await page.locator(".qz-gf-banner").textContent()) ?? "").includes("Building from") &&
        (await page.locator(".qz-rb-rail-foot button", { hasText: "Generate my quiz" }).count()) === 1,
    );
    await page.screenshot({ path: `${DIR}/${MODE}-3-prepopulated-recs.png`, fullPage: true });

    // ── 4h · Confirm → templating (types short-circuited) → Questions ────────
    await page.locator(".qz-rb-rail-foot button", { hasText: "Generate my quiz" }).click();
    const seenStages = new Set();
    const seenProgress = new Set();
    let landed = false;
    for (let i = 0; i < 280; i++) {
      d = await readDraft(quizId);
      seenStages.add(d.session.stage);
      if (d.session.gen_progress) seenProgress.add(d.session.gen_progress);
      if (d.session.stage === "question_builder") { landed = true; break; }
      if (i === 8) {
        await page.screenshot({ path: `${DIR}/${MODE}-4-generating.png`, fullPage: true });
      }
      await sleep(1500);
    }
    check("confirm goes straight to templating (types pass short-circuited)",
      seenStages.has("templating") && !seenStages.has("typing") && !seenStages.has("types"),
      [...seenStages].join("→"));
    check("gen_progress checkpoints observed", seenProgress.size >= 1, [...seenProgress].join(","));
    check("lands on the Questions step, built", landed && d.session.built === true,
      `stage=${d.session.stage}`);
    const qNodes = (d.doc.nodes ?? []).filter((n) => n.type === "question");
    check("generated question nodes present", qNodes.length >= 3, `${qNodes.length} questions`);
    check("no gen_error on the happy path", d.session.gen_error == null, d.session.gen_error ?? "");
    check(
      "auto-picked template recorded (retry-gen O-3 coverage)",
      d.session.picked_template != null && d.session.rich_templates?.length >= 1,
    );
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${DIR}/${MODE}-5-questions-landing.png`, fullPage: true });
  }

  // ── AI spend report (+ the happy-mode HARD cap) ────────────────────────────
  const delta = usageDelta(usageBefore, await readUsage());
  results.push(
    `INFO [${MODE}] AiUsage delta: ${delta.dCalls} calls, ${delta.dIn} in / ${delta.dOut} out tokens (~$${((delta.dIn * 3 + delta.dOut * 15) / 1e6).toFixed(4)} at the conservative rate)`,
  );
  if (MODE === "happy") {
    check("AT MOST 3 real AI calls for the whole happy run", delta.dCalls <= 3, `${delta.dCalls} calls`);
  }
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
        .update({
          where: { id: quizId },
          data: { name: prior.name, draftJson: prior.draftJson, buildState: "step1" },
        })
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
