// QZY-R9-1 live-verify — the Logic view's Table tab (a grid projection of the
// same enumeratePaths dataset; collapsed = per-result rows, expand = per-path
// rows with a column per question). LOCAL prod build. READ-ONLY → net-zero.
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

await page.locator(".qz-builder-rail button", { hasText: "Logic" }).click();
await page.waitForTimeout(500);
await page.locator(".qz-logic-tab", { hasText: "Table" }).click();
await page.waitForTimeout(400);

ok("Table tab renders a grid", (await page.locator(".qz-ltable").count()) === 1);
const heads = await page.locator(".qz-ltable thead th").allInnerTexts();
ok("header has Result · a column per question · Paths · Status",
  heads.includes("Result") && heads.includes("Q1") && heads.includes("Q2") &&
    heads.includes("Paths") && heads.includes("Status"), heads.join("|"));

const groupRows = await page.locator(".qz-ltable-group").count();
ok("one collapsed row per result group", groupRows >= 1, `groups=${groupRows}`);
ok("collapsed: no per-path rows yet", (await page.locator(".qz-ltable-path").count()) === 0);

// Expand the first result group → per-path rows appear with answer cells.
await page.locator(".qz-ltable-group").first().click();
await page.waitForTimeout(300);
const pathRows = await page.locator(".qz-ltable-path").count();
ok("expanding a result reveals its per-path rows", pathRows >= 1, `pathRows=${pathRows}`);
ok("path rows carry navigable answer cells",
  (await page.locator(".qz-ltable-path .qz-ltable-ans").count()) >= 1);

// A skipped question would show "–"; in this fixture no path skips, so every
// answer cell is filled (skip cells = 0). The "–" logic is unit-covered by the
// engine's skipped-omission test.
ok("no spurious skip marks when nothing is skipped",
  (await page.locator(".qz-ltable-path .qz-ltable-skip").count()) === 0);

// Clicking an answer cell jumps toward the Map (selects the question).
await page.locator(".qz-ltable-path .qz-ltable-ans").first().click();
await page.waitForTimeout(300);
ok("answer-cell click did not error", errs.length === 0);

// Collapse again.
await page.locator(".qz-builder-rail button", { hasText: "Logic" }).click().catch(() => {});
await page.waitForTimeout(200);
await page.locator(".qz-logic-tab", { hasText: "Table" }).click().catch(() => {});
await page.waitForTimeout(200);
await page.locator(".qz-ltable-group").first().click();
await page.waitForTimeout(200);
ok("collapse hides the per-path rows again",
  (await page.locator(".qz-ltable-path").count()) === 0);
ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
