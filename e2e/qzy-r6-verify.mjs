// QZY-R6-1 live-verify — background unification: partial-image type + radial /
// 3-stop gradient (build-tab §4). LOCAL prod build. NET-ZERO (waits past the
// 700ms autosave debounce before clearing).
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
if (!KEY) { console.error("no token"); process.exit(1); }
let failures = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).split("\n")[0]));
await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 20000 });
await page.waitForTimeout(1600);
await page.locator(".qz-screens-item", { hasText: "Q1" }).first().locator(".qz-screens-thumb").click();
await page.waitForTimeout(500);
await page.locator('[aria-label="Build panel"] button', { hasText: "Background" }).click();
await page.waitForTimeout(400);

// §4 — the type set now includes Partial.
ok("background type set includes Partial (§4)",
  (await page.locator('[aria-label="Background type"] button', { hasText: "Partial" }).count()) === 1);

// Gradient → radial + 3rd stop.
await page.locator('[aria-label="Background type"] button', { hasText: "Gradient" }).click();
await page.waitForTimeout(300);
ok("gradient offers Linear / Radial shape (§4)",
  (await page.locator('[aria-label="Gradient shape"] button').count()) === 2);
ok("gradient offers a 3rd stop (Third)",
  (await page.locator(".qz-builder-panel", { hasText: "Third" }).count()) >= 1);
await page.locator('[aria-label="Gradient shape"] button', { hasText: "Radial" }).click();
await page.waitForTimeout(300);
ok("radial gradient selectable (renders once the two colours are set)",
  (await page.locator('[aria-label="Gradient shape"] button[aria-pressed=true]', { hasText: "Radial" }).count()) === 1);

// Partial → band + coverage + fill, and a banded image renders.
await page.locator('[aria-label="Background type"] button', { hasText: "Partial" }).click();
await page.waitForTimeout(300);
ok("partial offers Band (Left/Top/Right) + Coverage + Fill",
  (await page.locator('[aria-label="Partial image band"] button').count()) === 3 &&
    (await page.locator(".qz-builder-panel", { hasText: "Coverage" }).count()) >= 1 &&
    (await page.locator(".qz-builder-panel", { hasText: "Fill" }).count()) >= 1);
await page.locator('.qz-builder-panel [aria-label="Media source"] button', { hasText: "URL" }).click();
await page.waitForTimeout(150);
await page.locator('.qz-builder-panel input[placeholder="https://…"]').first().fill("https://cdn.example.com/p.png");
await page.locator(".qz-builder-panel button", { hasText: "Use" }).click();
await page.waitForTimeout(700);
const part = await page.locator(".qz-builder-canvas .qz-runtime-page").first()
  .evaluate((el) => getComputedStyle(el).backgroundSize).catch(() => "");
ok("partial image renders as a band (backgroundSize has a %)", /%/.test(part), part);

// ── net-zero ────────────────────────────────────────────────────────────────
await page.locator('[aria-label="Background type"] button', { hasText: "None" }).click();
await page.waitForTimeout(1100);
ok("net-zero: background cleared",
  (await page.locator('[aria-label="Background type"] button[aria-pressed=true]', { hasText: "None" }).count()) === 1);
ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
