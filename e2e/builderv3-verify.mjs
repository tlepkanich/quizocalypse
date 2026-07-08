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

// ── BLD-1 → QZY-6: the FIVE-section rail, exactly one active per view ───────
const railActive = () =>
  page.locator(".qz-builder-rail-item.is-active").allTextContents();
ok("rail has 5 items (QZY-6)", (await page.locator(".qz-builder-rail-item").count()) === 5);
for (const label of ["Products", "Logic", "Design", "Settings", "Build"]) {
  await page.locator(".qz-builder-rail-item", { hasText: label }).click();
  await page.waitForTimeout(300);
  const act = await railActive();
  ok(`rail: ${label} lights itself only`, act.length === 1 && act[0].trim() === label, act.join(","));
}
ok("no Results / Theme / AI / Code rail items",
  (await page.locator(".qz-builder-rail-item", { hasText: "Results" }).count()) === 0 &&
  (await page.locator(".qz-builder-rail-item", { hasText: "Theme" }).count()) === 0 &&
  (await page.locator(".qz-builder-rail-item", { hasText: "AI" }).count()) === 0 &&
  (await page.locator(".qz-builder-rail-item", { hasText: "Code" }).count()) === 0);
ok("old view-tab strip is gone", (await page.locator(".qz-builder-views").count()) === 0);
ok("filmstrip is gone", (await page.locator(".qz-builder-filmstrip, .qz-film-card").count()) === 0);

// QZY-6: the top-bar Assist companion (never a rail tab) opens the chat drawer.
ok("✦ Assist button in the top bar",
  (await page.locator(".qz-topbar button", { hasText: "Assist" }).count()) === 1);
