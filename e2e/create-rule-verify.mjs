// Create-a-rule ONE-SCREEN modal live-verify (create-rule handoff §7) against
// a LOCAL production build + local DB. Fixture: cmr7khgd50001vkhscvox8dgt
// (decider · q1 single-select · q2 multi-select · q3 rating · 3 groups ·
// 1 rule on QS Boards).
//
// Drives BOTH flows: the funnel Logic step (flow="onboarding" — the
// recommendation groups ARE the band, with coverage) and the standalone
// builder's Logic view (flow="builder" — the mixed catalogue band). Exercises
// the real commit path including Create & add another (autosave → doc) and
// the failure path (ensure-targets aborted → draft intact). The fixture's
// draftJson + Category rows are snapshotted first and restored byte-for-byte
// in `finally`.
//
//   set -a; source .env; set +a
//   BASE=http://localhost:3000 node e2e/create-rule-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/create-rule-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
// NEVER print the token — mask it out of any thrown/goto error text.
const mask = (s) => String(s).replaceAll(KEY, "***");

const prisma = new PrismaClient();
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${mask(detail)}` : ""}`);
  if (!cond) failures++;
};

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(
  `${SHOTS}/backup-${QUIZ}.json`,
  JSON.stringify({ draftJson: quiz.draftJson, categories: originalCats }, null, 2),
);
const draftDoc = async () =>
  (await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } }))?.draftJson;

