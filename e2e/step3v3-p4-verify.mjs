// QL3-P4 live-verify — health pill + popover + the tri-state Continue on the
// Step-3 v3 shell (?step3=v3, decider docs) against a LOCAL production build
// (BASE env).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt — seed/restore copied verbatim from
// e2e/step3v3-p2/p3-verify.mjs (snapshot draftJson + quiz-scoped Category
// rows, seed 2 probe buckets + a minimal HEALTHY decider doc at
// question_builder, restore byte-for-byte INCLUDING build_session.stage).
//
// Asserts (the P4 checklist):
//  1. healthy doc → green pill ("Logic valid"); Logic-view Continue reads
//     "◆ Continue to Results" and is enabled
//  2. unmap a decider answer via the Maps-to UI → pill flips red with the
//     blocking count; Continue reads "Fix 1 issue to continue"; clicking it
//     OPENS the health popover (stage does NOT advance) and the popover
//     lists the V4 finding
//  3. the finding's jump-link → decider section scrolls in + the warn-wash
//     flash class (.is-flashwarn) is applied
//  4. fix the mapping through the UI → pill returns green, Continue
//     re-enables → clicking "◆ Continue to Results" advances
//     build_session.stage to rec_page (prisma)
//  5. Content view → Continue reads "◆ Continue to Logic" and switches the
//     view only (prisma draft byte-unchanged)
//  6. Tier-2: the ✦ run button yields advisory rows OR a graceful error row
//     (either passes); the Continue state is unaffected in both paths
//  7. the legacy decider ContinueGuard dialog (.qz-ql-guard) never appears
//  8. zero page errors
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/ql3p4-shots";
const BACKUP = `${SHOTS}/ql3p4-${QUIZ}-backup.json`;

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

// ── snapshot (the P1/P2/P3 pattern) ─────────────────────────────────────────
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
console.log(`snapshot written: ${BACKUP} (stage=${quiz.draftJson?.build_session?.stage ?? "?"}, ${originalCats.length} quiz-scoped categories)`);

let seeded = false;
async function restore() {
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
  console.log("fixture restored (doc + categories)");
}

const draft = async () => {
  const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  return row?.draftJson ?? null;
};
const stage = async () => (await draft())?.build_session?.stage ?? "?";

