// QZY-R8-1 live-verify — the Logic view's Map · Paths · Table tab shell + the
// Paths tab (a live projection of R1's enumeratePaths). LOCAL prod build.
// READ-ONLY (no mutations) → net-zero by nature.
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

// Open the Logic rail.
await page.locator(".qz-builder-rail button", { hasText: "Logic" }).click();
await page.waitForTimeout(600);

// LV1 — the three-tab shell over one dataset.
const tabs = await page.locator(".qz-logic-tabs [role=tab]").allInnerTexts();
ok("Logic view has Map · Paths · Table tabs (LV1)",
  tabs.join(",") === "Map,Paths,Table", tabs.join(","));
ok("Map is the default active tab",
  (await page.locator('.qz-logic-tab.is-active').innerText()) === "Map");
ok("Map tab still renders the LogicScroll map",
  (await page.locator('[aria-label="Logic map"]').count()) === 1);

// LV3 — the Paths tab: lanes grouped by result, decider chip gold.
await page.locator(".qz-logic-tab", { hasText: "Paths" }).click();
await page.waitForTimeout(500);
const groups = await page.locator(".qz-path-group").count();
const lanes = await page.locator(".qz-path-lane").count();
const chips = await page.locator(".qz-path-chip").count();
ok("Paths groups lanes by result (≥1 group)", groups >= 1, `groups=${groups}`);
ok("Paths renders lanes with step chips", lanes >= 1 && chips >= 1, `lanes=${lanes} chips=${chips}`);
ok("the deciding question's chip is gold-marked (is-decider)",
  (await page.locator(".qz-path-chip.is-decider").count()) >= 1);
ok("each group shows a result chip",
  (await page.locator(".qz-path-result").count()) >= 1);

// Every lane has at least one step chip and never more than the question count
// (skipped questions are absent by construction — spec §4).
const perLane = await page.locator(".qz-path-lane").evaluateAll((lns) =>
  lns.map((l) => l.querySelectorAll(".qz-path-chip:not(.is-terminal):not(.is-deadend)").length));
ok("no lane exceeds the question count (skipped questions absent)",
  perLane.every((n) => n >= 1 && n <= 2), JSON.stringify(perLane));

// Clicking a step chip selects that question (jump toward the Map).
await page.locator(".qz-path-chip.is-decider").first().click();
await page.waitForTimeout(400);
ok("clicking a step chip did not error", errs.length === 0);

// Table tab is the R9 placeholder.
await page.locator(".qz-builder-rail button", { hasText: "Logic" }).click().catch(() => {});
await page.waitForTimeout(300);
await page.locator(".qz-logic-tab", { hasText: "Table" }).click();
await page.waitForTimeout(300);
ok("Table tab shows the R9 placeholder",
  (await page.locator(".qz-builder", { hasText: "QZY-R9" }).count()) >= 1);
ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
