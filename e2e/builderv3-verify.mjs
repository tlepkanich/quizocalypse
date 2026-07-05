// BLD-1…5 live-verify — the V3 standalone builder chrome against a LOCAL
// production build (BASE env, default http://localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY: every
// interaction is selection/navigation/menu-open or an Escape-cancelled edit —
// no doc commit fires, so there is nothing to restore (the BLD-2 mutation
// paths were hand-verified with a DB read-back when they shipped).
//
// Asserts: V2 top bar (one wordmark · single-line title · health pill ·
// tri-state Publish opens the popover · jump-link lands in the inspector) ·
// ONE nav rail with exactly-one-active per view (the Logic≠Settings fix) ·
// v3 step rows + portaled ⋯ menu · right-side inspector with unclipped tabs ·
// Escape-cancelled inline canvas edit · LogicScroll + Try-a-path in the Logic
// view · Results empty state leads with a working CTA · no wizard "Step N of
// 4" leaks · dark-mode toggle flips the html attr · an axe-core pass on the
// Build view (prints violations; fails on >0 critical) · zero page errors.
// Replaces scripts/audit/builder-audit.mjs (pre-BLD selectors).
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/builderv3-shots";

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

// ── auth + load ──────────────────────────────────────────────────────────────
await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 15000 });
await page.waitForTimeout(1500); // hydration settle

// ── BLD-1: top bar + health ─────────────────────────────────────────────────
ok("top bar is the V2 primitive", await page.locator(".qz-topbar--builder").count() === 1);
ok("exactly one wordmark", await page.locator(".qz-wordmark").count() === 1);
const titleBox = await page.locator(".qz-builder-titlewrap").boundingBox();
ok("title renders on one line", !!titleBox && titleBox.height < 30, `h=${titleBox?.height}`);
const pill = page.locator(".qz-s3-healthpill");
ok("health pill present", (await pill.count()) === 1, await pill.textContent());
ok("no legacy nag banner", !(await page.locator("text=/to fix before publishing/").count()));

const pillText = (await pill.textContent()) ?? "";
if (/blocking/.test(pillText)) {
  const fixBtn = page.locator("button", { hasText: /^Fix \d+ issue/ });
  ok("tri-state Publish shows Fix N issues", (await fixBtn.count()) === 1);
  await fixBtn.click();
  await page.waitForTimeout(400);
  ok("blocked Publish opens the health popover", (await page.locator(".qz-s3-health").count()) === 1);
  const goto = page.locator(".qz-s3-health .qz-ql-report-goto").first();
  if (await goto.count()) {
    await goto.click();
    await page.waitForTimeout(500);
    ok(
      "jump-link lands with the inspector populated",
      (await page.locator(".qz-builder-inspector textarea, .qz-builder-inspector input").count()) > 0,
    );
  }
} else {
  ok("healthy doc shows ◆ Publish", (await page.locator("button", { hasText: "Publish" }).count()) > 0);
}

// ── BLD-1: one rail, exactly one active per view ────────────────────────────
const railActive = () =>
  page.locator(".qz-builder-rail-item.is-active").allTextContents();
ok("rail has 7 items", (await page.locator(".qz-builder-rail-item").count()) === 7);
for (const label of ["Products", "Results", "Logic", "Theme", "AI", "Code", "Build"]) {
  await page.locator(".qz-builder-rail-item", { hasText: label }).click();
  await page.waitForTimeout(300);
  const act = await railActive();
  ok(`rail: ${label} lights itself only`, act.length === 1 && act[0].trim() === label, act.join(","));
}
ok("old view-tab strip is gone", (await page.locator(".qz-builder-views").count()) === 0);
ok("filmstrip is gone", (await page.locator(".qz-builder-filmstrip, .qz-film-card").count()) === 0);

