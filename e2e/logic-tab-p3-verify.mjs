// Logic tab P3 live-verify — the five §6 popovers wired to real mutations,
// against a LOCAL production build. Fixture: draft cmr7khgd50001vkhscvox8dgt
// (decider, local DB — not the deploy DB, never the byte-pinned doc).
//
// Interactions are LIVE CLICKS (a pointer-trapped overlay renders fine and is
// unclickable — repo landmine). The one real mutation is a role round-trip
// (Info only → Narrows·Anything → Info only) verified by READING THE DRAFT
// BACK through the builder UI state; the doc ends role:"qualifier" on a
// question that renders Info only either way.
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

// ── §6.1 role menu opens on a LIVE click (portal, not pointer-trapped) ──────
await card.locator(".qz-ltab-pill-btn").first().click();
const menu = page.locator(".qz-popover .qz-ltab-menu");
ok("role menu opens in a body portal", (await menu.count()) === 1);
ok("role menu title is the question text", (await menu.locator(".qz-ltab-menu-title").innerText()).length > 3);
const rows = await menu.locator(".qz-ltab-menu-row").allInnerTexts();
ok("three jobs, one flat list", /Starting set/.test(rows[0] ?? "") && /Info only/.test(rows[1] ?? "") && /Narrows/.test(rows[2] ?? ""), JSON.stringify(rows.slice(0, 3)));

// Expand Narrows in place: Anything + kind chips + field search.
await menu.locator(".qz-ltab-menu-row", { hasText: "Narrows" }).click();
ok("Narrows expands in place (Anything row)", (await menu.locator(".qz-ltab-menu-row", { hasText: "Anything" }).count()) === 1);
ok("field search present", (await menu.locator(".qz-ltab-menu-search").count()) === 1);
await page.screenshot({ path: `${SHOTS}/role-menu.png` });
await page.keyboard.press("Escape");
ok("Esc closes the menu", (await menu.count()) === 0);

// ── real mutation round-trip: Info only → Narrows·Anything → Info only ──────
const infoPill = card.locator(".qz-ltab-pill-btn", { hasText: "Info only" }).first();
ok("an Info-only pill exists to flip", (await infoPill.count()) === 1);
await infoPill.click();
await menu.locator(".qz-ltab-menu-row", { hasText: "Narrows" }).click();
await menu.locator(".qz-ltab-menu-row.is-indent", { hasText: "Anything" }).click();
await page.waitForTimeout(300);
const narrowsPill = card.locator(".qz-ltab-pill-btn", { hasText: "Narrows · Anything" });
ok("pill flips to Narrows · Anything", (await narrowsPill.count()) === 1);
// Mapping cells on that question now show the filter states.
// §5.2 — Anything mode invites "pick anything"; field mode flags
// "not mapped yet"; no_preference reads "keeps everything".
ok("filter answers show pick-anything / not-mapped / keeps-everything states",
  (await card.locator(".qz-ltab-bad", { hasText: "pick anything" }).count()) > 0 ||
  (await card.locator(".qz-ltab-bad", { hasText: "not mapped yet" }).count()) > 0 ||
  (await card.locator(".qz-ltab-soft", { hasText: "keeps everything" }).count()) > 0);
await page.screenshot({ path: `${SHOTS}/narrows-flipped.png` });
// Flip back.
await narrowsPill.click();
await menu.locator(".qz-ltab-menu-row", { hasText: "Info only" }).click();
await page.waitForTimeout(900); // autosave debounce settle
ok("pill restores to Info only", (await card.locator(".qz-ltab-pill-btn", { hasText: "Info only" }).count()) === 1);

// ── reload: the round-trip PERSISTED through the autosave PUT ───────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 15000 });
await page.waitForTimeout(1200);
await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
ok("after reload the question is still Info only (draft read-back)",
  (await card.locator(".qz-ltab-pill-btn", { hasText: "Info only" }).count()) === 1);

// ── §6.2 set menu on the Starting-set row ───────────────────────────────────
const chipBtn = card.locator(".qz-ltab-chip-btn").first();
await chipBtn.click();
ok("set menu opens with a search + category rows",
  (await menu.locator(".qz-ltab-menu-search").count()) === 1 &&
  (await menu.locator(".qz-ltab-menu-row").count()) > 0);
const currentRow = menu.locator(".qz-ltab-menu-row.is-current");
ok("current target is marked", (await currentRow.count()) === 1);
// Re-pick the SAME target — a commit that changes nothing (restore-free).
await currentRow.click();
await page.waitForTimeout(300);
ok("re-picking the current target keeps the chip", (await card.locator(".qz-ltab-chip-btn").first().count()) === 1);

// ── §6.4 product popover behind the count ───────────────────────────────────
await card.locator(".qz-ltab-count .qz-ltab-cellbtn").first().click();
ok("product popover opens (rows or the safety-net empty copy)",
  (await menu.locator(".qz-ltab-menu-product").count()) > 0 ||
  (await menu.locator(".qz-ltab-menu-none").count()) > 0);
await page.keyboard.press("Escape");

// ── §6.5 route menu — forward-only options ──────────────────────────────────
await card.locator("tbody td:last-child .qz-ltab-cellbtn").first().click();
const routeRows = await menu.locator(".qz-ltab-menu-row").allInnerTexts();
ok("route menu: next question first, results last",
  /next question/i.test(routeRows[0] ?? "") && /results/i.test(routeRows[routeRows.length - 1] ?? ""),
  JSON.stringify(routeRows));
// "The next question" for an answer already on the default = no-op commit.
await menu.locator(".qz-ltab-menu-row").first().click();
await page.waitForTimeout(300);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
