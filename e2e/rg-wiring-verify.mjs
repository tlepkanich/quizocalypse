// rg-wiring live-verify (2026-08-18) — the guided Results settings reach the
// published shopper page. Against a LOCAL prod build (BASE, default :3000):
//
// 1. Seed the local fixture with a minimal decider doc whose
//    rec_page_settings.global carries EXPLICIT values for every newly wired
//    field, publish via the real publish intent, and walk /q:
//    capture CTA + skip link + marketing-consent row + policy links →
//    stepped loading with the merchant's steps → reveal with perRow columns,
//    the Verified marker, a desc override, and the extras shelf.
// 2. POST the capture with consent ticked → the EmailCapture row stores
//    marketingConsent true.
// 3. NEGATIVE CONTROL — republish the same doc with an EMPTY global: the
//    capture is mandatory again (no skip, no consent, "Continue" CTA), the
//    legacy two-beat loading plays, no extras shelf. Absent = legacy.
// 4. Restore draftJson/publishedJson/status + categories byte-for-byte and
//    delete the probe's capture rows.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/rgw-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = Boolean(v);
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${String(extra).replaceAll(KEY, "***")}` : ""}`);
};

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) { console.error("fixture not found"); process.exit(1); }
const snap = { draftJson: quiz.draftJson, publishedJson: quiz.publishedJson, status: quiz.status, version: quiz.version };
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(`${SHOTS}/rgw-backup.json`, JSON.stringify({ ...snap, categories: originalCats }));
console.log(`snapshot written (${originalCats.length} categories)`);

