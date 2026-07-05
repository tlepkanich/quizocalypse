// QL3-P5 live-verify — the FLIP + RETIRE probe (consolidates the retired
// e2e/l2-7-verify.mjs coverage: the decider integrity checks now live on the
// v3 health surface, driven end-to-end here).
//
// TWO databases (discovered in this run — the local .env DATABASE_URL is NOT
// the deploy's DB): the decider walk runs on the LOCAL prod build against the
// local fixture cmr7khgd50001vkhscvox8dgt (prisma seed/restore, the P2/P3/P4
// recipe); the legacy DOM-identical check seeds ONE identical legacy doc on
// BOTH sides — locally via prisma, on the LIVE deploy via the l2-7 HTTP
// recipe against its probe fixture cmqwd15f0001aqvl19onkpwm6 (set-buckets to
// create 2 probe categories whose ids/names are MIRRORED into local rows, the
// wholesale builder-route PUT to seed/restore draftJson INCLUDING stage).
//
// Asserts (the P5 checklist):
//  1. LEGACY DOM-IDENTICAL: the same legacy points doc (the strip pattern —
//     NO logic_model/role/target_id) renders the funnel question_builder
//     stage with an IDENTICAL normalized DOM snapshot on the LOCAL post-P5
//     build and the LIVE pre-P5 deploy. Also: Builder/Table tabs + inline
//     maps-to (.qz-ql-bucket) + skip (.qz-ql-skip) selects render.
//  2. FLIP: the decider doc renders the v3 Step3Shell WITHOUT any ?step3
//     param (.qz-s3 present, legacy .qz-ql-tabs absent) on the local build.
//  3. FULL WALK (the o3 pattern): rail gold decider chip → Content: type into
//     the title via the real EditableText → prisma persisted → Logic: flag-
//     move the decider to q1 → confirm → prisma role moved + old target_ids
//     ABSENT → map the new decider's answers via the amber Choose… selects
//     until healthy → pill green → "◆ Continue to Results" → prisma stage
//     rec_page.
//  4. No retired UI anywhere: "Test all paths" absent, .qz-ql-guard absent,
//     Rules tab absent.
//  5. Zero page errors (#418/#425/#423).
//  6. Legacy /q byte pin: live cmqqcb0ao004mqvkwjug7t0ya.json sha256 16-char
//     prefix === c02ccaec98a0fe9e.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const LIVE = process.env.LIVE ?? "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt"; // local fixture (P2/P3/P4 recipe)
const LIVE_QUIZ = "cmqwd15f0001aqvl19onkpwm6"; // live probe fixture (l2-7 recipe)
const PINNED_QUIZ = "cmqqcb0ao004mqvkwjug7t0ya";
const PINNED_SHA = "c02ccaec98a0fe9e";
const SHOTS = process.env.SHOTS ?? "/tmp/ql3p5-shots";
const BACKUP = `${SHOTS}/ql3p5-${QUIZ}-backup.json`;

const FUNNEL_DATA = (q) => `/studio/onboarding/${q}?_data=routes%2Fstudio_.onboarding_.%24quizId`;
const BUILDER_DATA = (q) => `/studio/${q}?_data=routes%2Fstudio_.%24id`;

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// ── local snapshot (the P1/P2/P3/P4 pattern) ────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
const originalDraftStr = JSON.stringify(quiz.draftJson);
writeFileSync(
  BACKUP,
  JSON.stringify({ draftJson: quiz.draftJson, categories: originalCats }, null, 2),
);
console.log(`local snapshot written: ${BACKUP} (stage=${quiz.draftJson?.build_session?.stage ?? "?"}, ${originalCats.length} quiz-scoped categories)`);

let seeded = false;
async function restoreLocal() {
  if (!seeded) return;
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  seeded = false;
  console.log("local fixture restored (doc + categories)");
}

const draft = async () => {
  const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  return row?.draftJson ?? null;
};
const stage = async () => (await draft())?.build_session?.stage ?? "?";
const draftNode = async (id) => (await draft())?.nodes?.find((n) => n.id === id) ?? null;

