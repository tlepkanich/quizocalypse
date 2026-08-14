// Logic tab P2 live-verify — the Logic view (docs/design/logic-tab/HANDOFF.md
// §2/§3/§5 + QRTZ-G3 two-card form) against a LOCAL production build
// (BASE env, default http://localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — nothing to
// restore.
//
// Asserts (QRTZ-G3): the Logic view renders the artifact's TWO stacked cards
// (Rules, then Questions) and nothing else — the teaching note, the
// Logic|Paths tab pair, the Map/Table chrome and the global rules bar are all
// GONE · the six-column questions table with role pills, mapping cells,
// product counts and route labels · rules render as sentences (or the §3.2
// empty state with the switched-on count) · Paths still reachable behind the
// quiet "Explore every path →" link · zero page errors.
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

// ── the two cards (QRTZ-G3 — the artifact's Rules + Questions, stacked) ─────
const card = page.locator('[data-testid="logic-tab-card"]');
ok("the card stack renders", (await card.count()) === 1);
ok("two stacked cards inside the stack",
  (await card.locator("section.qz-ltab").count()) === 2);
ok("Rules header on the FIRST card",
  (await card.locator("section.qz-ltab").first().locator("h2", { hasText: "Rules" }).count()) === 1);
ok("Questions header on the SECOND card",
  (await card.locator("section.qz-ltab").nth(1).locator("h2", { hasText: "Questions" }).count()) === 1);
// QRTZ-G3 — the teaching note is retired (the card meta sentences teach now).
ok("the nothing-is-ever-deleted note is gone",
  (await page.locator(".qz-ltab-note").count()) === 0);

// Old chrome gone: NO tabs at all (QRTZ-G3), no Map/Table chrome, no rules bar.
ok("the Logic|Paths tab pair is gone", (await page.locator(".qz-logic-tab").count()) === 0);
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

// ── questions half: the mock's FIVE-column table (QRTZ-H3) ──────────────────
// CSS text-transform reflects into innerText — compare case-insensitively.
const heads = (await card.locator(".qz-ltab-tbl thead th").allInnerTexts()).map((h) =>
  h.trim().toLowerCase(),
);
ok("five columns, mock order (shared.mjs 379–387)",
  heads.length === 5 &&
    heads[0] === "question" && heads[1] === "answer" &&
    heads[2] === "maps to" && heads[3] === "products" && heads[4] === "then go to",
  JSON.stringify(heads));
// QRTZ-H3 — the A/B/C key renders INSIDE the Answer cell (mock .akey).
ok("answer keys render inside the answer cells",
  (await card.locator(".qz-ltab-answer .qz-ltab-akey").count()) > 0);

const qCells = await card.locator(".qz-ltab-qcell").count();
ok("every question renders a label cell", qCells > 0, `${qCells} questions`);
ok("exactly one Picks-the-result pill (one decider per quiz)",
  (await card.locator(".qz-ltab-pill.is-start").count()) === 1);
const pills = await card.locator(".qz-ltab-pill").count();
ok("every question carries a role pill", pills === qCells, `${pills} pills / ${qCells} questions`);

// Mapping cells: the mock's .tag treatment (QRTZ-H3) — is-col / value tags /
// the is-none "No filter" form.
const startRowTag = await card.locator(".qz-ltab-tag").count();
ok("mapping cells render mock tags somewhere", startRowTag > 0, `${startRowTag} tags`);

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

// ── Paths still reachable behind the quiet link (QRTZ-G3 — no tabs) ─────────
const pathsLink = page.locator(".qz-ltab-pathslink");
ok("the quiet path-explorer link renders below the cards", (await pathsLink.count()) === 1);
await pathsLink.click();
await page.waitForTimeout(600);
ok("the link opens the paths projection", (await page.locator(".qz-paths").count()) > 0);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
