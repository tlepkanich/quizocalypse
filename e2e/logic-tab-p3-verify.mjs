// Logic tab live-verify (UNIFIED one-window) — the question window replaces
// the role/set/narrows popovers; route menu + product-count popover remain.
// Against a LOCAL production build. Fixture: draft cmr7khgd50001vkhscvox8dgt
// (decider, local DB — not the deploy DB, never the byte-pinned doc).
//
// Interactions are LIVE CLICKS (a pointer-trapped overlay renders fine and is
// unclickable — repo landmine). The one real mutation is a role round-trip
// (Info only → Narrows → Info only, driven through the WINDOW SPINE) verified
// by READING THE DRAFT BACK through the builder UI state; the doc ends
// role:"qualifier" on a question that renders Info only either way.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-tab-p3-shots";

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
await page.waitForSelector(".qz-builder", { timeout: 15000 });
await page.waitForTimeout(1500);
await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
const card = page.locator('[data-testid="logic-tab-card"]');
const win = page.locator(".qz-crm.qz-qwin");

// ── UNIFIED — the role pill opens the question window (portal, live click) ──
await card.locator(".qz-ltab-pill-btn").first().click();
ok("pill opens the question window in a body portal", (await win.count()) === 1);
ok("window title is the question text", (await win.locator("h2").innerText()).length > 3);
ok("three panels (answers · spine · bank)", (await win.locator(".qz-crm-col").count()) === 3);
const jobs = await win.locator(".qz-crm-verb").allInnerTexts();
ok(
  "spine shows the three jobs",
  /Starting set/.test(jobs[0] ?? "") && /Narrows/.test(jobs[1] ?? "") && /Info only/.test(jobs[2] ?? ""),
  JSON.stringify(jobs.map((j) => j.split("\n")[0])),
);
await page.screenshot({ path: `${SHOTS}/question-window.png` });
await page.keyboard.press("Escape");
ok("Esc closes the window", (await win.count()) === 0);

// ── real mutation round-trip via the SPINE: Info only → Narrows → Info only ──
const infoPills = card.locator(".qz-ltab-pill-btn", { hasText: "Info only" });
const infoCount0 = await infoPills.count();
const infoPill = infoPills.first();
ok("an Info-only pill exists to flip", infoCount0 >= 1, `${infoCount0}`);
await infoPill.click();
ok("info window shows the not-used message", (await win.locator(".qz-qwin-infomsg").count()) === 1);
await win.locator(".qz-crm-verb", { hasText: "Narrows" }).click();
await page.waitForTimeout(300);
const narrowsPill = card.locator(".qz-ltab-pill-btn", { hasText: "Narrows ·" });
ok("pill flips to the derived Narrows label", (await narrowsPill.count()) === 1);
ok("spine shows the derived readout", (await win.locator(".qz-qwin-derived").count()) === 1);
await page.screenshot({ path: `${SHOTS}/narrows-flipped.png` });
// Mapping cells on that question now show the filter states.
// UNIFIED deltas — unset filter answers read "not mapped yet" ("pick
// anything" is gone); no_preference reads "keeps everything".
ok(
  "filter answers show not-mapped / keeps-everything states",
  (await card.locator(".qz-ltab-bad", { hasText: "not mapped yet" }).count()) > 0 ||
    (await card.locator(".qz-ltab-soft", { hasText: "keeps everything" }).count()) > 0,
);
// Flip back through the same window.
await win.locator(".qz-crm-verb", { hasText: "Info only" }).click();
await page.waitForTimeout(300);
ok("pill restores to Info only",
  (await card.locator(".qz-ltab-pill-btn", { hasText: "Info only" }).count()) === infoCount0);
await win.locator(".qz-btn-primary", { hasText: "Done" }).click();
ok("Done closes the window", (await win.count()) === 0);
await page.waitForTimeout(900); // autosave debounce settle

// ── reload: the round-trip PERSISTED through the autosave PUT ───────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 15000 });
await page.waitForTimeout(1200);
await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
ok(
  "after reload the question is still Info only (draft read-back)",
  (await card.locator(".qz-ltab-pill-btn", { hasText: "Info only" }).count()) === infoCount0,
);

// ── UNIFIED — a mapping cell opens the window FOCUSED on that answer ────────
const mapRows = card.locator("tbody tr").filter({ has: page.locator(".qz-qwin-mapcell") });
const mapRow = mapRows.nth(Math.min(1, (await mapRows.count()) - 1));
const answerText = (await mapRow.locator(".qz-ltab-answer").innerText()).trim();
await mapRow.locator(".qz-qwin-mapcell").click();
ok("mapping cell opens the window", (await win.count()) === 1);
ok(
  "window is focused on the clicked answer",
  (await win.locator(".qz-qwin-arow.is-on .qz-qwin-atext").innerText()).trim() === answerText,
  answerText,
);
await win.locator(".qz-btn-primary", { hasText: "Done" }).click();
await page.waitForTimeout(400); // let the previous window unmount

// ── UNIFIED — the Starting-set window: single-target Set pick (G9) ──────────
const startPill = card.locator(".qz-ltab-pill-btn", { hasText: "Starting set" }).first();
await startPill.click();
await win.waitFor({ state: "visible", timeout: 5000 });
await page.waitForTimeout(300);
ok(
  "decides window banks read Answers / What it opens",
  /What it opens/i.test(await win.locator(".qz-crm-col").last().innerText()),
);
// Focus a MAPPED answer (its left-bank row carries a target chip) so the
// bank shows its selected Set.
const mappedRow = win.locator(".qz-qwin-arow").filter({ has: page.locator(".qz-ltab-chip") }).first();
if ((await mappedRow.count()) > 0) await mappedRow.click();
ok(
  "the current target is marked in the set list",
  (await win.locator(".qz-crm-res.is-on").count()) >= 1,
);
await page.screenshot({ path: `${SHOTS}/starting-set-window.png` });
await win.locator(".qz-btn-primary", { hasText: "Done" }).click();

// ── §6.4 product popover behind the count (unchanged) ───────────────────────
const menu = page.locator(".qz-popover .qz-ltab-menu");
await card.locator(".qz-ltab-count .qz-ltab-cellbtn").first().click();
ok(
  "product popover opens (rows or the safety-net empty copy)",
  (await menu.locator(".qz-ltab-menu-product").count()) > 0 ||
    (await menu.locator(".qz-ltab-menu-none").count()) > 0,
);
await page.keyboard.press("Escape");

// ── §6.5 route menu — forward-only options (unchanged) ──────────────────────
await card.locator("tbody td:last-child .qz-ltab-cellbtn").first().click();
const routeRows = await menu.locator(".qz-ltab-menu-row").allInnerTexts();
ok(
  "route menu: next question first, results last",
  /next question/i.test(routeRows[0] ?? "") && /results/i.test(routeRows[routeRows.length - 1] ?? ""),
  JSON.stringify(routeRows),
);
// "The next question" for an answer already on the default = no-op commit.
await menu.locator(".qz-ltab-menu-row").first().click();
await page.waitForTimeout(300);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