// ── BLD-2a: v3 step rows + ⋯ menu ───────────────────────────────────────────
const rows = page.locator(".qz-s3-row.qz-railrow");
ok("v3 step rows render", (await rows.count()) >= 2, `${await rows.count()} rows`);
ok("rows carry mono chips", (await page.locator(".qz-railrow .qz-s3-numchip").count()) >= 2);
const qRow = page.locator(".qz-s3-row", { hasText: "What are you shopping" }).first();
await qRow.locator(".qz-railmenu-btn").click({ force: true });
await page.waitForTimeout(300);
ok("⋯ opens the portaled actions menu", (await page.locator(".qz-railmenu").count()) === 1);
ok(
  "menu holds the classic inline actions",
  (await page.locator(".qz-railmenu-item", { hasText: "Rename" }).count()) === 1 &&
    (await page.locator(".qz-railmenu-item", { hasText: "Duplicate" }).count()) === 1,
);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ── BLD-3: right inspector, unclipped tabs ──────────────────────────────────
await qRow.click();
await page.waitForTimeout(400);
const insp = page.locator(".qz-builder-inspector");
ok("right-side inspector present", (await insp.count()) === 1);
const inspBox = await insp.boundingBox();
let clipped = false;
for (const t of ["Content", "Design", "Routing"]) {
  const b = await insp.locator("button", { hasText: t }).first().boundingBox();
  if (!b || !inspBox || b.x + b.width > inspBox.x + inspBox.width + 1) clipped = true;
}
ok("inspector tabs fit (no clip)", !clipped);

// ── BLD-2b: inline canvas edit (Escape-cancelled — no commit) ───────────────
const canvasHead = page.locator(".qz-builder-canvas h1, .qz-builder-canvas h2").first();
await canvasHead.click();
await page.waitForTimeout(300);
const selEl = page.locator(".qz-insp-sel").first();
if (await selEl.count()) {
  await selEl.dblclick();
  await page.waitForTimeout(300);
  const editable = await selEl.evaluate((el) => el.isContentEditable);
  ok("dblclick starts an inline edit", editable);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok("Escape cancels it", !(await selEl.evaluate((el) => el.isContentEditable)));
} else {
  ok("canvas element selectable for inline edit", false, "no .qz-insp-sel after click");
}

// ── BLD-4: Logic view = LogicScroll + Try-a-path ────────────────────────────
await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
await page.waitForTimeout(600);
ok("LogicScroll rules strip present", (await page.locator("text=/first match wins/").count()) > 0);
ok("Try a path present", (await page.locator("text=/Try a path/i").count()) > 0);
ok("settings-dump tabs gone", (await page.locator(".qz-settings-tab").count()) === 0);

// ── BLD-5: Results empty state leads + CTA; no wizard leaks ────────────────
await page.locator(".qz-builder-rail-item", { hasText: "Results" }).click();
await page.waitForTimeout(600);
const empty = page.locator("text=No result pages yet").first();
if (await empty.count()) {
  const emptyBox = await empty.boundingBox();
  const layoutBox = await page.locator("text=Layout").first().boundingBox();
  ok("empty state sits ABOVE the layout controls", !!emptyBox && !!layoutBox && emptyBox.y < layoutBox.y);
  await page.locator("button", { hasText: "Go to Products" }).click();
  await page.waitForTimeout(400);
  ok("empty-state CTA lands on Products", (await railActive()).join() === "Products");
}
ok("no 'Step N of 4' wizard copy", !(await page.locator("text=/Step \\d of 4/").count()));

// ── BLD-6: dark toggle + axe ────────────────────────────────────────────────
await page.locator(".qz-builder-rail-item", { hasText: "Build" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/build-light.png`, fullPage: false });
await page.locator('button[aria-label*="dark mode"]').click();
await page.waitForTimeout(400);
ok(
  "dark toggle flips html[data-theme]",
  (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark",
);
await page.screenshot({ path: `${SHOTS}/build-dark.png`, fullPage: false });
await page.locator('button[aria-label*="light mode"]').click();

const axeSource = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
await page.evaluate(axeSource);
const axe = await page.evaluate(async () => {
  const r = await window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  });
  return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
});
const critical = axe.filter((v) => v.impact === "critical");
console.log(
  `axe (build view): ${axe.length} violation type(s) —`,
  axe.map((v) => `${v.id}(${v.impact}×${v.nodes})`).join(", ") || "none",
);
ok("axe: zero CRITICAL violations", critical.length === 0, JSON.stringify(critical));

// ── errors ──────────────────────────────────────────────────────────────────
ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ axe, pageErrors }, null, 2));
await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
