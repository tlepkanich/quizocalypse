// QZY-R7-4 live-verify — Layers drag-to-reorder (build-tab BT4). LOCAL prod
// build. NET-ZERO BY CONSTRUCTION: the autosave PUT is stubbed (fulfilled 200
// without hitting the DB), so the drag reorders the live in-memory doc but
// NEVER persists. This matters — `setNodeLayout` promotes a screen from a
// template-synthesized layout to an EXPLICIT `node_layouts` entry, which would
// drift the shared fixture (the intro heading stops being inline-editable).
// The reorder LOGIC + persistence are covered by studioDoc.test's blockReorder.
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

// Swallow the whole-doc autosave PUT so the fixture on disk never changes.
let putCount = 0;
await page.route(`**/studio/${QUIZ}**`, (route) => {
  if (route.request().method() === "PUT") {
    putCount += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  }
  return route.continue();
});

const names = () => page.locator(".qz-layers-row .qz-layers-name").allInnerTexts();

await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 20000 });
await page.waitForTimeout(1600);
await page.locator(".qz-screens-item").first().locator(".qz-screens-thumb").click();
await page.waitForTimeout(300);
await page.locator('[aria-label="Build panel"] button', { hasText: "Layers" }).click();
await page.waitForTimeout(300);

const before = await names();
ok("intro lists 2 draggable rows with grips",
  before.length === 2 && (await page.locator(".qz-layers-grip").count()) === 2,
  before.join(" | "));

// Drag row 2 up onto row 1 → order flips in the live builder.
await page.locator(".qz-layers-row").nth(1).dragTo(page.locator(".qz-layers-row").nth(0));
await page.waitForTimeout(400);
const flipped = await names();
ok("drag reordered the live rows (real handler ran)",
  flipped[0] === before[1] && flipped[1] === before[0], flipped.join(" | "));

// Drag it back → the reorder is faithful in both directions.
await page.locator(".qz-layers-row").nth(1).dragTo(page.locator(".qz-layers-row").nth(0));
await page.waitForTimeout(400);
const back = await names();
ok("drag back restores the order (bidirectional)",
  back[0] === before[0] && back[1] === before[1], back.join(" | "));

// Net-zero by construction: the autosave PUT was intercepted, never persisted.
await page.waitForTimeout(900);
ok("autosave PUT stubbed — nothing persisted to the fixture", putCount >= 1, `puts=${putCount}`);
ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