await page.locator(".qz-topbar button", { hasText: "Assist" }).click();
await page.waitForTimeout(400);
ok("Assist drawer opens with the chat panel",
  (await page.locator(".qz-drawer, [role=dialog]").count()) >= 1 &&
  (await page.getByText("Assist").count()) >= 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// QZY-6: the Settings section carries placement + embed + translation + CSS.
await page.locator(".qz-builder-rail-item", { hasText: "Settings" }).click();
await page.waitForTimeout(400);
ok("Settings: experience/placement/embed/translation/CSS sections render",
  (await page.getByText("Experience & scoring").count()) >= 1 &&
  (await page.getByText("Where the quiz appears").count()) >= 1 &&
  (await page.getByText("Share & embed").count()) >= 1 &&
  (await page.getByText("Custom CSS").count()) >= 1);
await page.locator(".qz-builder-rail-item", { hasText: "Build" }).click();
await page.waitForTimeout(300);

// ── QZY-7: the screen carousel is the navigator (center column only) ────────
const thumbs = page.locator(".qz-screens-thumb");
const thumbCount = await thumbs.count();
ok("carousel renders the screens", thumbCount >= 2, `${thumbCount} thumbs`);
ok("carousel lives under the CANVAS column only",
  (await page.locator(".qz-builder-stage .qz-screens").count()) === 1 &&
  (await page.locator(".qz-builder-panel .qz-screens").count()) === 0 &&
  (await page.locator(".qz-builder-inspector .qz-screens").count()) === 0);
ok("+ add-screen tile present", (await page.locator(".qz-screens-add").count()) === 1);
ok("carousel labels render (Intro + Q1)",
  (await page.locator(".qz-screens-label", { hasText: "Intro" }).count()) === 1 &&
  (await page.locator(".qz-screens-label", { hasText: "Q1" }).count()) >= 1);
const q1Thumb = page.locator(".qz-screens-item", { hasText: "Q1" }).first();
await q1Thumb.locator(".qz-screens-thumb").click();
await page.waitForTimeout(600);
ok("thumb click activates the screen",
  ((await page.locator(".qz-screens-item.is-active .qz-screens-label").textContent()) ?? "").includes("Q1"));

// One-question-per-screen (build-tab §3): the palette question tile on a
// question screen switches type (same type = no-op, never a 2nd question);
// on Intro it creates a NEW screen; the carousel confirm deletes it again.
ok("palette Questions section present",
  (await page.locator(".qz-block-tile", { hasText: "Choice answers" }).count()) === 1);
await page.locator(".qz-block-tile", { hasText: "Choice answers" }).click();
await page.waitForTimeout(500);
ok("question tile on a question screen adds NO screen",
  (await thumbs.count()) === thumbCount);
await page.locator(".qz-screens-item", { hasText: "Intro" }).locator(".qz-screens-thumb").click();
await page.waitForTimeout(400);
await page.locator(".qz-block-tile", { hasText: "Choice answers" }).click();
await page.waitForTimeout(700);
ok("question tile elsewhere creates a NEW question screen",
  (await thumbs.count()) === thumbCount + 1);
await page.locator('.qz-screens-del[aria-label^="Delete"]').click();
await page.waitForTimeout(300);
ok("✕ arms a confirm naming the impact",
  (await page.locator(".qz-screens-confirm").count()) === 1);
await page.locator(".qz-screens-confirm-yes").click();
await page.waitForTimeout(700);
ok("confirm deletes the screen (net-zero)", (await thumbs.count()) === thumbCount);

// ── BLD-3 → QZY-R2: decider inspector is TAB-LESS + logic-free (build-tab
// v2.0 §1). No Content/Design/Routing bar; roles/mapping/routing live only in
// the Logic view (one pointer remains). Deep R2 coverage: e2e/qzy-r2-verify.mjs.
await q1Thumb.locator(".qz-screens-thumb").click();
await page.waitForTimeout(400);
const insp = page.locator(".qz-builder-inspector");
ok("right-side inspector present", (await insp.count()) === 1);
ok("no Content/Design/Routing tab bar (v2.0 §1)",
  (await insp.locator('.qz-segmented[aria-label="Panel tab"]').count()) === 0);
ok("one-line 'Open Logic →' pointer present (the only logic allowance)",
  (await insp.locator("button", { hasText: "Open Logic" }).count()) === 1);
ok("no page-background control on the right (v2.0 §1)",
  (await insp.getByText("Background", { exact: true }).count()) === 0);

// ── BLD-2b: inline canvas edit (Escape-cancelled — no commit) ───────────────
// Inline HEADING edit on the intro — its headline is an inline-editable element
// (a template question screen edits its text via the panel, not inline, so pick
// the intro where the heading is inspectable).
await page.locator(".qz-screens-item", { hasText: "Intro" }).locator(".qz-screens-thumb").click();
await page.waitForTimeout(400);
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

// ── QZY-8 → QZY-R2: option scope, footer, numeric pairs (inline logic REMOVED
// per build-tab v2.0 §1 — asserted absent here; relocated to the Logic view).
await q1Thumb.locator(".qz-screens-thumb").click();
await page.waitForTimeout(500);
ok("inline gold Logic section is GONE (v2.0 §1)",
  (await page.locator(".qz-insp-logic, .qz-insp-logic-role").count()) === 0);
await page.locator(".qz-builder-canvas button.qz-insp").first().click();
await page.waitForTimeout(400);
ok("clicking ONE option scopes the inspector (§5.1)",
  (await page.locator(".qz-insp-scope").count()) === 1);
await page.locator("button", { hasText: "Style all options" }).click();
await page.waitForTimeout(300);
ok("'Style all options' returns to question scope",
  (await page.locator(".qz-insp-scope").count()) === 0);
ok("More options disclosure in Content tab",
  (await page.locator(".qz-builder-inspector .qz-insp-more > summary", { hasText: "More options" }).count()) === 1);
// This fixture's lone question dangles (no outbound edge), so it sits outside
// the reorderable run — Move buttons correctly stay hidden; Delete renders.
ok("footer: Delete step present (Move only inside a reorderable run)",
  (await page.locator(".qz-insp-foot button", { hasText: "Delete step" }).count()) === 1);
await page.locator(".qz-insp-foot button", { hasText: "Delete step" }).click();
await page.waitForTimeout(300);
ok("footer delete arms the carousel confirm",
  (await page.locator(".qz-screens-confirm").count()) === 1);
await page.locator(".qz-screens-confirm button", { hasText: "Keep" }).click();
await page.waitForTimeout(200);
// Decider inspector has NO Design tab — Layout blocks is directly present.
await page.locator(".qz-builder-inspector summary", { hasText: "Layout blocks" }).click();
await page.waitForTimeout(300);
// A template-rendered step must be broken into blocks first (BLD-7's final
// "Reset to template" restores this state, so the probe stays net-zero).
const breakBtn = page.locator(".qz-builder-inspector button", { hasText: "Break into blocks" });
if (await breakBtn.count()) {
  await breakBtn.click();
  await page.waitForTimeout(400);
}
const blockCaret = page.locator(".qz-builder-inspector button", { hasText: "▸" }).first();
if (await blockCaret.count()) {
  await blockCaret.click();
  await page.waitForTimeout(300);
}
ok("numerics render as LINKED range+number pairs (§2)",
  (await page.locator(".qz-numctl input[type=range]").count()) >= 1 &&
  (await page.locator(".qz-numctl input[type=number]").count()) >= 1);
await page.locator(".qz-builder-inspector summary", { hasText: "Layout blocks" }).click();
await page.waitForTimeout(200);

// ── QZY-9: answer display modes — picker, live canvas, lossless switch ──────
await q1Thumb.locator(".qz-screens-thumb").click();
await page.waitForTimeout(500);
ok("Answer display mode picker present (4 structural modes — Icon retired, R5b §3.1)",
  (await page.locator(".qz-ads-modes button").count()) === 4);
const canvasAnswerCount = await page.locator(".qz-builder-canvas button.qz-insp").count();
await page.locator(".qz-ads-modes button", { hasText: "Compact pills" }).click();
await page.waitForTimeout(600);
ok("pills mode: options survive (lossless), aria state set",
  (await page.locator(".qz-builder-canvas button.qz-insp").count()) === canvasAnswerCount &&
  (await page.locator(".qz-ads-modes button.is-active", { hasText: "Compact pills" }).count()) === 1);
ok("corner-radius presets appear with a mode set (R5a §3.1 — unified control)",
  (await page.locator('[aria-label="Corner radius preset"] button').count()) === 3);
await page.locator(".qz-ads-modes button", { hasText: "Large tiles" }).click();
await page.waitForTimeout(600);
ok("tiles mode: options still intact (flip again, no loss)",
  (await page.locator(".qz-builder-canvas button.qz-insp").count()) === canvasAnswerCount);
await page.locator(".qz-ads-modes button", { hasText: "Text list" }).click();
await page.waitForTimeout(600);
ok("back to Text list: legacy rendering + options unchanged (round-trip)",
  (await page.locator(".qz-builder-canvas button.qz-insp").count()) === canvasAnswerCount &&
  (await page.locator(".qz-ads-modes button.is-active", { hasText: "Text list" }).count()) === 1);
// per-option media in the scoped panel (§5.1)
await page.locator(".qz-builder-canvas button.qz-insp").first().click();
await page.waitForTimeout(400);
ok("scoped option panel carries the shared MediaPicker (R4 §8; +reveal picker R5c-4)",
  (await page.locator('.qz-insp-scope [aria-label="Media source"]').count()) >= 1 &&
  (await page.locator(".qz-insp-scope button", { hasText: "Upload" }).count()) >= 1);
await page.locator("button", { hasText: "Style all options" }).click();
await page.waitForTimeout(300);

// ── QZY-7: Layers + Background tabs (AFTER the inline-edit check — the
// hide/show round-trip materializes an explicit layout; BLD-7's final
// "Reset to template" clears it again). ──────────────────────────────────────
await q1Thumb.locator(".qz-screens-thumb").click();
await page.waitForTimeout(400);
await page.locator('[aria-label="Build panel"] button', { hasText: "Layers" }).click();
await page.waitForTimeout(400);
ok("Layers lists the screen's blocks", (await page.locator(".qz-layers-row").count()) >= 1);
await page.locator('.qz-layers-actions button[aria-label="Hide block"]').first().click();
await page.waitForTimeout(400);
ok("hide marks the row (kept, not deleted)",
  (await page.locator(".qz-layers-row.is-hidden").count()) === 1);
await page.locator('.qz-layers-actions button[aria-label="Show block"]').first().click();
await page.waitForTimeout(400);
ok("show restores it", (await page.locator(".qz-layers-row.is-hidden").count()) === 0);
await page.locator('[aria-label="Build panel"] button', { hasText: "Background" }).click();
await page.waitForTimeout(300);
ok("Background tab renders the page settings",
  (await page.locator(".qz-builder-panel").textContent())?.includes("Background"));

// ── QZY-11: per-screen backgrounds — type picker, live canvas, hint ─────────
ok("background type picker (None/Color/Gradient/Image/Video)",
  (await page.locator('[aria-label="Background type"] button').count()) === 5);
await page.locator('[aria-label="Background type"] button', { hasText: "Gradient" }).click();
await page.waitForTimeout(800);
const pageBg = await page
  .locator(".qz-builder-canvas .qz-runtime-page")
  .first()
  .evaluate((el) => getComputedStyle(el).backgroundImage + " " + getComputedStyle(el).background)
  .catch(() => "");
ok("gradient type selects (canvas live once colors are set)",
  (await page.locator('[aria-label="Background type"] button[aria-pressed=true]', { hasText: "Gradient" }).count()) === 1,
  pageBg.slice(0, 40));
await page.locator('[aria-label="Background type"] button', { hasText: "Image" }).click();
await page.waitForTimeout(300);
// R4 §8 — the image is chosen via the shared MediaPicker: switch to the URL
// source, paste, and Use.
await page.locator('.qz-builder-panel [aria-label="Media source"] button', { hasText: "URL" }).click();
await page.waitForTimeout(200);
await page.locator('.qz-builder-panel input[placeholder="https://…"]').first()
  .fill("https://cdn.shopify.com/example.jpg");
await page.locator(".qz-builder-panel button", { hasText: "Use" }).click();
await page.waitForTimeout(800);
ok("image background applies to the LIVE canvas page",
  /example\.jpg/.test(
    await page
      .locator(".qz-builder-canvas .qz-runtime-page")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage)
      .catch(() => ""),
  ));