let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  const goto = async (url) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      throw new Error(mask(e.message ?? e));
    }
  };
  const modal = page.locator(".qz-lm-builder");
  const box = async (loc) => loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const openModal = async () => {
    await page.locator('[data-testid="logic-tab-card"] .qz-ltab-create').first().click();
    await page.waitForSelector(".qz-lm-builder", { timeout: 8000 });
    await page.waitForTimeout(250);
  };

  // ════════════════════════════════════════════════════════════════════════
  // A · ONBOARDING flow — the funnel Logic step
  // ════════════════════════════════════════════════════════════════════════
  await goto(`${BASE}/studio?key=${KEY}`);
  await goto(`${BASE}/studio/onboarding/${QUIZ}`);
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await openModal();

  // 1 ── shell
  const mb = await box(modal);
  ok("modal is the approved 1,330px width", Math.abs(mb.w - 1330) < 2, `w${mb.w}`);
  ok("title bar is 36px, title + × only", await modal.locator(".qz-lm-h").evaluate((el) =>
    Math.abs(el.getBoundingClientRect().height - 36) < 2 && el.children.length === 2));
  ok("no band numerals / match segment / read-back sentence / impact",
    (await modal.locator(".qz-lm-bn, .qz-lm-paths, .qz-lm-impact, .qz-lm-f p").count()) === 0);
  console.log(`  · modal height ${mb.h}px (3-question quiz)`);

  // 2 ── question rows
  const rows = modal.locator(".qz-lm-qrow");
  ok("every question is a row (3 of 3, rating included)", (await rows.count()) === 3);
  ok("no + Qn chips, no column ×", (await modal.locator(".qz-lm-addcond, .qz-lm-qdrop").count()) === 0);
  const tile = await box(modal.locator(".qz-lm-tile").first());
  ok("answer bucket is 130 × 62", Math.abs(tile.w - 130) < 1 && Math.abs(tile.h - 62) < 1, `${tile.w}×${tile.h}`);
  ok("multi-select badge only on Q2",
    (await rows.nth(1).locator(".qz-lm-qbadge").count()) === 1 &&
    (await rows.nth(0).locator(".qz-lm-qbadge").count()) === 0 &&
    (await rows.nth(2).locator(".qz-lm-qbadge").count()) === 0);
  ok("full question text in title", (await rows.nth(0).locator(".qz-lm-qt").getAttribute("title") ?? "").length > 5);
  const opsW = await box(rows.nth(0).locator(".qz-lm-ops"));
  ok("operator column is a constant 124px", Math.abs(opsW.w - 124) < 1, `w${opsW.w}`);

  // 3 ── operators: single-select second pick → fixed any of; strip does not move
  const q1tiles = rows.nth(0).locator(".qz-lm-tile");
  const stripBefore = await box(rows.nth(0).locator(".qz-lm-tiles"));
  const rowBefore = await box(rows.nth(0));
  await q1tiles.nth(0).click();
  ok("no join with one answer picked", (await rows.nth(0).locator(".is-join").count()) === 0);
  await q1tiles.nth(1).click();
  ok("second answer ACCUMULATES on a single-select (2 on)", (await q1tiles.locator(".is-on").count()) === 2 ||
    (await rows.nth(0).locator(".qz-lm-tile.is-on").count()) === 2);
  ok("single-select: 'any of' is stated (dashed span), not offered",
    (await rows.nth(0).locator("span.qz-lm-qcf.is-join.is-fixed").count()) === 1 &&
    (await rows.nth(0).locator("button.is-join").count()) === 0);
  const stripAfter = await box(rows.nth(0).locator(".qz-lm-tiles"));
  const rowAfter = await box(rows.nth(0));
  ok("answer strip did not reflow and row height held",
    Math.abs(stripBefore.w - stripAfter.w) < 1 && Math.abs(stripBefore.x - stripAfter.x) < 1 &&
    Math.abs(rowBefore.h - rowAfter.h) < 1, `strip ${stripBefore.w}→${stripAfter.w} row ${rowBefore.h}→${rowAfter.h}`);
  // multi-select: the join is a button and flips
  const q2tiles = rows.nth(1).locator(".qz-lm-tile");
  await q2tiles.nth(0).click();
  await q2tiles.nth(1).click();
  const join = rows.nth(1).locator("button.qz-lm-qcf.is-join");
  ok("multi-select: 'any of' is a button", (await join.count()) === 1 && /any of/.test(await join.innerText()));
  await join.click();
  ok("… and flips to 'all of'", /all of/.test(await join.innerText()));
  await join.click();
  await page.screenshot({ path: `${SHOTS}/1-onboarding-picked.png` });
  // is / is not
  await rows.nth(2).locator(".qz-lm-qcf").first().click();
  ok("is → is not (colour AND word)", /is not/.test(await rows.nth(2).locator(".qz-lm-qcf.is-not").innerText()));
  await rows.nth(2).locator(".qz-lm-qcf").first().click();

  // 4 ── position holding: a sideways-scrolled strip + focus survive a pick
  const q3strip = rows.nth(2).locator(".qz-lm-tiles");
  await q3strip.evaluate((el) => { el.scrollLeft = 40; });
  const beforeScroll = await q3strip.evaluate((el) => el.scrollLeft);
  await rows.nth(2).locator(".qz-lm-tile").nth(4).click();
  await page.waitForTimeout(120);
  const afterScroll = await q3strip.evaluate((el) => el.scrollLeft);
  const focusHeld = await page.evaluate(() => document.activeElement?.classList.contains("qz-lm-tile"));
  ok("a pick holds the strip's sideways position and keyboard focus",
    beforeScroll === afterScroll && focusHeld, `${beforeScroll}→${afterScroll} focus:${focusHeld}`);
  await rows.nth(2).locator(".qz-lm-tile").nth(4).click(); // un-pick

  // 5 ── THEN is one row
  ok("THEN: Show | Pin | Hide segment with Show on and its hint",
    (await modal.locator(".qz-lm-vseg button").count()) === 3 &&
    (await modal.locator('.qz-lm-vseg button[aria-pressed="true"]').innerText()) === "Show" &&
    /become the results/.test(await modal.locator(".qz-lm-verbhint").innerText()));

  // 6 ── the ONBOARDING band
  const band = modal.locator('.qz-lm-showband[data-flow="onboarding"]');
  ok("onboarding band titled Your recommendations", /Your recommendations/.test(await band.locator(".qz-lm-st").first().innerText()));
  ok("coverage headline 1/3 have a rule (amber)", /^1\/3$/.test((await band.locator(".qz-lm-frac").innerText()).trim()) &&
    (await band.locator(".qz-lm-frac.is-done").count()) === 0);
  ok("kind tabs + search hidden until asked", (await band.locator(".qz-lm-tf, .qz-lm-tsearch").count()) === 0);
  const cards = band.locator(".qz-lm-tcard");
  const cardNames = await cards.locator(".qz-lm-tn").allInnerTexts();
  ok("uncovered groups sort first, covered last", cardNames.length === 3 && cardNames[2] === "QS Boards", cardNames.join(" | "));
  ok("uncovered = amber wash + 'Needs a rule' chip; covered = green + '✓ 1 rule'",
    (await cards.nth(0).evaluate((el) => el.classList.contains("is-needs"))) &&
    (await cards.nth(0).locator(".qz-lm-tstat.is-needs").innerText()) === "Needs a rule" &&
    (await cards.nth(2).evaluate((el) => el.classList.contains("is-done"))) &&
    /✓ 1 rule/.test(await cards.nth(2).locator(".qz-lm-tstat.is-done").innerText()));
  ok("no kind tag on recommendation cards here (status takes the slot)", (await cards.locator(".qz-lm-kd").count()) === 0);

  // 7 ── the count opens the group UPWARD, never selects; clicks inside stay
  const before = await cards.nth(2).locator(".qz-lm-tsel").getAttribute("aria-pressed");
  await cards.nth(2).locator(".qz-lm-tcount").click();
  await page.waitForSelector(".qz-popover", { timeout: 3000 });
  const pop = page.locator(".qz-popover");
  const popBox = await box(pop);
  const cardBox = await box(cards.nth(2));
  ok("peek opens upward, above the whole card, inside the window", (await pop.evaluate((el) => el.classList.contains("is-top"))) &&
    popBox.y + popBox.h <= cardBox.y + 1 && popBox.y >= 0, `pop bottom ${popBox.y + popBox.h} card top ${cardBox.y}`);
  ok("peek lists the group's products with a heading", /Inside QS Boards/i.test(await pop.innerText()) &&
    (await pop.locator(".qz-lm-peek-row").count()) === 4);
  ok("opening the peek did not toggle selection",
    (await cards.nth(2).locator(".qz-lm-tsel").getAttribute("aria-pressed")) === before);
  await pop.locator(".qz-lm-peek-row").first().click();
  await page.waitForTimeout(150);
  ok("a click inside the peek neither closes nor selects",
    (await page.locator(".qz-popover").count()) === 1 &&
    (await cards.nth(2).locator(".qz-lm-tsel").getAttribute("aria-pressed")) === before);
  await page.screenshot({ path: `${SHOTS}/2-onboarding-peek.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  ok("Esc closes the peek first, the modal stays", (await page.locator(".qz-popover").count()) === 0 && (await modal.count()) === 1);

  // 8 ── + Add something else reveals the catalogue UNDER the groups
  await band.locator(".qz-lm-expand").click();
  const catbar = band.locator(".qz-lm-catbar");
  ok("catalogue appears below the groups with its own label row",
    (await catbar.count()) === 1 && /From the catalogue/.test(await catbar.locator(".qz-lm-catlabel").innerText()) &&
    (await catbar.locator(".qz-lm-tf").count()) === 5 && (await catbar.locator(".qz-lm-tsearch").count()) === 1 &&
    (await band.locator(".qz-lm-tcard.is-needs").count()) === 2);
  ok("no Recommendations chip in the catalogue tabs", !(await catbar.locator(".qz-lm-tf").allInnerTexts()).some((t) => /Recommendations/.test(t)));
  const catBox = await box(catbar);
  const groupsBox = await box(band.locator(".qz-lm-tgrid").first());
  ok("… positioned under the groups", catBox.y > groupsBox.y + groupsBox.h);
  // search reaches the catalogue; a picked tag is pinned up with the groups
  await catbar.locator(".qz-lm-tsearch").fill("Accessor");
  await page.waitForTimeout(150);
  ok("search finds catalogue rows", (await catbar.locator(".qz-lm-tcard").count()) >= 1);
  await page.screenshot({ path: `${SHOTS}/3-onboarding-catalogue.png` });
  await catbar.locator(".qz-lm-tsearch").fill("");

  // 9 ── Create & add another: commits, toasts, resets, stays open; coverage moves
  const rulesBefore = ((await draftDoc())?.decision_rules ?? []).length;
  await cards.nth(0).locator(".qz-lm-tsel").click(); // the first uncovered group
  const selectedName = cardNames[0];
  ok("selected card takes the accent fill (wins over amber)",
    (await cards.nth(0).evaluate((el) => el.classList.contains("is-on") && !el.classList.contains("is-needs"))));
  ok("footer count: 1 selected", /1\s*selected/.test(await modal.locator(".qz-lm-fcount").innerText()));
  const another = modal.locator(".qz-lm-f button", { hasText: "Create & add another" });
  ok("Create & add another present and enabled", (await another.count()) === 1 && !(await another.isDisabled()));
  await another.click();
  await page.waitForSelector(".qz-toast", { timeout: 4000 });
  ok("toast ✓ Rule saved", /Rule saved/.test(await page.locator(".qz-toast").innerText()));
  await page.waitForTimeout(1800); // autosave 700ms debounce
  ok("modal stays open", (await modal.count()) === 1);
  ok("draft reset: no picks, no targets, catalogue collapsed, verb Show",
    (await modal.locator(".qz-lm-tile.is-on").count()) === 0 &&
    (await modal.locator(".qz-lm-fcount").count()) === 0 &&
    (await band.locator(".qz-lm-catbar").count()) === 0 &&
    (await modal.locator('.qz-lm-vseg button[aria-pressed="true"]').innerText()) === "Show");
  const doc2 = await draftDoc();
  const rules2 = doc2?.decision_rules ?? [];
  const newRule = rules2[rules2.length - 1];
  ok("the rule landed in the doc (autosaved)", rules2.length === rulesBefore + 1, `${rulesBefore}→${rules2.length}`);
  ok("new rule writes any_of for the single-select pair and NO match",
    newRule && (newRule.any_of ?? []).includes("q1") && !("match" in newRule) && newRule.action === "show",
    JSON.stringify(newRule));
  ok("coverage headline moved to 2/3", /^2\/3$/.test((await band.locator(".qz-lm-frac").innerText()).trim()));
  const names2 = await band.locator(".qz-lm-tcard .qz-lm-tn").allInnerTexts();
  ok("the covered group moved to the done pile with ✓ 1 rule",
    names2[0] !== selectedName && (await band.locator(".qz-lm-tcard.is-done").count()) === 2, names2.join(" | "));
  await page.screenshot({ path: `${SHOTS}/4-onboarding-after-add-another.png` });

  // 10 ── failure path: ensure-targets down → draft intact, nothing cleared
  await band.locator(".qz-lm-expand").click();
  await rows.nth(0).locator(".qz-lm-tile").nth(0).click();
  await catbar.locator(".qz-lm-tf", { hasText: "Tags" }).click();
  const tagCard = catbar.locator(".qz-lm-tcard").first();
  const tagName = await tagCard.locator(".qz-lm-tn").innerText();
  await tagCard.locator(".qz-lm-tsel").click();
  await ctx.route("**/api/categories/ensure-targets", (route) => route.abort());
  await another.click();
  await page.waitForSelector(".qz-toast:has-text(\"Couldn\")", { timeout: 4000 });
  ok("failure toast, no reset (draft intact)",
    /Couldn't reach/.test(await page.locator(".qz-toast").innerText()) &&
    (await modal.locator(".qz-lm-tile.is-on").count()) === 1 &&
    (await modal.locator(".qz-lm-tcard.is-on .qz-lm-tn").innerText()) === tagName &&
    (await band.locator(".qz-lm-catbar").count()) === 1);
  ok("no rule written on failure", ((await draftDoc())?.decision_rules ?? []).length === rules2.length);
  await ctx.unroute("**/api/categories/ensure-targets");
  // Selected catalogue pick is pinned up with the groups (filter never hides the rule)
  ok("the picked tag renders in the groups grid, above the catalogue",
    (await band.locator(".qz-lm-tgrid").first().locator(".qz-lm-tcard.is-on").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok("Esc closes the modal", (await modal.count()) === 0);

  // 11 ── reopen: coverage derived fresh, no cache
  await openModal();
  ok("reopen reflects the ledger (2/3)", /^2\/3$/.test((await modal.locator(".qz-lm-frac").innerText()).trim()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // 12 ── edit mode: Cancel + Save rule only
  await page.locator('[aria-label^="Edit rule"]').first().click();
  await page.waitForSelector(".qz-lm-builder", { timeout: 8000 });
  ok("edit: title, no Create & add another, Save rule",
    (await modal.getAttribute("aria-label")) === "Edit rule" &&
    (await modal.locator(".qz-lm-f button", { hasText: "Create & add another" }).count()) === 0 &&
    (await modal.locator(".qz-lm-f button", { hasText: "Save rule" }).count()) === 1);
  ok("edit: the rule's target is pre-selected and counted",
    (await modal.locator(".qz-lm-tcard.is-on").count()) === 1 && /1\s*selected/.test(await modal.locator(".qz-lm-fcount").innerText()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // ════════════════════════════════════════════════════════════════════════
  // B · BUILDER flow — the standalone Logic view
  // ════════════════════════════════════════════════════════════════════════
  await goto(`${BASE}/studio/${QUIZ}`);
  await page.waitForSelector(".qz-builder", { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
  await page.waitForTimeout(400);
  await openModal();
  const bband = modal.locator(".qz-lm-showband");
  ok("builder band titled What the quiz shows, tabs + search from the start",
    /What the quiz shows/.test(await bband.locator(".qz-lm-st").first().innerText()) &&
    (await bband.locator(".qz-lm-tf").count()) === 6 && (await bband.locator(".qz-lm-tsearch").count()) === 1 &&
    (await bband.locator('.qz-lm-tf.is-on')).innerText().then((t) => t.trim() === "All"));
  ok("tab order All · Recommendations · Products · Collections · Tags · Metafields",
    (await bband.locator(".qz-lm-tf").allInnerTexts()).map((t) => t.split(/\s/)[0]).join(" ") === "All Recommendations Products Collections Tags Metafields");
  ok("no amber, no green, no headline in the builder",
    (await bband.locator(".is-needs, .is-done, .qz-lm-cover, .qz-lm-expand").count()) === 0);
  const bCards = bband.locator(".qz-lm-tcard");
  const bTexts = await bCards.allInnerTexts();
  ok("covered groups still say 'N rules' (a fact, not a task); uncovered say nothing",
    bTexts.some((t) => /QS Boards[\s\S]*1 rule/.test(t)) && !bTexts.some((t) => /Needs a rule|no rule/.test(t)), bTexts.join(" || "));
  ok("kind tag on every builder card", (await bCards.locator(".qz-lm-kd").count()) === (await bCards.count()));
  const sw = await box(bband.locator(".qz-lm-tsearch"));
  ok("search is 226px with the rule-strong border", Math.abs(sw.w - 226) < 1 &&
    (await bband.locator(".qz-lm-tsearch").evaluate((el) => getComputedStyle(el).borderColor)) === "rgb(148, 142, 166)");
  const bb = await box(modal);
  console.log(`  · builder modal height ${bb.h}px · band ${(await box(bband)).h}px`);
  await page.screenshot({ path: `${SHOTS}/5-builder.png` });
  // a filter can never hide part of the rule
  await bCards.first().locator(".qz-lm-tsel").click();
  const pickedName = await bCards.first().locator(".qz-lm-tn").innerText();
  await bband.locator(".qz-lm-tf", { hasText: "Tags" }).click();
  ok("Tags filter keeps the selected group visible, first",
    (await bband.locator(".qz-lm-tcard").first().locator(".qz-lm-tn").innerText()) === pickedName &&
    (await bband.locator(".qz-lm-tcard.is-on").count()) === 1);
  ok("Tags group line reads 'N in this quiz of M — search to reach the rest'",
    /Tags · \d+ in this quiz of \d+ — search to reach the rest/i.test(await bband.locator(".qz-lm-tgroup").innerText()));
  await bband.locator(".qz-lm-tf", { hasText: "Recommendations" }).click();
  ok("Recommendations line reads 'all 3 groups this quiz recommends'",
    /Recommendations · all 3 groups this quiz recommends/i.test(await bband.locator(".qz-lm-tgroup").innerText()));
  await page.screenshot({ path: `${SHOTS}/6-builder-filtered.png` });
  // plain Create rule closes the modal
  await rows.nth(0).locator(".qz-lm-tile").nth(0).click();
  await modal.locator(".qz-lm-f button", { hasText: "Create rule" }).click();
  await page.waitForSelector(".qz-toast:has-text(\"created\")", { timeout: 4000 });
  ok("Create rule → toast ✓ Rule created and the modal closes",
    /Rule created/.test(await page.locator(".qz-toast").innerText()) && (await modal.count()) === 0);
  await page.waitForTimeout(1500);
  ok("… and the ledger doc grew", ((await draftDoc())?.decision_rules ?? []).length === rules2.length + 1);

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  // ── restore byte-for-byte ────────────────────────────────────────────────
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  const keep = new Set(originalCats.map((c) => c.id));
  await prisma.category.deleteMany({ where: { quizId: QUIZ, id: { notIn: [...keep] } } });
  await prisma.$disconnect();
  await browser?.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
}
process.exit(failures ? 1 : 0);
