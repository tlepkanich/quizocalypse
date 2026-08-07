// Logic tab P2 live-verify — the read-only one-card Logic view
// (docs/design/logic-tab/HANDOFF.md §2/§3/§5, build order §13.1) against a
// LOCAL production build (BASE env, default http://localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — the card has
// no editing affordances in P2, so nothing to restore.
//
// Asserts: the Logic view renders the ONE card (Rules above Questions) · the
// Map/Table tabs and the global rules bar are GONE (Logic | Paths only) · the
// six-column questions table with role pills, mapping cells, product counts
// and route labels · rules render as sentences (or the §3.2 empty state with
// the switched-on count) · Paths tab still reachable · zero page errors.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-tab-p2-shots";

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

// ── auth + load ─────────────────────────────────────────────────────────────
await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 15000 });
await page.waitForTimeout(1500); // hydration settle

// ── open the Logic view ─────────────────────────────────────────────────────
await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
await page.waitForTimeout(400);

// ── the one card ────────────────────────────────────────────────────────────
const card = page.locator('[data-testid="logic-tab-card"]');
ok("the one card renders", (await card.count()) === 1);
ok("Rules header present", (await card.locator("h2", { hasText: "Rules" }).count()) === 1);
ok("Questions header present", (await card.locator("h2", { hasText: "Questions" }).count()) === 1);

// Old chrome gone: Logic | Paths only, no Map/Table tabs, no rules bar.
const tabLabels = await page.locator(".qz-logic-tab").allInnerTexts();
ok("tabs are Logic | Paths only", JSON.stringify(tabLabels) === JSON.stringify(["Logic", "Paths"]),
  JSON.stringify(tabLabels));
ok("global rules bar is gone", (await page.locator(".qz-logic-rules").count()) === 0);

// ── rules half: sentences or the §3.2 empty state ───────────────────────────
const ruleRows = await card.locator(".qz-ltab-rrow").count();
const emptyState = await card.locator(".qz-ltab-empty").count();
ok("rules render (rows or empty state, never both)",
  (ruleRows > 0) !== (emptyState > 0), `rows=${ruleRows} empty=${emptyState}`);
if (emptyState) {
  const t = await card.locator(".qz-ltab-empty").innerText();
  ok("empty state names the switched-on count or the all-off case",
    /switched-on question|no question is switched on/.test(t), t.slice(0, 80));
} else {
  const first = await card.locator(".qz-ltab-rrow").first().innerText();
  ok("rule row is a sentence (When they pick …)", /When they pick/.test(first), first.slice(0, 80));
}

// ── questions half: the six-column table ────────────────────────────────────
// CSS text-transform reflects into innerText — compare case-insensitively.
const heads = (await card.locator(".qz-ltab-tbl th").allInnerTexts()).map((h) =>
  h.trim().toLowerCase(),
);
ok("six columns, spec order",
  heads.length === 6 &&
    heads[0] === "question" && heads[2] === "answer" &&
    heads[3] === "shows / narrows" && heads[4] === "products" && heads[5] === "then go to",
  JSON.stringify(heads));

const qCells = await card.locator(".qz-ltab-qcell").count();
ok("every question renders a label cell", qCells > 0, `${qCells} questions`);
ok("exactly one ◆ Starting set pill (one decider per quiz)",
  (await card.locator(".qz-ltab-pill.is-start").count()) === 1);
const pills = await card.locator(".qz-ltab-pill").count();
ok("every question carries a role pill", pills === qCells, `${pills} pills / ${qCells} questions`);

// Mapping cells: the decider row shows target chips or a flagged gap.
const startRowChip = await card.locator(".qz-ltab-chip").count();
ok("mapping cells render chips somewhere", startRowChip > 0, `${startRowChip} chips`);

// Products column: at least one count cell with content.
const countTexts = (await card.locator(".qz-ltab-count").allInnerTexts()).filter((t) => t.trim());
ok("product counts render", countTexts.length > 0, countTexts.slice(0, 4).join(" | "));

// Route column: every answer row has a route label.
const routeable = await card
  .locator("tbody td:last-child")
  .evaluateAll((tds) => tds.filter((td) => td.textContent.trim().length > 0).length);
const answerRows = await card.locator("tbody tr").count();
ok("every answer row routes somewhere", routeable === answerRows, `${routeable}/${answerRows}`);

await page.screenshot({ path: `${SHOTS}/logic-card.png`, fullPage: true });

// ── Paths diagnostics tab still reachable ───────────────────────────────────
await page.locator(".qz-logic-tab", { hasText: "Paths" }).click();
await page.waitForTimeout(600);
ok("Paths tab renders the paths projection", (await page.locator(".qz-paths").count()) > 0);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