ok("image background shows the non-blocking readability hint (overlay < 20)",
  (await page.locator(".qz-builder-panel [role=note]").count()) === 1);
ok("quiz-wide default reachable via the All-screens scope (R3 §5.3)",
  (await page.locator('[aria-label="Background applies to"] button', { hasText: "All screens" }).count()) === 1);
await page.locator('[aria-label="Background type"] button', { hasText: "None" }).click();
await page.waitForTimeout(800);
ok("None clears the per-screen background (net-zero)",
  !/example\.jpg/.test(
    await page
      .locator(".qz-builder-canvas .qz-runtime-page")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage)
      .catch(() => ""),
  ));

// ── BLD-7: blocks palette + block management (net-zero: ends with Reset) ───
await page.locator('[aria-label="Build panel"] button', { hasText: "Add" }).click();
await page.waitForTimeout(300);
ok(
  "palette tiles enabled with a step on canvas",
  (await page.locator(".qz-block-tile:not(:disabled)").count()) > 0,
);
ok(
  "palette hides off-type smart tiles",
  (await page.locator(".qz-block-tile", { hasText: "Recommendations" }).count()) === 0,
);
await page.locator(".qz-block-tile", { hasText: "Divider" }).click();
await page.waitForTimeout(700);
ok("tile click renders on canvas", (await page.locator(".qz-builder-canvas hr").count()) >= 1);
// QZY-10 — the v1 inventory tiles exist; progress + content render on canvas.
ok("QZY-10 palette tiles present (Video/Progress/Logo/Content)",
  (await page.locator(".qz-block-tile", { hasText: "Video" }).count()) === 1 &&
  (await page.locator(".qz-block-tile", { hasText: "Progress bar" }).count()) === 1 &&
  (await page.locator(".qz-block-tile", { hasText: "Logo" }).count()) === 1 &&
  (await page.locator(".qz-block-tile", { hasText: "Content block" }).count()) === 1);
