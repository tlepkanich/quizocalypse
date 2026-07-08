// QZY-R5c live-verify — interaction states (build-tab v2.0 §6.1): selected-state
// config (R5c-1) + hover/motion (R5c-2). LOCAL prod build (BASE, localhost:3000).
//
// Fixture: cmr7khgd5… (single_select Q1). NET-ZERO — sets a motion preset then
// clears it and returns to Text list. Verifies the builder controls AND that the
// runtime tags the option with .qz-answer-opt + data-qz-motion and that :hover
// actually transforms it (the /q CSS is wired).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qzy-r5c-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));

await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 20000 });
await page.waitForTimeout(1600);
await page.locator(".qz-screens-item", { hasText: "Q1" }).first().locator(".qz-screens-thumb").click();
await page.waitForTimeout(600);

// Enter a mode + open More options (the interaction controls live there).
await page.locator(".qz-ads-modes button", { hasText: "Compact pills" }).click();
await page.waitForTimeout(300);
await page.locator(".qz-ads .qz-insp-more > summary", { hasText: "More options" }).click();
await page.waitForTimeout(300);

// R5c-1 — selected-state controls.
ok("selection indicator picker present (Check/Dot/Filled/None) §6.1",
  (await page.locator('[aria-label="Selection indicator"] button').count()) === 4);
ok("granular selected colors present (fill / text / border)",
  (await page.locator(".qz-ads", { hasText: "Selected fill" }).count()) >= 1 &&
    (await page.locator(".qz-ads", { hasText: "Selected text" }).count()) >= 1);

// R5c-2 — motion + hover controls.
ok("motion preset picker present (None/Pop/Lift/Fade) §6.1",
  (await page.locator('[aria-label="Motion preset"] button').count()) === 4);
ok("hover color controls present",
  (await page.locator(".qz-ads", { hasText: "Hover fill" }).count()) >= 1);

// Apply Lift → the runtime should tag the canvas option.
await page.locator('[aria-label="Motion preset"] button', { hasText: "Lift" }).click();
await page.waitForTimeout(600);
const opt = page.locator('.qz-builder-canvas button.qz-insp[data-qz-motion="lift"]').first();
ok("runtime tags the option with data-qz-motion + .qz-answer-opt",
  (await opt.count()) >= 1 &&
    ((await opt.getAttribute("class")) ?? "").includes("qz-answer-opt"));

// Hover it → the CSS :hover transform actually applies.
const before = await opt.evaluate((el) => getComputedStyle(el).transform).catch(() => "none");
await opt.hover();
await page.waitForTimeout(250);
const after = await opt.evaluate((el) => getComputedStyle(el).transform).catch(() => "none");
ok("hovering the option applies the motion transform (/q CSS wired)",
  before !== after && after !== "none", `${before} → ${after}`);

await page.locator(".qz-ads").screenshot({ path: `${SHOTS}/interaction.png` }).catch(() => {});

// ── net-zero ────────────────────────────────────────────────────────────────
await page.locator('[aria-label="Motion preset"] button', { hasText: "None" }).click();
await page.waitForTimeout(200);
await page.locator(".qz-ads-modes button", { hasText: "Text list" }).click();
// Wait past the 700ms autosave debounce so the reset PERSISTS before we close
// (otherwise the fixture keeps the earlier-saved mode/motion — a cross-probe leak).
await page.waitForTimeout(1100);
ok("net-zero: motion tag removed after clearing",
  (await page.locator('.qz-builder-canvas button[data-qz-motion]').count()) === 0);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
