// Results handoff §9 live-verify — the FIXED-WORDING consent form on /q.
// Against a LOCAL prod build (BASE): seed the local fixture with a decider
// doc whose rec_page_settings carries consentVersion + marketing consent +
// a terms BOX + SMS on, publish via the real intent, walk /q and assert:
// the fixed sentences, checkbox order (marketing · terms last), the phone
// field stays OFF (no SMS destination exists), only the terms box blocks
// submit, links resolve on the store's domain, and the stored EmailCapture
// evidence records version + placement + links + the marketing text with no
// phone number. Restores the fixture byte-for-byte.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/rgc-shots";
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
writeFileSync(`${SHOTS}/rgc-backup.json`, JSON.stringify({ ...snap, categories: originalCats }));
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
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGC Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId), source: "manual", discoveryRunId: "rgc_probe" },
  });
  const catB = await prisma.category.create({
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGC Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId), source: "manual", discoveryRunId: "rgc_probe" },
  });
  const overriddenPid = products[0]?.productId;
  const answers = (defs) => defs.map(([id, text, target]) => ({
    id, text, tags: [], edge_handle_id: `h_${id}`, ...(target ? { target_id: target } : {}),
  }));
  const FIXED_GLOBAL = {
    consentVersion: "2026-09-17",
    consentOn: true,
    consentCopy: "Email me news and offers from Probe Co.",
    captureTermsOn: true,
    captureTermsMode: "checkbox",
    termsLabel: "Terms & Conditions",
    termsUrl: "/policies/terms-of-service",
    privacyLabel: "Privacy Policy",
    privacyUrl: "/policies/privacy-policy",
    capturePhone: true,
    smsConsentMode: "checkbox",
    // An old custom sentence is ignored once the quiz carries consentVersion.
    captureTermsText: "OLD {terms} SENTENCE",
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

  const doc = mkDoc(FIXED_GLOBAL);
  const maxV = await prisma.quizVersion.aggregate({ where: { quizId: QUIZ }, _max: { version: true } });
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: doc, version: Math.max(quiz.version ?? 0, maxV._max.version ?? 0) },
  });
  const pub = await publish(doc);
  ok("fixed-wording doc publishes", pub.ok());
  const shopDomain = (await prisma.shop.findUnique({ where: { id: quiz.shopId } }))?.shopDomain ?? "";
  const shopper = await ctx.newPage();
  shopper.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
  await walkToCapture(shopper);
  const capText = (await shopper.locator("body").innerText()) ?? "";
  ok("marketing box shows the brand's text", capText.includes("Email me news and offers from Probe Co."));
  ok("terms box uses the fixed wording", capText.includes("I agree to the Terms & Conditions and acknowledge the Privacy Policy."));
  // Local runs have no Shopify admin, so no store name is baked: the line
  // must fall back to "our", never to a brand-guidelines preset name.
  ok("unsubscribe line shows", /You can unsubscribe from (our|.+) emails at any time\./.test(capText));
  ok("store name is never a voice-preset name", !/Authoritative|trustworthy/i.test(capText));
  ok("old custom sentence is ignored", !capText.includes("OLD"));
  ok("phone field stays off (no SMS destination)", (await shopper.locator('input[type="tel"]').count()) === 0);
  const boxes = await shopper.locator("label[data-qz-consent]").evaluateAll((els) => els.map((e) => e.getAttribute("data-qz-consent")));
  ok("checkboxes in order: marketing, terms last", JSON.stringify(boxes) === '["marketing","terms"]', JSON.stringify(boxes));
  const hrefs = await shopper.locator("[data-qz-consent] a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  ok("links resolve on the store's domain", hrefs.length > 0 && hrefs.every((h) => h?.startsWith(`https://${shopDomain}/policies/`)), JSON.stringify(hrefs));
  const legalSize = await shopper.locator('[data-qz-consent="legal"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  ok("legal text is never below 11px", legalSize >= 11, String(legalSize));
  await shopper.locator('input[type="email"]').first().fill("rgc-probe@example.com");
  const submit = shopper.getByRole("button", { name: /continue/i }).first();
  ok("terms box blocks submit until ticked", await submit.isDisabled());
  await shopper.locator('label[data-qz-consent="terms"] input').check();
  ok("marketing unticked never blocks submit", !(await submit.isDisabled()));
  await shopper.screenshot({ path: `${SHOTS}/fixed-capture.png` });
  await submit.click();
  await shopper.waitForTimeout(1500);
  const row = await prisma.emailCapture.findFirst({
    where: { quizId: QUIZ, email: "rgc-probe@example.com" },
    orderBy: { capturedAt: "desc" },
  });
  const ev = row?.consentEvidence ?? {};
  ok("capture stored", Boolean(row));
  ok("evidence records version + gate placement", ev.version === "2026-09-17" && ev.placement === "gate", JSON.stringify(ev));
  ok("evidence records both links as shown", ev.links?.terms?.startsWith("https://") && ev.links?.privacy?.startsWith("https://"));
  ok("evidence records the marketing text, unticked", ev.marketing?.text === "Email me news and offers from Probe Co." && ev.marketing?.checked === false);
  ok("evidence records the ticked terms box", ev.terms?.mode === "checkbox" && ev.terms?.checked === true);
  ok("marketingConsent false, no phone stored", row?.marketingConsent === false && row?.phone === null);
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
      where: { quizId: QUIZ, email: { in: ["rgc-probe@example.com"] } },
    });
    console.log("fixture restored (doc + published + categories); probe captures deleted");
  }
  await prisma.$disconnect();
  if (browser) await browser.close();
}
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
process.exit(fails.length ? 1 : 0);