try {
  // ── seed: 2 probe buckets + a minimal HEALTHY decider doc ─────────────────
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId },
    select: { productId: true },
    take: 6,
  });
  ok("catalog has ≥6 products for probe buckets", products.length >= 6, `${products.length}`);
  const collection = await prisma.collection.findFirst({
    where: { shopId: quiz.shopId },
    select: { collectionId: true },
  });
  const fallbackCol = collection?.collectionId ?? "manual";

  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P4 Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p4_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P4 Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p4_probe",
    },
  });

  const answers = (defs) =>
    defs.map(([id, text, target]) => ({
      id, text, tags: [], edge_handle_id: `h_${id}`, ...(target ? { target_id: target } : {}),
    }));
  // HEALTHY: decider q2 fully mapped, no rules → verdict 0 blocking / 0 warnings.
  const probeDoc = {
    quiz_id: QUIZ,
    status: "draft",
    scope: { collection_ids: [] },
    logic_model: "decider",
    design_tokens: {
      colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" },
      radius: "rounded",
    },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "QL3P4 Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "How do you like to ride?", question_type: "single_select", required: true, role: "qualifier",
          answers: answers([["a_groom", "Groomed runs"], ["a_powder", "Powder days"], ["a_park", "Park laps"]]) } },
      { id: "q2", type: "question", position: { x: 0, y: 240 },
        data: { text: "What are you shopping for today?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "q3", type: "question", position: { x: 0, y: 360 },
        data: { text: "Which extras matter most to you?", question_type: "single_select", required: true, role: "qualifier",
          answers: answers([["x1", "Warm gloves"], ["x2", "Goggles"], ["x3", "A stomp pad"]]) } },
      { id: "r1", type: "result", position: { x: 0, y: 480 },
        data: { headline: "Your match", fallback_collection_id: fallbackCol } },
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
  };
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: probeDoc } });
  console.log(`seeded HEALTHY probe doc (decider q2 → ${catA.id} / ${catB.id}, no rules)`);
  const seededDraftStr = JSON.stringify(await draft());

  // ── drive the shell ────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 300)));

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}?step3=v3`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  ok("Step3Shell mounts (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);

  const continueBtn = page.locator(".qz-s3-continue");
  const pill = page.locator(".qz-s3-healthpill");
  const guardCount = async () => page.locator(".qz-ql-guard").count();

  // 5 ── Content view: "◆ Continue to Logic" switches the view only
  ok("Content view: Continue reads '◆ Continue to Logic'",
    ((await continueBtn.textContent()) ?? "").trim() === "◆ Continue to Logic");
  await continueBtn.click();
  await page.waitForTimeout(400);
  ok("click → Logic view mounts (.qz-s3-logic)", (await page.locator(".qz-s3-logic").count()) === 1);
  await page.waitForTimeout(1600); // any (buggy) server write would autosave by now
  ok("view switch is a NO-WRITE (prisma draft byte-unchanged)",
    JSON.stringify(await draft()) === seededDraftStr);

  // 1 ── healthy: green pill + enabled "◆ Continue to Results"
  ok("healthy pill is green (.is-ok)", (await page.locator(".qz-s3-healthpill.is-ok").count()) === 1);
  ok("healthy pill copy = 'Logic valid'", ((await pill.textContent()) ?? "").trim() === "Logic valid");
  ok("Logic view: Continue reads '◆ Continue to Results'",
    ((await continueBtn.textContent()) ?? "").trim() === "◆ Continue to Results");
  ok("healthy Continue is enabled (no .is-blocked, not disabled)",
    !(await continueBtn.isDisabled()) && (await page.locator(".qz-s3-continue.is-blocked").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/1-healthy-green.png` });

  // 2 ── unmap a decider answer via the Maps-to UI → red pill + "Fix 1 issue"
  const q2 = page.locator('.qz-s3-sec[data-node-id="q2"]');
  await q2.scrollIntoViewIfNeeded();
  await q2.locator("select.qz-s3-target").first().selectOption("");
  await page.waitForTimeout(1600);
  ok("unmap persisted (q2 answers[0] has no target_id)",
    !("target_id" in ((await draft())?.nodes?.find((n) => n.id === "q2")?.data?.answers?.[0] ?? {})));
  ok("pill flips red (.is-bad)", (await page.locator(".qz-s3-healthpill.is-bad").count()) === 1);
  ok("pill copy = '1 blocking'", ((await pill.textContent()) ?? "").trim() === "1 blocking");
  ok("Continue reads 'Fix 1 issue to continue'",
    ((await continueBtn.textContent()) ?? "").trim() === "Fix 1 issue to continue");
  await page.screenshot({ path: `${SHOTS}/2-blocked-red.png` });

  // 2b ── blocked Continue OPENS the popover; the stage does NOT advance
  const stageBefore = await stage();
  await continueBtn.click();
  await page.waitForSelector(".qz-popover .qz-s3-health", { timeout: 3000 });
  ok("blocked Continue opens the health popover", true);
  const popText = (await page.locator(".qz-s3-health").textContent()) ?? "";
  ok("popover lists the V4 finding", /doesn't point at a result yet/.test(popText));
  ok("popover verdict line agrees ('1 blocking')", /1 blocking/.test(popText));
  await page.waitForTimeout(1200);
  ok("no advance happened (stage unchanged)", (await stage()) === stageBefore, await stage());
  ok("legacy ContinueGuard did NOT appear", (await guardCount()) === 0);
  await page.screenshot({ path: `${SHOTS}/3-popover-open.png` });

  // 3 ── jump-link → decider section scrolls in + warn-wash flash
  const v4Check = page.locator(".qz-ql-check", { hasText: "Every deciding answer has a result" });
  await v4Check.locator(".qz-ql-report-goto").first().click();
  await page.waitForSelector('.qz-s3-sec[data-node-id="q2"].is-flashwarn', { timeout: 2000 });
  ok("jump-link applies the warn-wash flash (.is-flashwarn on q2)", true);
  ok("popover closed on navigate", (await page.locator(".qz-s3-health").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/4-jump-flashwarn.png` });
  await page.waitForTimeout(700);
  const q2Top = await q2.evaluate((el) => el.getBoundingClientRect().top);
  ok("decider section scrolled into view", q2Top > -40 && q2Top < 900, `top=${Math.round(q2Top)}`);

  // 4a ── fix the mapping through the UI → pill green + Continue re-enabled
  await q2.locator("select.qz-s3-target.is-unset").selectOption(catA.id);
  await page.waitForTimeout(1600);
  ok("fix persisted (q2 answers[0].target_id back)",
    (await draft())?.nodes?.find((n) => n.id === "q2")?.data?.answers?.[0]?.target_id === catA.id);
  ok("pill returns green", (await page.locator(".qz-s3-healthpill.is-ok").count()) === 1);
  ok("Continue re-enables ('◆ Continue to Results')",
    ((await continueBtn.textContent()) ?? "").trim() === "◆ Continue to Results" &&
      (await page.locator(".qz-s3-continue.is-blocked").count()) === 0);

  // 6 ── ✦ Tier-2 advisory (either path passes; never touches the gate)
  await pill.click();
  await page.waitForSelector(".qz-popover .qz-s3-health", { timeout: 3000 });
  await page.locator(".qz-s3-health button", { hasText: "Run AI quality review" }).click();
  let tier2Path = "none";
  try {
    await page.waitForSelector(".qz-s3-airow, .qz-s3-health-aierr", { timeout: 90000 });
    tier2Path = (await page.locator(".qz-s3-airow").count()) > 0 ? "rows" : "error";
  } catch { /* neither appeared */ }
  ok("Tier-2 resolves to advisory rows OR a graceful error row", tier2Path !== "none", tier2Path);
  if (tier2Path === "rows") {
    const rows = await page.locator(".qz-s3-airow").count();
    console.log(`  tier-2 advisory rows: ${rows}`);
  } else if (tier2Path === "error") {
    console.log(`  tier-2 error row: ${((await page.locator(".qz-s3-health-aierr").textContent()) ?? "").trim()}`);
  }
  ok("Tier-2 outcome does NOT touch the Continue gate",
    ((await continueBtn.textContent()) ?? "").trim() === "◆ Continue to Results" &&
      (await page.locator(".qz-s3-continue.is-blocked").count()) === 0 &&
      (await page.locator(".qz-s3-healthpill.is-ok").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/5-tier2.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 4b ── the real advance: "◆ Continue to Results" → stage rec_page (prisma)
  await continueBtn.click();
  let advanced = false;
  for (let i = 0; i < 20 && !advanced; i++) {
    await page.waitForTimeout(500);
    advanced = (await stage()) === "rec_page";
  }
  ok("Continue advances build_session.stage → rec_page", advanced, await stage());
  ok("legacy ContinueGuard never appeared (post-advance)", (await guardCount()) === 0);
  await page.screenshot({ path: `${SHOTS}/6-advanced-recpage.png` });

  // 8 ── zero page errors
  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
  await browser.close();
} finally {
  await restore();
  // Post-restore byte check: the draft (incl. build_session.stage) must equal
  // the pre-probe snapshot exactly.
  const after = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  const identical = JSON.stringify(after?.draftJson) === originalDraftStr;
  ok("restore is byte-identical (draftJson incl. stage)", identical);
  const catsAfter = await prisma.category.findMany({ where: { quizId: QUIZ } });
  ok("categories restored (count + ids match)",
    catsAfter.length === originalCats.length &&
      JSON.stringify(catsAfter.map((c) => c.id).sort()) === JSON.stringify(originalCats.map((c) => c.id).sort()));
  await prisma.$disconnect();
}

const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