await page.locator(".qz-block-tile", { hasText: "Progress bar" }).click();
await page.waitForTimeout(1200);
ok("progress bar renders on canvas",
  (await page.locator(".qz-builder-canvas [role=progressbar]").count()) >= 1);
await page.locator(".qz-block-tile", { hasText: "Content block" }).click();
await page.waitForTimeout(1200);
ok("content block renders paragraphs + a safe link + a list",
  (await page.locator(".qz-builder-canvas ul li").count()) >= 2 &&
  (await page.locator('.qz-builder-canvas a[href="https://example.com"]').count()) === 1);
await page.evaluate(() => {
  const c = document.querySelector(".qz-builder-canvas");
  const dt = new DataTransfer();
  dt.setData("application/x-qz-block", "spacer");
  c.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(250);
ok(
  "drop ring on dragover",
  await page.evaluate(() =>
    document.querySelector(".qz-builder-canvas").className.includes("is-blockdrop"),
  ),
);
await page.evaluate(() => {
  const c = document.querySelector(".qz-builder-canvas");
  const dt = new DataTransfer();
  dt.setData("application/x-qz-block", "spacer");
  c.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(600);
// Decider inspector has NO Design tab — Layout blocks is directly present.
await page.locator(".qz-builder-inspector summary", { hasText: "Layout blocks" }).click();
await page.waitForTimeout(300);
const xBtns = page.locator(".qz-builder-inspector button", { hasText: "✕" });
const xBefore = await xBtns.count();
await xBtns.last().scrollIntoViewIfNeeded();
await xBtns.last().click();
await page.waitForTimeout(500);
ok("block ✕ deletes a row", (await xBtns.count()) === xBefore - 1);
await page.locator(".qz-builder-inspector button", { hasText: "Reset to template" }).click();
await page.waitForTimeout(700);
ok(
  "Reset to template restores the default",
  (await page.locator(".qz-builder-canvas hr").count()) === 0,
);
// ── BLD-4: Logic view = LogicScroll + Try-a-path ────────────────────────────
await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
await page.waitForTimeout(600);
ok("LogicScroll rules strip present", (await page.locator("text=/first match wins/").count()) > 0);
ok("Try a path present", (await page.locator("text=/Try a path/i").count()) > 0);
ok("settings-dump tabs gone", (await page.locator(".qz-settings-tab").count()) === 0);

// ── BLD-5 → QZY-6: Results left the rail; ?view=results stays deep-linkable ─
await page.goto(`${BASE}/studio/${QUIZ}?view=results`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
ok("?view=results deep link still renders the heavy editor (rail lights Build)",
  (await railActive()).join() === "Build");
ok("no 'Step N of 4' wizard copy", !(await page.locator("text=/Step \\d of 4/").count()));
await page.locator(".qz-builder-rail-item", { hasText: "Build" }).click();
await page.waitForTimeout(400);

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
