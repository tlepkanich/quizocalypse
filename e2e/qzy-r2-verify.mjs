// QZY-R2 → QRTZ-OB2 live-verify — the decider Build inspector against a LOCAL
// production build (BASE, default localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — selection +
// tab clicks + one rail navigation only; no doc commit fires.
//
// QZY-R2 made this inspector tab-less and design-only; the owner REVERSED the
// placement 2026-08-12 (QRTZ-OB2, GAPS.md §A item 6 — adopt the mock): the
// panel now carries the mock's ed-tabs Content · Design · Rules, where Rules
// (question nodes only) is a READ-ONLY role + answer-mapping summary in the
// mock's vocabulary with an "Open in Logic" deep link. Asserts: the tab bar
// (no legacy Routing segment) · Design stays the default with the design
// surface intact and still no page-background · Rules shows the role
// read-out, "Maps to" rows and the deep link but NO editing controls · the
// deep link lands the Logic view scrolled to that question's row.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qzy-r2-shots";

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

// Select the first question screen.
// QRTZ-H4 — the Flow tab (left panel) is the screen switcher now.
const q1 = page.locator(".qz-ftree-row", { hasText: "Q1" }).first();
await q1.click();
await page.waitForTimeout(700);

const insp = page.locator(".qz-builder-inspector");
ok("inspector present for the selected question", (await insp.count()) === 1);

// ── QRTZ-OB2 — the mock's ed-tabs, Design default ───────────────────────────
const panelTabs = insp.locator('.qz-segmented[aria-label="Panel tab"]');
ok("Content/Design/Rules tab bar present (QRTZ-OB2 reversal)",
  (await panelTabs.count()) === 1 &&
  (await panelTabs.locator("button", { hasText: "Content" }).count()) === 1 &&
  (await panelTabs.locator("button", { hasText: "Rules" }).count()) === 1);
ok("no legacy Routing segment on a decider doc",
  (await panelTabs.locator("button", { hasText: "Routing" }).count()) === 0);
ok("Design is the default tab (build-tab §1 + the mock's selected segment)",
  (await panelTabs.locator('button[aria-pressed="true"]', { hasText: "Design" }).count()) === 1);
ok("no inline gold Logic section (QZY-R2 removal stands)",
  (await insp.locator(".qz-insp-logic").count()) === 0);
ok("no role dropdown in the design surface",
  (await insp.locator(".qz-insp-logic-role").count()) === 0);
ok("no page-background control on the right (lives in the inspector Background row)",
  (await insp.getByText("Background", { exact: true }).count()) === 0);

// ── the design surface survives on its tab ──────────────────────────────────
ok("design still editable — Primary color field present",
  (await insp.getByText("Primary", { exact: false }).count()) >= 1);
ok("Layout blocks disclosure on the Design tab",
  (await insp.locator("summary", { hasText: "Layout blocks" }).count()) === 1);
ok("Custom CSS disclosure present",
  (await insp.locator("summary", { hasText: "Custom CSS" }).count()) === 1);
ok("footer Delete step present",
  (await insp.locator(".qz-insp-foot button", { hasText: "Delete step" }).count()) === 1);

await insp.screenshot({ path: `${SHOTS}/decider-inspector.png` }).catch(() => {});

// ── the Rules tab: READ-ONLY summary + deep link ────────────────────────────
await panelTabs.locator("button", { hasText: "Rules" }).click();
await page.waitForTimeout(400);
ok("role read-out present (mock vocabulary)",
  (await insp.locator(".qz-obr-rolev").count()) === 1,
  await insp.locator(".qz-obr-rolev").textContent().catch(() => ""));
ok("'Maps to' answer rows render",
  (await insp.getByText("Maps to", { exact: false }).count()) >= 1 &&
  (await insp.locator(".qz-obr-row").count()) >= 1);
ok("read-only: no role-editing controls in the Rules body",
  (await insp.locator(".qz-obr select, .qz-obr input, .qz-crm-verb").count()) === 0);
const pointer = insp.locator("button", { hasText: "Open in Logic" });
ok("exactly one 'Open in Logic →' deep link", (await pointer.count()) === 1);

await insp.screenshot({ path: `${SHOTS}/rules-tab.png` }).catch(() => {});

// ── the deep link lands the Logic view scrolled to this question's row ──────
await pointer.click();
await page.waitForTimeout(1200);
ok("'Open in Logic →' navigates to the Logic view",
  (await page.locator('[data-testid="logic-tab-card"]').count()) === 1 ||
    (await page.locator(".qz-builder-rail-item.is-active", { hasText: "Logic" }).count()) === 1);
const focusRow = page.locator('[data-testid="logic-tab-card"] [data-node-id]').first();
if (await focusRow.count()) {
  const inView = await focusRow.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  });
  ok("a question row is scrolled into view (deep-link focus)", inView);
}

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
