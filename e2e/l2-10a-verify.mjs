// L2-10a live-verify — draft-time decider bake in the builder preview.
// Opens the L2-9 decider fixture's DRAFT in the standalone builder, selects
// the result node via the Editor rail (focusNodeId → the full Step5Preview →
// QuizRuntime canvas — NOT the simplified FramedPreview), walks the §7
// capture → loading → reveal INSIDE the preview, and asserts the reveal now
// renders REAL bucket products pre-publish (the L2-9 review's top major).
// Then a legacy-draft regression open + the pinned byte baseline.
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

// ── the decider fixture's draft in the builder ──────────────────────────────
await page.goto(`${BASE}/studio/${FIXTURE}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800); // client-only builder mount
ok("builder loads the decider fixture", await page.getByText("L2-9 decider smoke").first().isVisible().catch(() => false));

// Select the result node in the Editor rail (focusNodeId jump).
const railRow = page.getByText("Your match", { exact: false }).first();
ok("result node visible in the rail", await railRow.isVisible().catch(() => false));
await railRow.click();
await page.waitForTimeout(800);

// The §7 capture screen renders first in the preview (mandatory email).
const captureSeen = await page.getByText("Your results are ready").first().isVisible().catch(() => false);
ok("preview shows the capture screen at the result node", captureSeen);
if (captureSeen) {
  await page.locator('input[type="email"]').first().fill("preview@example.com");
  await page.getByRole("button", { name: "Continue" }).first().click();
  // loading interstitial ~1.6s (preview never POSTs)
  await page.waitForTimeout(2600);
}

// THE HEADLINE: the reveal resolves REAL bucket products from the draft bake.
ok("reveal headline renders in preview", await page.getByText("Your perfect match").first().isVisible().catch(() => false));
ok("hero badge renders in preview", await page.getByText("Our top pick for you", { exact: false }).first().isVisible().catch(() => false));
const productMarkers = await page
  .locator("text=/Snowboard|Shop now/i")
  .count();
ok("REAL products render pre-publish (the L2-10a fix)", productMarkers > 0, `${productMarkers} product markers`);
const noMatch = await page.getByText("We couldn't find a perfect match").isVisible().catch(() => false);
ok("no-match fallback NOT shown (was the pre-fix symptom)", !noMatch);
await page.screenshot({ path: "e2e/shots/l2-10a-preview-reveal.png", fullPage: false });

// ── legacy draft regression: builder opens + canvas renders unchanged ───────
await page.goto(`${BASE}/studio/${LEGACY}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
ok("legacy builder opens clean", (await page.locator(".qz-builder, [class*=builder]").count()) > 0);

ok("zero page errors across both builders", out.pageErrors.length === 0, out.pageErrors.join(" | "));

const legacyAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy /q.json BYTE-IDENTICAL", legacyAfter === legacyBefore, `sha ${legacyAfter}`);

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
