// Results step handoff (2026-09-17) live-verify — the five-step guided flow.
// Ports the mock probes gflow/gcont/gfoot/gclick/gnew/gconsent/gterms onto the
// real app. LOCAL prod build + LOCAL DB, fixture cmr7khgd50001vkhscvox8dgt:
// the draft's stage is seeded via prisma and byte-restored at the end.
//
//   set -a; source .env; set +a; BASE=http://localhost:3000 node e2e/rg-flow-verify.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/rg-flow-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${String(detail).replaceAll(KEY, "***")}` : ""}`);
  if (!cond) failures++;
};

const prisma = new PrismaClient();
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const original = quiz.draftJson;
const seed = async () => {
  const doc = structuredClone(original);
  doc.build_session = { stage: "rec_page" };
  doc.rec_page_settings = { global: {}, overrides: {} };
  doc.discount_config = { ...doc.discount_config, enabled: false };
  delete doc.discount_config.configured;
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: doc } });
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));
const text = async (sel) => ((await page.locator(sel).first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const title = () => text(".qz-rg-title");
const stepNo = () => text(".qz-rg-stepno");
const forward = () => page.locator(".qz-rg-stepfoot .qz-rg-btn2.is-pri").click();
const back = () => page.locator(".qz-rg-stepfoot .is-backico").click();
const footY = async () => Math.round((await page.locator(".qz-rg-stepfoot").boundingBox())?.y ?? -1);
const settle = () => page.waitForTimeout(350);

try {
  await seed();
  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-rg", { timeout: 20000 });
  await page.waitForTimeout(900);

  // ── gflow · gshot — the seven-stop walk, titles and labels ────────────────
  ok("step 1 head", (await stepNo()) === "STEP 1 OF 5" || (await stepNo()) === "Step 1 of 5", await stepNo());
  ok("step 1 title", (await title()) === "What does the page say?", await title());
  ok("no Back on step 1 (absent, not disabled)", (await page.locator(".qz-rg-stepfoot .is-backico").count()) === 0);
  ok("labels: Why we recommend + Suggestions",
    (await page.locator(".qz-rg-fl", { hasText: "Why we recommend" }).count()) === 1 &&
    (await page.locator(".qz-rg-sl", { hasText: "Suggestions" }).count()) === 2);
  ok("no rationale line, no All-reviewed chip", (await page.locator(".qz-rg-stepsub, .qz-rg-allrev").count()) === 0);
  const pips = await page.locator(".qz-rg-spine > i").count();
  ok("five pips", pips === 5, String(pips));
  // gcont — the bar Continue is gated until every step is done.
  const bar = page.locator(".qz-topbar-continue");
  ok("bar Continue disabled on arrival", await bar.isDisabled());
  ok("bar Continue tooltip", (await bar.getAttribute("title")) === "Finish the Results steps first.", await bar.getAttribute("title"));
  // gclick — the phone never changes the step.
  await page.locator(".qz-rg-screen [data-jump='cards']").first().click({ force: true });
  await settle();
  ok("clicking the matches on step 1 does not change the step", (await title()) === "What does the page say?");
  const ys = [await footY()];
  await page.screenshot({ path: `${SHOTS}/1-says.png` });

  await forward();
  await settle();
  ok("step 2 title", (await title()) === "How do the matches look?", await title());
  const togs = (await page.locator(".qz-rg-tog .qz-rg-t").allInnerTexts()).map((t) => t.trim());
  ok("step 2 has exactly three card toggles", togs.length === 3, JSON.stringify(togs));
  ok("no per-row / count / stars / verified", !(await page.locator(".qz-rg-panel").innerText()).match(/per row|How many to show|Review stars|Verified/));
  ys.push(await footY());
  await page.screenshot({ path: `${SHOTS}/2-shows.png` });
  // ghl — a touched control rings ONLY the element it changes, then fades.
  await page.waitForTimeout(1600);
  await page.locator("button[aria-label='“Add all to cart” button']").click();
  await page.waitForTimeout(250);
  const rings = await page.evaluate(() => ({
    sel: [...document.querySelectorAll(".qz-rg-screen .qz-rg-zsel")].map((e) => e.getAttribute("data-part")),
    soft: document.querySelectorAll(".qz-rg-screen .qz-rg-zsoft").length,
  }));
  ok("touching Add-all rings only the add-all button", JSON.stringify(rings.sel) === '["addall"]' && rings.soft === 0, JSON.stringify(rings));
  await page.screenshot({ path: `${SHOTS}/2-ring.png` });
  await page.waitForTimeout(1600);
  ok("every ring is gone after a second", (await page.locator(".qz-rg-screen .qz-rg-zsel, .qz-rg-screen .qz-rg-zsoft").count()) === 0);
  await page.locator("button[aria-label='“Add all to cart” button']").click();
  await settle();

  await forward();
  await settle();
  ok("step 3 title", (await title()) === "Do you want their email?", await title());
  const tabs = (await page.locator(".qz-rg-stab").allInnerTexts()).map((t) => t.trim());
  ok("tabs Email › Loading › Consent", JSON.stringify(tabs) === JSON.stringify(["Email", "Loading", "Consent"]), JSON.stringify(tabs));
  ok("lands on Email", (await text(".qz-rg-stab.is-on")) === "Email");
  ok("placement dropdown default", (await text(".qz-rg-ddbtn")).startsWith("Email collection before the results page."), await text(".qz-rg-ddbtn"));
  ok("discount list starts empty (Create button only)",
    (await page.locator(".qz-rg-coupon").count()) === 0 && (await page.locator(".qz-rg-addbtn").count()) === 1);
  ys.push(await footY());
  await page.screenshot({ path: `${SHOTS}/3a-email.png` });

  // gnew — unlock with no discount: Create lights up, Set up later keeps it.
  await page.locator("button[aria-label='Require the email to unlock it']").click();
  await settle();
  ok("unlock on + no discount → Create is solid", (await page.locator(".qz-rg-addbtn.is-need").count()) === 1);
  await page.locator(".qz-rg-later").click();
  await settle();
  ok("Set up later swaps to the quiet note", (await text(".qz-rg-dnote")).startsWith("No discount yet."), await text(".qz-rg-dnote"));
  ok("unlock stays on after Set up later",
    (await page.locator("button[aria-label='Require the email to unlock it']").getAttribute("aria-checked")) === "true");
  await page.screenshot({ path: `${SHOTS}/3a-unlock-deferred.png` });
  await page.locator("button[aria-label='Require the email to unlock it']").click();
  await settle();

  // gdisc — the editor: order by default, read-back last, Save blockers.
  await page.locator(".qz-rg-addbtn").click();
  await page.waitForSelector(".qz-rg-deditor");
  const heads = (await page.locator(".qz-rg-deditor .qz-rg-grpdiv").allTextContents()).map((t) => t.trim());
  ok("editor sections in Shopify's order, read-back last",
    heads[0] === "Basics" && heads[1] === "Discount code" && heads.at(-1) === "What this creates in Shopify", JSON.stringify(heads));
  ok("order discount by default",
    (await page.locator("[aria-label='Discount type'] button[aria-pressed='true']").innerText()).trim() === "Amount off orders");
  await page.fill("input[aria-label='Discount value']", "0");
  ok("a 0% value blocks Save", (await text(".qz-rg-saveblock")) === "A 0% / $0 reward takes nothing off. Give it a value.",
    await text(".qz-rg-saveblock"));
  await page.fill("input[aria-label='Discount value']", "15");
  await page.locator("[aria-label='Discount type'] button", { hasText: "Free shipping" }).click();
  ok("free shipping hides the value field", (await page.locator("input[aria-label='Discount value']").count()) === 0);
  await page.locator("[aria-label='Discount type'] button", { hasText: "Amount off orders" }).click();
  await page.fill("input[aria-label='Discount value']", "15");
  await page.screenshot({ path: `${SHOTS}/3a-editor.png`, fullPage: true });
  await page.locator("button", { hasText: "Save discount" }).click();
  await settle();
  ok("the discount row replaces Create", (await page.locator(".qz-rg-coupon").count()) === 1 && (await page.locator(".qz-rg-addbtn").count()) === 0);
  ok("row reads the name and the masked code", (await text(".qz-rg-coupon .qz-rg-ct")).includes("15% off your order")
    && (await text(".qz-rg-coupon .qz-rg-ct")).includes("QUIZ-••••••"), await text(".qz-rg-coupon .qz-rg-ct"));
  const stored = (await prisma.quiz.findUnique({ where: { id: QUIZ } })).draftJson.discount_config;
  await page.waitForTimeout(1200);
  const saved = (await prisma.quiz.findUnique({ where: { id: QUIZ } })).draftJson.discount_config;
  ok("autosave stored configured + enabled, no retired keys",
    saved.configured === true && saved.enabled === true && !("auto_apply" in saved) && !("scope" in saved), JSON.stringify(saved ?? stored));
  await page.screenshot({ path: `${SHOTS}/3a-with-discount.png` });

  await forward();
  await settle();
  ok("forward walks to the Loading tab (same step)", (await text(".qz-rg-stab.is-on")) === "Loading" && (await title()) === "Do you want their email?");
  ok("the phone shows the loading screen", (await page.locator(".qz-rg-loadscr").count()) === 1);
  ys.push(await footY());
  await page.screenshot({ path: `${SHOTS}/3b-loading.png` });

  await forward();
  await settle();
  ok("forward walks to the Consent tab", (await text(".qz-rg-stab.is-on")) === "Consent");
  const rows = (await page.locator(".qz-rg-panel .qz-rg-inline .qz-rg-t").allInnerTexts()).map((t) => t.trim());
  ok("consent rows in order",
    JSON.stringify(rows) === JSON.stringify(["Email marketing consent", "Terms and conditions checkbox", "Email terms of service", "SMS collection"]),
    JSON.stringify(rows));
  ok("Email tab dot turned green after passing it", (await page.locator(".qz-rg-stab.is-done").count()) >= 1);
  ys.push(await footY());
  await page.screenshot({ path: `${SHOTS}/3c-consent.png` });

  // gterms — a refused link blocks Save.
  await page.locator(".qz-rg-bt", { hasText: "Edit →" }).click();
  await page.waitForSelector("input[aria-label='Terms link']");
  await page.fill("input[aria-label='Terms link']", "http://example.com/terms");
  ok("http: link refused", (await text(".qz-rg-linkstat.is-err")).includes("https"), await text(".qz-rg-linkstat.is-err"));
  ok("Save disabled with a reason", await page.locator(".qz-modal button", { hasText: "Save" }).isDisabled().catch(() => false)
    || await page.locator("button", { hasText: /^Save$/ }).last().isDisabled(), await text(".qz-rg-saveblock"));
  await page.fill("input[aria-label='Terms link']", "/policies/terms-of-service");
  ok("store path resolves on the store", (await text(".qz-rg-linkstat.is-ok")).includes("A page on your store"));
  await page.screenshot({ path: `${SHOTS}/3c-terms-modal.png` });
  await page.keyboard.press("Escape");
  await settle();

  await forward();
  await settle();
  ok("step 4 title", (await title()) === "Anything after the matches?", await title());
  ok("step 4 empty placeholder under the matches",
    (await text(".qz-rg-screen .qz-rg-empty")).startsWith("No products picked yet"), await text(".qz-rg-screen .qz-rg-empty"));
  await page.waitForTimeout(700);
  const scrolled = await page.locator(".qz-rg-screen").evaluate((el) => el.scrollTop > 0);
  ok("step 4 scrolls the phone down", scrolled);
  ys.push(await footY());
  await page.screenshot({ path: `${SHOTS}/4-extras.png` });

  // Back from step 4 lands on Consent.
  await back();
  await settle();
  ok("Back from step 4 lands on the Consent tab", (await text(".qz-rg-stab.is-on")) === "Consent" && (await title()) === "Do you want their email?");
  await forward();
  await settle();

  await forward();
  await settle();
  ok("Overview title", (await title()) === "Overview");
  const ovw = (await page.locator(".qz-rg-drow .qz-rg-dtx b").allInnerTexts()).map((t) => t.trim());
  ok("overview rows in order",
    JSON.stringify(ovw) === JSON.stringify(["Email capture & offer", "What it says", "The matches", "Extra picks"]), JSON.stringify(ovw));
  ok("last button reads Open the builder →", (await text(".qz-rg-stepfoot .is-pri")) === "Open the builder →");
  await page.waitForTimeout(400);
  ok("bar Continue live on the Overview", !(await bar.isDisabled()));
  ys.push(await footY());
  await page.screenshot({ path: `${SHOTS}/5-overview.png` });

  // An Overview row opens its step on the FIRST tab.
  await page.locator(".qz-rg-drow", { hasText: "Email capture & offer" }).click();
  await settle();
  ok("Overview row → step 3 on its first tab", (await text(".qz-rg-stab.is-on")) === "Email");
  ok("bar Continue stays live after walking back", !(await bar.isDisabled()));

  // gfoot — Back/Continue at one height at every stop (Page Copy closed),
  // at three window sizes.
  const spread = Math.max(...ys) - Math.min(...ys);
  ok("footer holds one height across the walk (1440×900)", spread <= 2, JSON.stringify(ys));
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-rg");
    await page.waitForTimeout(800);
    const walk = [await footY()];
    for (let i = 0; i < 6; i++) {
      await forward();
      await settle();
      walk.push(await footY());
    }
    ok(`footer holds one height across the walk (${w}×${h})`, Math.max(...walk) - Math.min(...walk) <= 2, JSON.stringify(walk));
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // persistence — reload keeps the completion signal.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-rg");
  await page.waitForTimeout(1200);
  ok("completion survives a reload (bar Continue live)", !(await bar.isDisabled()));

  ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} finally {
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: original } });
  console.log("fixture restored (draftJson byte-for-byte)");
  await browser.close();
  await prisma.$disconnect();
}
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S) — shots in ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