// Normalize the stage's DOM for the local-vs-live diff: strip React useId
// tokens, hashed asset paths, and nonces — everything else must match byte-
// for-byte (identical doc + category ids/names on both sides; only the CODE
// differs across the two builds).
const normalize = (html) =>
  html
    .replaceAll(/:r[0-9a-z]+:/gi, ":rid:")
    .replaceAll(/\/assets\/[\w./-]+/g, "/assets/X")
    .replaceAll(/\snonce="[^"]*"/g, "");

// ── live fixture state (HTTP; snapshot + restore via the builder PUT) ───────
let liveCtx = null; // set once the live browser context is authed
let liveSeeded = false;
let liveOriginalRaw = null;
const liveGet = async (path) => (await liveCtx.request.get(`${LIVE}${path}`)).json();
const livePost = async (form) =>
  (await liveCtx.request.post(`${LIVE}${FUNNEL_DATA(LIVE_QUIZ)}`, { form })).json();
const livePutDoc = async (doc) =>
  (await liveCtx.request.put(`${LIVE}${BUILDER_DATA(LIVE_QUIZ)}`, {
    headers: { "content-type": "application/json" },
    data: { doc },
  })).json();
async function restoreLive() {
  if (!liveSeeded || !liveOriginalRaw) return;
  // Order matters: drop the probe categories FIRST (set-buckets writes
  // bucket_browser into build_session), THEN the wholesale doc restore.
  await livePost({ intent: "set-buckets", type: "product", keys: "" });
  await livePutDoc(liveOriginalRaw);
  liveSeeded = false;
  const after = await liveGet(BUILDER_DATA(LIVE_QUIZ));
  const identical = JSON.stringify(after.rawJson) === JSON.stringify(liveOriginalRaw);
  ok("LIVE fixture restored byte-identically (rawJson incl. stage)", identical);
  const funnelAfter = await liveGet(FUNNEL_DATA(LIVE_QUIZ));
  ok("LIVE probe categories removed (back to zero)",
    funnelAfter.stage === liveOriginalRaw?.build_session?.stage &&
      (funnelAfter.questionBuilder?.categories ?? []).length === 0,
    `stage=${funnelAfter.stage}`);
}