let browser = null;
let seeded = false;
try {
  // ── seed (the q3 probe's shape + the wired global) ────────────────────────
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId }, select: { productId: true }, take: 8,
  });
  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGW Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId), source: "manual", discoveryRunId: "rgw_probe" },
  });
  const catB = await prisma.category.create({
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGW Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId), source: "manual", discoveryRunId: "rgw_probe" },
  });
  const overriddenPid = products[0]?.productId;
  const answers = (defs) => defs.map(([id, text, target]) => ({
    id, text, tags: [], edge_handle_id: `h_${id}`, ...(target ? { target_id: target } : {}),
  }));
  const WIRED_GLOBAL = {
    loadingOn: true, loadingMs: 1500, loadingNamed: true,
    loadingSteps: ["Reading the probe answers", "Assembling the shelf"],
    captureRequired: false, captureCta: "Unlock my picks", captureSkipLabel: "Skip for now",
    consentOn: true, consentCopy: "Send me offers, probe edition.",
    termsUrl: "/policies/terms-of-service", termsLabel: "Probe Terms",
    perRow: 3, showStars: true, showVerified: true, showDesc: true,
    descOverrides: overriddenPid ? { [overriddenPid]: "RGW OVERRIDDEN DESCRIPTION" } : {},
    extrasOn: true, extrasHeading: "More to explore", extrasCount: 2,
  };
  const mkDoc = (global) => ({
    quiz_id: QUIZ, status: "draft", scope: { collection_ids: [] }, logic_model: "decider",
    design_tokens: { colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" }, radius: "rounded" },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "RGW Probe", subtext: "Wiring check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "What are you shopping for?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "r1", type: "result", position: { x: 0, y: 240 }, data: { headline: "Your match", fallback_collection_id: "manual" } },
    ],
    edges: [
      { id: "e1", source: "intro1", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
    results_pages: [],
    rec_page_settings: { global, overrides: {} },
    build_session: { stage: "question_builder", built: true },
  });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

  const builderData = `${BASE}/studio/${QUIZ}?_data=routes%2Fstudio_.%24id`;
  const publish = (doc) =>
    ctx.request.post(builderData, { form: { intent: "publish", doc: JSON.stringify(doc) } });

  const walkToCapture = async (shopper) => {
    // cache-bust: /q is 60s-cacheable and the two walks straddle a republish
    await shopper.goto(`${BASE}/q/${QUIZ}?rgw=${Math.random().toString(36).slice(2)}`, { waitUntil: "domcontentloaded" });
    await shopper.getByRole("button", { name: /start/i }).first().waitFor({ timeout: 10000 });
    await shopper.getByRole("button", { name: /start/i }).first().click();
    await shopper.getByText("A snowboard", { exact: false }).first().waitFor({ timeout: 10000 });
    await shopper.getByText("A snowboard", { exact: false }).first().click();
    const nextBtn = shopper.getByRole("button", { name: "Next" }).first();
    if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click();
    await shopper.waitForTimeout(700);
  };
  // The reveal lands only after beats AND the AI why-copy race settle — poll.
  const waitForReveal = async (shopper, ms = 15000) => {
    await shopper.getByRole("button", { name: /start over/i }).first().waitFor({ timeout: ms }).catch(() => {});
  };

  // ── 1. the WIRED publish ──────────────────────────────────────────────────
  // Seed the draft via prisma FIRST (the publish intent validates the stored
  // draft), then publish.
  const wiredDoc = mkDoc(WIRED_GLOBAL);
  // A prior probe restored the doc but not the version counter — align it
  // past the existing QuizVersion history so the publish bump can't collide.
  const maxV = await prisma.quizVersion.aggregate({ where: { quizId: QUIZ }, _max: { version: true } });
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: wiredDoc, version: Math.max(quiz.version ?? 0, maxV._max.version ?? 0) },
  });
  const pub = await publish(wiredDoc);
  let pubBody = "";
  try { pubBody = await pub.text(); } catch { /* ignore */ }
  ok("wired doc publishes", pub.ok() && !/"ok":false|error/i.test(pubBody.slice(0, 200)), pubBody.slice(0, 300));
  const shopper = await ctx.newPage();
  shopper.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
  await walkToCapture(shopper);

  ok('capture CTA reads "Unlock my picks"',
    await shopper.getByRole("button", { name: "Unlock my picks" }).isVisible().catch(() => false));
  ok('skip link "Skip for now" renders (captureRequired:false)',
    await shopper.getByRole("button", { name: "Skip for now" }).isVisible().catch(() => false));
  ok("marketing-consent row renders with the merchant copy",
    await shopper.getByText("Send me offers, probe edition.").isVisible().catch(() => false));
  ok('policy link "Probe Terms" renders',
    await shopper.getByRole("link", { name: "Probe Terms" }).isVisible().catch(() => false));
  await shopper.screenshot({ path: `${SHOTS}/1-capture-wired.png` });

  // consent ticked + email → POST carries marketing_consent:true
  await shopper.getByText("Send me offers, probe edition.").click();
  await shopper.locator('input[type="email"]').first().fill("rgw-probe@example.com");
  await shopper.getByRole("button", { name: "Unlock my picks" }).click();
  // the stepped loading plays the merchant's FIRST step immediately
  await shopper.waitForTimeout(250);
  ok("stepped loading shows the merchant's steps",
    await shopper.getByText("Reading the probe answers").isVisible().catch(() => false));
  await shopper.screenshot({ path: `${SHOTS}/2-loading-wired.png` });
  await waitForReveal(shopper);

  const revealText = (await shopper.locator("body").innerText()) ?? "";
  ok("reveal renders", /Your perfect match|Your match/i.test(revealText));
  // The marker is RATING-ANCHORED (it rides the star row): products with a
  // baked review rating show "✓ Verified buyers"; a catalog with no review
  // data shows neither stars nor the marker — consistent, never a floating
  // unanchored claim.
  const hasStars = revealText.includes("★");
  ok(hasStars ? "Verified marker renders beside the stars" : "no stars → no floating Verified claim (rating-anchored)",
    hasStars ? revealText.includes("Verified buyers") : !revealText.includes("Verified buyers"));
  ok("desc override renders", revealText.includes("RGW OVERRIDDEN DESCRIPTION"));
  ok('extras shelf "More to explore" renders', revealText.includes("More to explore"));
  const cols = await shopper.evaluate(() => {
    const grids = [...document.querySelectorAll("div")].filter(
      (el) => getComputedStyle(el).display === "grid" &&
        getComputedStyle(el).gridTemplateColumns.split(" ").length === 3,
    );
    return grids.length;
  });
  ok("a 3-column grid renders (perRow:3)", cols > 0, `${cols} grids`);
  await shopper.screenshot({ path: `${SHOTS}/3-reveal-wired.png`, fullPage: true });

  // capture row stored consent
  await shopper.waitForTimeout(600);
  const capRow = await prisma.emailCapture.findFirst({
    where: { quizId: QUIZ, email: "rgw-probe@example.com" },
    orderBy: { capturedAt: "desc" },
  });
  ok("EmailCapture row stores marketingConsent:true", capRow?.marketingConsent === true);

  // ── 2. NEGATIVE CONTROL — empty global = legacy behavior ─────────────────
  const bareDoc = mkDoc({});
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: bareDoc } });
  const pub2 = await publish(bareDoc);
  ok("bare doc republishes", pub2.ok());
  const shopper2 = await ctx.newPage();
  shopper2.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
  await walkToCapture(shopper2);
  const capText = (await shopper2.locator("body").innerText()) ?? "";
  ok("bare capture keeps the mandatory posture (no skip link)", !capText.includes("Skip for now") && !capText.includes("No thanks"));
  ok("bare capture has no consent row", !/Send me offers|offers and updates/i.test(capText));
  ok('bare capture CTA is the legacy "Continue"',
    await shopper2.getByRole("button", { name: "Continue" }).isVisible().catch(() => false));
  await shopper2.locator('input[type="email"]').first().fill("rgw-probe2@example.com");
  await shopper2.getByRole("button", { name: "Continue" }).click();
  await shopper2.waitForTimeout(300);
  const loadText = (await shopper2.locator("body").innerText()) ?? "";
  ok("bare loading is the legacy beats (no merchant steps)", !loadText.includes("Reading the probe answers"));
  await waitForReveal(shopper2);
  const revealText2 = (await shopper2.locator("body").innerText()) ?? "";
  ok("bare reveal has NO extras shelf", !revealText2.includes("More to explore"));
  ok("bare reveal has NO Verified marker", !revealText2.includes("Verified buyers"));
  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
} finally {
  // ── restore ───────────────────────────────────────────────────────────────
  if (seeded) {
    await prisma.quiz.update({
      where: { id: QUIZ },
      data: { draftJson: snap.draftJson, publishedJson: snap.publishedJson, status: snap.status, version: snap.version },
    });
    await prisma.category.deleteMany({ where: { quizId: QUIZ } });
    for (const c of originalCats) {
      const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
      await prisma.category.create({
        data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
      });
    }
    await prisma.emailCapture.deleteMany({
      where: { quizId: QUIZ, email: { in: ["rgw-probe@example.com", "rgw-probe2@example.com"] } },
    });
    console.log("fixture restored (doc + published + categories); probe captures deleted");
  }
  await prisma.$disconnect();
  if (browser) await browser.close();
}
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
process.exit(fails.length ? 1 : 0);
