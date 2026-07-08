// QZY-R5c-4 live-verify — reveal-image on hover/select (build-tab §6.1). Scoped-
// option flow. NET-ZERO (waits past the 700ms autosave debounce on cleanup).
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
await page.waitForTimeout(600);
// Reveal renders inside AnswerOptions, which mounts only when a display mode is
// active (styled modes: cards/tiles/pills; default text-list uses the legacy
// renderer). Set pills so the reveal is rendered on the canvas.
await page.locator(".qz-ads-modes button", { hasText: "Compact pills" }).click();
await page.waitForTimeout(400);

// Scope a single option, open the reveal drawer, set an image via URL.
await page.locator(".qz-builder-canvas button.qz-insp").first().click();
await page.waitForTimeout(400);
ok("scoped option panel present", (await page.locator(".qz-insp-scope").count()) === 1);
await page.locator(".qz-insp-scope summary", { hasText: "Reveal image on hover" }).click();
await page.waitForTimeout(250);
// The reveal MediaPicker lives inside the details drawer (scope to it — the
// option-media picker above also has a Media-source switcher).
const rev = page.locator(".qz-insp-scope details");
await rev.locator('[aria-label="Media source"] button', { hasText: "URL" }).click();
await page.waitForTimeout(150);
await rev.locator('input[placeholder="https://…"]').first().fill("https://cdn.example.com/reveal.png");
await rev.locator("button", { hasText: "Use" }).click();
await page.waitForTimeout(700);

ok("position toggle appears once a reveal image is set (Beside/Above)",
  (await page.locator('[aria-label="Reveal position"] button').count()) === 2);
const wrap = page.locator(".qz-builder-canvas .qz-opt-wrap").first();
ok("runtime wraps the option (.qz-opt-wrap) + renders a hidden .qz-reveal",
  (await wrap.count()) >= 1 &&
    (await page.locator('.qz-builder-canvas .qz-reveal[src="https://cdn.example.com/reveal.png"]').count()) >= 1);
// Hidden by default; shown on hover.
const revImg = page.locator(".qz-builder-canvas .qz-reveal").first();
const disp0 = await revImg.evaluate((el) => getComputedStyle(el).display).catch(() => "?");
await wrap.hover();
await page.waitForTimeout(200);
const disp1 = await revImg.evaluate((el) => getComputedStyle(el).display).catch(() => "?");
ok("reveal is hidden by default, shown on hover", disp0 === "none" && disp1 !== "none", `${disp0} → ${disp1}`);

// ── net-zero: clear the reveal image + persist ──────────────────────────────
await rev.locator("button", { hasText: "Remove" }).first().click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: "Style all options" }).click();
await page.waitForTimeout(200);
await page.locator(".qz-ads-modes button", { hasText: "Text list" }).click();
await page.waitForTimeout(1100);
ok("net-zero: reveal + mode cleared", (await page.locator(".qz-builder-canvas .qz-reveal").count()) === 0);
ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