let browser = null;
try {
  browser = await chromium.launch();
  const openStage = async (ctx, origin, url, selector) => {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => out.pageErrors.push(`${origin}: ${String(e).slice(0, 300)}`));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(selector, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1800); // ClientOnly mount + observer settle
    return page;
  };

  const ctxLocal = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  liveCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const authLocal = await ctxLocal.newPage();
  await authLocal.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await authLocal.close();
  const authLive = await liveCtx.newPage();
  await authLive.goto(`${LIVE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await authLive.close();

  // ═══ 1a ── seed the live side: stage → question_builder, 2 probe buckets ══
  const liveBefore = await liveGet(BUILDER_DATA(LIVE_QUIZ));
  liveOriginalRaw = liveBefore.rawJson;
  ok("LIVE fixture snapshot taken (rawJson)", Boolean(liveOriginalRaw),
    `stage=${liveOriginalRaw?.build_session?.stage ?? "?"}`);
  const liveFunnelBefore = await liveGet(FUNNEL_DATA(LIVE_QUIZ));
  ok("LIVE fixture has zero quiz-scoped categories (clean baseline)",
    (liveFunnelBefore.questionBuilder?.categories ?? []).length === 0);

  liveSeeded = true;
  await livePost({ intent: "to-question-builder" });
  const liveMid = await liveGet(FUNNEL_DATA(LIVE_QUIZ));
  ok("LIVE stage moved to question_builder", liveMid.stage === "question_builder", liveMid.stage);
  const liveProducts = (liveMid.questionBuilder?.productIndex ?? []).slice(0, 2);
  ok("LIVE productIndex exposes ≥2 products", liveProducts.length === 2);
  await livePost({
    intent: "set-buckets",
    type: "product",
    keys: liveProducts.map((p) => p.product_id).join(","),
  });
  const liveCats = (await liveGet(FUNNEL_DATA(LIVE_QUIZ))).questionBuilder?.categories ?? [];
  ok("LIVE set-buckets created 2 probe categories", liveCats.length === 2,
    liveCats.map((c) => c.name).join(" · "));
  const [catA, catB] = liveCats;

  // ═══ 1b ── the shared legacy probe doc (the strip pattern) ════════════════
  const legacyAnswer = ([id, text, bucket]) => ({
    id, text, tags: [], edge_handle_id: `h_${id}`, ...(bucket ? { points: { [bucket]: 1 } } : {}),
  });
  const legacyDocFor = (quizId) => ({
    quiz_id: quizId,
    status: "draft",
    scope: { collection_ids: [] },
    design_tokens: {
      colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" },
      radius: "rounded",
    },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "QL3P5 Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "How do you like to ride?", question_type: "single_select", required: true,
          answers: [["a_groom", "Groomed runs", catA.id], ["a_powder", "Powder days", catA.id], ["a_park", "Park laps"]].map(legacyAnswer) } },
      { id: "q2", type: "question", position: { x: 0, y: 240 },
        data: { text: "What are you shopping for today?", question_type: "single_select", required: true,
          answers: [["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]].map(legacyAnswer) } },
      { id: "q3", type: "question", position: { x: 0, y: 360 },
        data: { text: "Which extras matter most to you?", question_type: "single_select", required: true,
          answers: [["x1", "Warm gloves", catB.id], ["x2", "Goggles"], ["x3", "A stomp pad"]].map(legacyAnswer) } },
      { id: "r1", type: "result", position: { x: 0, y: 480 },
        data: { headline: "Your match", fallback_collection_id: "manual" } },
    ],
    edges: [
      { id: "e1", source: "intro1", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "q3" },
      { id: "e4", source: "q3", target: "r1" },
    ],
    results_pages: [],
    rec_page_settings: { global: {}, overrides: {} },
    decision_rules: [],
    build_session: { stage: "question_builder", built: true },
  });

  const livePut = await livePutDoc(legacyDocFor(LIVE_QUIZ));
  ok("LIVE legacy probe doc PUT accepted", livePut.ok === true, livePut.error ?? "");

  // Local mirror: SAME category ids/names (different DB → no PK conflict),
  // createdAt staggered so the loader's createdAt-asc order matches live.
  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId }, select: { productId: true }, take: 4,
  });
  const baseTime = Date.now() - 60000;
  for (let i = 0; i < liveCats.length; i++) {
    await prisma.category.create({
      data: {
        id: liveCats[i].id, shopId: quiz.shopId, quizId: QUIZ, name: liveCats[i].name,
        description: "", tags: [], productIds: products.slice(i * 2, i * 2 + 2).map((p) => p.productId),
        source: "manual", discoveryRunId: "ql3p5_probe", createdAt: new Date(baseTime + i * 1000),
      },
    });
  }
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: legacyDocFor(QUIZ) } });
  console.log(`seeded the SAME legacy doc on both sides (buckets ${catA.id} / ${catB.id})`);

  // ═══ 1c ── render both, normalized DOM diff ═══════════════════════════════
  const pLocal = await openStage(ctxLocal, BASE, `${BASE}/studio/onboarding/${QUIZ}`, ".qz-ql");
  const pLive = await openStage(liveCtx, LIVE, `${LIVE}/studio/onboarding/${LIVE_QUIZ}`, ".qz-ql");
  ok("LOCAL: legacy layout mounts (.qz-ql)", (await pLocal.locator(".qz-ql").count()) === 1);
  ok("LIVE: legacy layout mounts (.qz-ql)", (await pLive.locator(".qz-ql").count()) === 1);

  const grab = (p) => p.locator(".qz-ql").evaluate((el) => el.outerHTML);
  const domLocal = normalize(await grab(pLocal));
  const domLive = normalize(await grab(pLive));
  writeFileSync(`${SHOTS}/legacy-dom-local.html`, domLocal);
  writeFileSync(`${SHOTS}/legacy-dom-live.html`, domLive);
  ok("legacy stage DOM IDENTICAL local vs live (normalized)", domLocal === domLive,
    domLocal === domLive ? `${domLocal.length} bytes` : `local=${domLocal.length}b live=${domLive.length}b — diff ${SHOTS}/legacy-dom-*.html`);

  ok("legacy tabs: Builder/Table/Flow render",
    (await pLocal.locator(".qz-ql-tabs button", { hasText: "Builder" }).count()) === 1 &&
      (await pLocal.locator(".qz-ql-tabs button", { hasText: "Table" }).count()) === 1 &&
      (await pLocal.locator(".qz-ql-tabs button", { hasText: "Flow" }).count()) === 1);
  ok("legacy inline maps-to selects render (.qz-ql-bucket ×8)",
    (await pLocal.locator("select.qz-ql-bucket").count()) === 8,
    `${await pLocal.locator("select.qz-ql-bucket").count()}`);
  ok("legacy inline skip selects render (.qz-ql-skip ×8)",
    (await pLocal.locator("select.qz-ql-skip").count()) === 8,
    `${await pLocal.locator("select.qz-ql-skip").count()}`);
  await pLocal.screenshot({ path: `${SHOTS}/1-legacy-local.png` });
  await pLive.screenshot({ path: `${SHOTS}/1-legacy-live.png` });
  await pLive.close();
  await pLocal.close();

  // Live side is done — restore it NOW so its mutation window stays minimal.
  await restoreLive();

  // ═══ 2 ── FLIP: decider doc → Step3Shell with NO ?step3 param (LOCAL) ═════
  const legacyLocal = legacyDocFor(QUIZ);
  const deciderDoc = {
    ...legacyLocal,
    logic_model: "decider",
    nodes: legacyLocal.nodes.map((n) => {
      if (n.type !== "question") return n;
      const role = n.id === "q2" ? "decides" : "qualifier";
      const answers = n.data.answers.map((a) => {
        const { points, ...rest } = a;
        if (n.id !== "q2") return rest;
        return { ...rest, target_id: a.id === "a_board" ? catA.id : catB.id };
      });
      return { ...n, data: { ...n.data, role, answers } };
    }),
  };
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: deciderDoc } });
  console.log("seeded HEALTHY decider doc (q2 decides, fully mapped)");

  const page = await openStage(ctxLocal, BASE, `${BASE}/studio/onboarding/${QUIZ}`, ".qz-s3");
  ok("FLIP: v3 Step3Shell mounts WITHOUT ?step3 (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);
  ok("FLIP: legacy tab strip absent (.qz-ql-tabs)", (await page.locator(".qz-ql-tabs").count()) === 0);
  ok("FLIP: legacy layout root absent (.qz-ql)", (await page.locator(".qz-ql").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/2-flip-noparam.png` });

  // ═══ 4 ── no retired UI anywhere on the decider doc ═══════════════════════
  ok("retired: 'Test all paths' button absent",
    (await page.locator("button", { hasText: "Test all paths" }).count()) === 0);
  ok("retired: Rules tab absent",
    (await page.locator("button", { hasText: /^Rules$/ }).count()) === 0);
  ok("retired: legacy ContinueGuard absent (.qz-ql-guard)", (await page.locator(".qz-ql-guard").count()) === 0);

  // ═══ 3 ── FULL WALK (the o3 pattern) ══════════════════════════════════════
  ok("rail renders 3 question rows", (await page.locator(".qz-s3-row:not(.is-terminus)").count()) === 3);
  ok("rail: exactly one gold decider chip (.qz-s3-numchip.is-decider)",
    (await page.locator(".qz-s3-numchip.is-decider").count()) === 1);

  // Content view: type into the title via the real EditableText → prisma
  const titleEd = page.locator(".qz-s3-qtitle .qz-s3-editable");
  await titleEd.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Renamed by the P5 probe", { delay: 25 });
  await page.waitForTimeout(1600); // the 700ms useQuizDraft debounce + PUT
  ok("Content edit persisted (prisma q1.data.text)",
    (await draftNode("q1"))?.data?.text === "Renamed by the P5 probe");
  await page.screenshot({ path: `${SHOTS}/3-title-typed.png` });

  // Logic view: flag-move the decider q2 → q1, confirm, prisma-verify
  await page.locator(".qz-s3-viewtoggle button", { hasText: "Logic" }).click();
  await page.waitForTimeout(500);
  const sec = (id) => page.locator(`.qz-s3-sec[data-node-id="${id}"]`);
  await sec("q1").locator(".qz-s3-flag.is-ghost").click();
  const modal = page.locator(".qz-modal");
  ok("flag-move confirm dialog opens",
    await page.locator(".qz-modal-title", { hasText: "Make this the deciding question" }).isVisible());
  await modal.locator("button", { hasText: "Make it the decider" }).click();
  await page.waitForTimeout(1600);
  const q1After = await draftNode("q1");
  const q2After = await draftNode("q2");
  ok("prisma: role moved (q1 decides, q2 qualifier)",
    q1After?.data?.role === "decides" && q2After?.data?.role === "qualifier");
  ok("prisma: old decider's target_ids ABSENT (keys stripped, not null)",
    (q2After?.data?.answers ?? []).every((a) => !("target_id" in a)));
  ok("gold flag repainted onto q1",
    (await sec("q1").locator(".qz-s3-flag.is-decider").count()) === 1 &&
      (await sec("q2").locator(".qz-s3-flag.is-ghost").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/4-flag-moved.png` });

  // map the new decider's answers via the amber Choose… selects until healthy
  const unset = sec("q1").locator("select.qz-s3-target.is-unset");
  ok("new decider shows 3 amber Choose… selects", (await unset.count()) === 3, `${await unset.count()}`);
  ok("pill is red while unmapped (.is-bad)", (await page.locator(".qz-s3-healthpill.is-bad").count()) === 1);
  await unset.first().selectOption(catA.id);
  await page.waitForTimeout(400);
  await unset.first().selectOption(catB.id);
  await page.waitForTimeout(400);
  await unset.first().selectOption(catA.id);
  await page.waitForTimeout(1600);
  ok("all 3 mappings persisted (prisma q1 target_ids)",
    ((await draftNode("q1"))?.data?.answers ?? []).every((a) => a.target_id === catA.id || a.target_id === catB.id));
  ok("pill green (.is-ok, 'Logic valid')",
    (await page.locator(".qz-s3-healthpill.is-ok").count()) === 1 &&
      ((await page.locator(".qz-s3-healthpill").textContent()) ?? "").trim() === "Logic valid");
  await page.screenshot({ path: `${SHOTS}/5-mapped-green.png` });

  // "◆ Continue to Results" → prisma stage rec_page
  const continueBtn = page.locator(".qz-s3-continue");
  ok("Continue reads '◆ Continue to Results'",
    ((await continueBtn.textContent()) ?? "").trim() === "◆ Continue to Results");
  await continueBtn.click();
  let advanced = false;
  for (let i = 0; i < 20 && !advanced; i++) {
    await page.waitForTimeout(500);
    advanced = (await stage()) === "rec_page";
  }
  ok("Continue advances build_session.stage → rec_page", advanced, await stage());
  ok("retired ContinueGuard never appeared", (await page.locator(".qz-ql-guard").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/6-advanced-recpage.png` });

  // ═══ 5 ── zero page errors ════════════════════════════════════════════════
  ok("zero page errors (incl. #418/#425/#423)", out.pageErrors.length === 0, out.pageErrors.join(" | "));

  // ═══ 6 ── legacy /q byte pin on the LIVE deploy ═══════════════════════════
  const pinned = await fetch(`${LIVE}/q/${PINNED_QUIZ}.json`);
  const sha = createHash("sha256").update(Buffer.from(await pinned.arrayBuffer())).digest("hex").slice(0, 16);
  ok(`legacy /q byte pin holds (${PINNED_SHA})`, sha === PINNED_SHA, sha);
} finally {
  try {
    await restoreLive();
  } catch (e) {
    ok("LIVE fixture restored byte-identically (rawJson incl. stage)", false, String(e).slice(0, 200));
  }
  await restoreLocal();
  const after = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  ok("LOCAL restore is byte-identical (draftJson incl. stage)",
    JSON.stringify(after?.draftJson) === originalDraftStr);
  const catsAfter = await prisma.category.findMany({ where: { quizId: QUIZ } });
  ok("LOCAL categories restored (count + ids match)",
    catsAfter.length === originalCats.length &&
      JSON.stringify(catsAfter.map((c) => c.id).sort()) === JSON.stringify(originalCats.map((c) => c.id).sort()));
  if (browser) await browser.close();
  await prisma.$disconnect();
}

const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
