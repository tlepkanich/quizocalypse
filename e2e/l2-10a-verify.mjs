// L2-10a+b live-verify on the standalone studio deploy.
// A) Preview bake + default-target affordance: open the decider fixture's
//    DRAFT in the builder, select the result node via the Editor rail — the
//    preview now resolves the FIRST mapped answer's target, so the canvas
//    walks capture → loading → reveal with REAL bucket products pre-publish.
// B) Capture keys end-to-end: PUT capturePhone:true onto the draft (sparse:
//    no captureEmail key stored), republish, walk /q → the capture screen now
//    shows email + phone; then restore (drop the key) + republish.
// C) Legacy regression open + the pinned byte baseline.
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const FIXTURE = "cmqwd15f0001aqvl19onkpwm6"; // "L2-9 decider smoke"
const LEGACY = "cmqqcb0ao004mqvkwjug7t0ya";

const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
const legacyBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());

// ── A. preview bake + default-target affordance ─────────────────────────────
await page.goto(`${BASE}/studio/${FIXTURE}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
ok("builder loads the decider fixture", await page.getByText("L2-9 decider smoke").first().isVisible().catch(() => false));

const railRow = page.getByText("Your match", { exact: false }).first();
await railRow.click();
await page.waitForTimeout(900);

// The affordance resolves the first target → the §7 capture screen renders.
const captureSeen = await page.getByText("Your results are ready").first().isVisible().catch(() => false);
ok("preview shows the capture screen at the result node (affordance resolved a target)", captureSeen);
if (captureSeen) {
  await page.locator('input[type="email"]').first().fill("preview@example.com");
  await page.getByRole("button", { name: "Continue" }).first().click();
  await page.waitForTimeout(2600); // loading interstitial (preview never POSTs)
}

ok("reveal headline renders in preview", await page.getByText("Your perfect match").first().isVisible().catch(() => false));
ok("hero badge renders in preview", await page.getByText("Our top pick for you", { exact: false }).first().isVisible().catch(() => false));
const canvasCard = page.locator(".qz-builder-canvas, [class*=canvas]").first();
const canvasText = (await canvasCard.textContent().catch(() => "")) ?? "";
ok("REAL bucket products render pre-publish (the L2-10a fix)", /Snowboard/i.test(canvasText), canvasText.slice(0, 120));
ok("no-match fallback NOT shown in the canvas", !canvasText.includes("couldn't find a perfect match"));
await page.screenshot({ path: "e2e/shots/l2-10a-preview-reveal.png", fullPage: false });

// ── B. capture keys end-to-end (sparse PUT → republish → /q shows phone) ────
const builderData = `${BASE}/studio/${FIXTURE}?_data=routes%2Fstudio_.%24id`;
const loaded = await (await ctx.request.get(builderData)).json();
const doc = loaded.doc;
ok("fixture draft is a decider doc", doc?.logic_model === "decider");

const withPhone = {
  ...doc,
  rec_page_settings: {
    global: { ...(doc.rec_page_settings?.global ?? {}), capturePhone: true },
    overrides: { ...(doc.rec_page_settings?.overrides ?? {}) },
  },
};
const putResp = await ctx.request.put(builderData, {
  headers: { "content-type": "application/json" },
  data: { doc: withPhone },
});
ok("autosave PUT accepts the capture key", putResp.ok());
const reRead = await (await ctx.request.get(builderData)).json();
const g = reRead.doc?.rec_page_settings?.global ?? {};
ok("capturePhone stored SPARSE (true, no captureEmail key)", g.capturePhone === true && !("captureEmail" in g), JSON.stringify(g));

const pubResp = await ctx.request.post(builderData, { form: { intent: "publish", doc: JSON.stringify(withPhone) } });
let pubJson = {};
try { pubJson = await pubResp.json(); } catch { /* html */ }
ok("republish with capturePhone succeeds", pubResp.ok() && pubJson.ok !== false, JSON.stringify(pubJson).slice(0, 120));

// Walk /q — capture shows email + phone.
const shopper = await ctx.newPage();
shopper.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
await shopper.goto(`${BASE}/q/${FIXTURE}`, { waitUntil: "domcontentloaded" });
await shopper.waitForTimeout(600);
const startBtn = shopper.getByRole("button", { name: /start/i }).first();
if (await startBtn.isVisible().catch(() => false)) await startBtn.click();
await shopper.waitForTimeout(400);
await shopper.getByText("A snowboard", { exact: false }).first().click();
const nextBtn = shopper.getByRole("button", { name: "Next" });
if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click();
await shopper.waitForTimeout(600);
ok("live capture shows the email field", await shopper.locator('input[type="email"]').isVisible().catch(() => false));
ok("live capture NOW shows the phone field (L2-10b key honored)", await shopper.locator('input[type="tel"]').isVisible().catch(() => false));
await shopper.close();

// Restore: drop capturePhone + republish the original doc.
const restoreResp = await ctx.request.post(builderData, { form: { intent: "publish", doc: JSON.stringify(doc) } });
ok("fixture restored (republished without capturePhone)", restoreResp.ok());
const finalRead = await (await ctx.request.get(builderData)).json();
ok("restored draft has no capture keys", !("capturePhone" in (finalRead.doc?.rec_page_settings?.global ?? {})));

// ── C. legacy regression + byte baseline ────────────────────────────────────
await page.goto(`${BASE}/studio/${LEGACY}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
ok("legacy builder opens clean", (await page.locator(".qz-builder, [class*=builder]").count()) > 0);
ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));

const legacyAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy /q.json BYTE-IDENTICAL", legacyAfter === legacyBefore, `sha ${legacyAfter}`);

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
