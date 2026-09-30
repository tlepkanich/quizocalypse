// Logic step redesign — Filter Results + Rules, Edit: the question RAIL and
// PANE live-verify against a LOCAL production build + local DB (handoff
// "Filter Results + Rules · Edit", "Inline text editing", "Add a question";
// mock rules-row/index.html railItems / pane / roleMenu / picker / vpHTML /
// routeMenu / typeMenu / trayMoreHTML / aqHTML).
//
// Runs on a THROWAWAY clone of the local fixture cmr7khgd50001vkhscvox8dgt
// (e2e/logic-fixture-clone.mjs: same shop, fresh quiz-scoped categories) so
// other probes and agents keep the original; the clone is deleted at the end.
// Fixture shape: q1 single-select PICKS (A → QS Boards, B → QS Accessories;
// Accessory unplaced), q2 multi-select NARROWS (A product type, B Keeps
// everything, C/D empty), q3 rating INFO (five points, end labels).
//
//   BASE=http://localhost:3718 node --env-file=.env e2e/logic-filter-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { cloneFixture } from "./logic-fixture-clone.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-filter-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing (node --env-file=.env)");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
const mask = (s) => String(s).replaceAll(KEY, "***");
const prisma = new PrismaClient();
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${mask(detail)}` : ""}`);
  if (!cond) failures++;
};
const qNode = (doc, id) => doc.nodes.find((n) => n.id === id);

const clone = await cloneFixture(prisma, { name: "Logic filter probe" });
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  // Autosave is a 700 ms debounce: wait for the draft to show `pred`.
  const draftWhere = async (pred, ms = 6000) => {
    const end = Date.now() + ms;
    for (;;) {
      const d = await clone.draft();
      if (pred(d)) return d;
      if (Date.now() > end) return d;
      await page.waitForTimeout(250);
    }
  };
  const card = page.locator('[data-testid="logic-tab-card"]');
  const rail = card.locator(".qz-lg-rail");
  const pane = card.locator('[data-testid="logic-question-pane"]');
  const rows = pane.locator(".qz-lg-arow");
  const pop = page.locator(".qz-popover");
  const toast = page.locator(".qz-toast");

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" }).catch((e) => {
    throw new Error(mask(e.message));
  });
  await page.goto(`${BASE}/studio/onboarding/${clone.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 });
  await settle(1400);

  // 1 ── the rail (mock railItems / .railcount): no ✦, tags, counts
  ok("rail head reads QUESTIONS with the count, no explainer button",
    /questions/i.test(await rail.locator(".qz-lg-kick").innerText()) &&
    (await rail.locator(".qz-lg-railn").innerText()) === "3" &&
    (await rail.locator(".qz-lw-howmini, [aria-label='How questions work']").count()) === 0);
  ok("rows carry Picks · Narrows · Info",
    (await rail.locator(".qz-lg-qtag").allInnerTexts()).map((t) => t.trim().toLowerCase()).join(",") === "picks,narrows,info");
  ok("the foot counts the roles (Picks 1 · Narrows 1 · Info 1)",
    /Picks 1\s*Narrows 1\s*Info 1/.test((await rail.locator(".qz-lg-railcount").innerText()).replace(/\n/g, " ")));
  ok("the picking question is selected and lifted", (await rail.locator(".qz-lg-qi.is-on").count()) === 1);

  // 2 ── the pane header: inline title, type line, role control
  ok("type line reads Single select", /Single select/.test(await pane.locator(".qz-lg-qtype").innerText()));
  ok("role control reads Picks results ▾", /Picks results/.test(await pane.locator(".qz-lg-rolebtn").innerText()));
  const title = pane.locator(".qz-lg-panet .qz-ed");
  await title.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" now");
  ok("the rail row (its tooltip) follows the title while typing",
    / now$/.test((await rail.locator(".qz-lg-qi.is-on").getAttribute("title")) ?? ""));
  await page.keyboard.press("Enter");
  await settle(300);
  await shot("01-title-saving");
  const dTitle = await draftWhere((d) => /now$/.test(qNode(d, "q1").data.text));
  ok("Enter commits the title (setQuestionText)", /now$/.test(qNode(dTitle, "q1").data.text));
  ok("the field save pill shows at the title", (await page.locator(".qz-fsp").count()) >= 1);

  // 3 ── the tray (D14): one row, text chips, green = unplaced
  const tray = pane.locator('[data-testid="logic-tray"]');
  ok("tray label RECOMMENDATIONS, text-only chips, no thumbnails",
    /recommendations/i.test(await tray.locator(".qz-lg-tray-lb").innerText()) &&
    (await tray.locator("img").count()) === 0 && (await tray.locator(".qz-lg-tchip:not(.is-more)").count()) === 3);
  ok("Accessory (on no answer) is green; placed chips are black",
    (await tray.locator(".qz-lg-tchip.is-fresh").allInnerTexts()).join() === "Accessory");
  await shot("02-filter");

  // 4 ── arm and place
  await tray.locator(".qz-lg-tchip", { hasText: "Accessory" }).click();
  await settle(250);
  ok("arming lights the chip violet and turns every cell into a drop target",
    (await tray.locator(".qz-lg-tchip.is-armed").count()) === 1 && (await pane.locator(".qz-lg-cell.is-drop").count()) === 2);
  await shot("03-armed");
  await page.keyboard.press("Escape");
  await settle(200);
  ok("Esc disarms", (await tray.locator(".qz-lg-tchip.is-armed").count()) === 0);
  await tray.locator(".qz-lg-tchip", { hasText: "Accessory" }).click();
  await rows.nth(0).locator(".qz-lg-cell").click();
  const dPlace = await draftWhere((d) => (qNode(d, "q1").data.answers[0].target_ids ?? []).length === 2);
  const accId = [...clone.idMap.values()];
  ok("clicking a cell ADDS the armed recommendation and disarms (one shot)",
    (qNode(dPlace, "q1").data.answers[0].target_ids ?? []).length === 2 &&
    (await tray.locator(".qz-lg-tchip.is-armed").count()) === 0 &&
    (await rows.nth(0).locator(".qz-lg-chip").count()) === 2);
  ok("the placed chip turns black", (await tray.locator(".qz-lg-tchip.is-fresh").count()) === 0);
  void accId;

  // 5 ── the picks picker: title, checkbox rows, stays open, toggles
  await rows.nth(1).locator(".qz-lg-chip").first().click();
  await page.waitForSelector('[data-testid="picks-picker"]', { timeout: 3000 });
  ok("clicking the cell (even on its chip) opens 'Choose a result' with checkbox rows",
    /Choose a result/.test(await pop.locator(".qz-lg-pt").first().innerText()) &&
    (await pop.locator('[role="checkbox"]').count()) === 3);
  await pop.locator('[role="checkbox"]', { hasText: "QS Boards" }).click();
  await settle(400);
  ok("a row click writes and the picker stays open",
    (await pop.count()) === 1 && (await rows.nth(1).locator(".qz-lg-chip").count()) === 2);
  await shot("04-picker");
  await page.keyboard.press("Escape");
  await settle(250);
  ok("Esc closes the picker and focus returns to the cell",
    (await pop.count()) === 0 && (await page.evaluate(() => document.activeElement?.hasAttribute("data-pane-cell"))));
  await rows.nth(1).hover();
  await rows.nth(1).locator(".qz-lg-chipw", { hasText: "QS Boards" }).locator(".qz-lg-xone").click();
  await settle(300);
  ok("a chip's × removes only that one", (await rows.nth(1).locator(".qz-lg-chip").count()) === 1);

  // 6 ── the route menu
  await rows.nth(0).locator(".qz-lg-go").click();
  await page.waitForSelector('.qz-popover [role="menu"]', { timeout: 3000 });
  ok("route menu: '<answer> · goes to', The next question, Q3 skips 1, Straight to the results",
    / · goes to/.test(await pop.locator(".qz-lg-pt").innerText()) &&
    (await pop.locator('[role="menuitemradio"]').count()) === 3 &&
    /skips 1 question/.test(await pop.innerText()));
  await shot("05-route");
  await pop.locator('[role="menuitemradio"]', { hasText: "Q3" }).click();
  await settle(400);
  ok("choosing Q3 makes the route bold '→ Q3'",
    /Q3/.test(await rows.nth(0).locator(".qz-lg-go").innerText()) &&
    (await rows.nth(0).locator(".qz-lg-go.is-set").count()) === 1);

  // 7 ── the type popover: stays open, Multi-select min/max
  await pane.locator(".qz-lg-qtype").click();
  await page.waitForSelector('[data-testid="type-popover"]', { timeout: 3000 });
  ok("Question type radios: Single select, Multi-select, Five-point scale, Scale",
    (await pop.locator('[role="radio"]').allInnerTexts()).map((t) => t.trim()).join("|") ===
      "Single select|Multi-select|Five-point scale|Scale");
  await pop.locator('[role="radio"]', { hasText: "Multi-select" }).click();
  await settle(300);
  ok("the pick applies and the popover stays open with Min / Max",
    (await pop.count()) === 1 && (await pop.locator(".qz-lg-stp").count()) === 2 &&
    /Multi-select · pick 1–2/.test(await pane.locator(".qz-lg-qtype").innerText()));
  await pop.getByLabel("Decrease maximum selections").click();
  await settle(300);
  ok("Max − updates the type line at once (pick 1)", /pick 1\b/.test(await pane.locator(".qz-lg-qtype").innerText()));
  await shot("06-type-multi");
  await pop.locator('[role="radio"]', { hasText: "Single select" }).click();
  await settle(300);
  await page.keyboard.press("Escape");
  const dType = await draftWhere((d) => qNode(d, "q1").data.question_type === "single_select");
  ok("back to Single select clears the pick bounds, answers kept",
    qNode(dType, "q1").data.question_type === "single_select" && qNode(dType, "q1").data.max_selections === undefined &&
    qNode(dType, "q1").data.answers.length === 2);

  // 8 ── the narrows question and the value picker
  await rail.locator(".qz-lg-qi").nth(1).click();
  await settle(500);
  ok("Narrows: a hairline instead of the tray, chips, Keeps everything, dashed Choose a value",
    (await pane.locator('[data-testid="logic-tray"]').count()) === 0 && (await pane.locator(".qz-lg-prule").count()) === 1 &&
    /Keeps everything/.test(await rows.nth(1).innerText()) && /Choose a value/.test(await rows.nth(2).innerText()));
  await rows.nth(2).locator(".qz-lg-cell").click();
  await page.waitForSelector('[data-testid="value-picker"]', { timeout: 3000 });
  ok("value picker: '<answer> · keeps', search focused, tabs, Keeps everything row",
    / · keeps/.test(await pop.locator(".qz-lg-pt").innerText()) &&
    (await page.evaluate(() => document.activeElement?.getAttribute("type"))) === "search" &&
    (await pop.locator(".qz-lg-vptabs button").count()) >= 2 &&
    (await pop.locator("[data-vp-keeps]").count()) === 1);
  await shot("07-value-picker");
  await pop.locator('[role="checkbox"]:not([data-vp-keeps])').first().click();
  ok("ticking stages ('1 selected')", /1 selected/.test(await pop.locator(".qz-lg-vpfoot").innerText()));
  await pop.locator("[data-vp-keeps]").click();
  ok("Keeps everything unticks the values", /Keeps everything/.test(await pop.locator(".qz-lg-vpfoot").innerText()));
  await pop.locator("button", { hasText: /^Done$/ }).click();
  const dKeep = await draftWhere((d) => qNode(d, "q2").data.answers[2].no_preference === true);
  ok("Done writes Keeps everything (no_preference)", qNode(dKeep, "q2").data.answers[2].no_preference === true &&
    /Keeps everything/.test(await rows.nth(2).innerText()));

  // 9 ── the role menu: D9 move with Undo
  await pane.locator(".qz-lg-rolebtn").click();
  await page.waitForSelector('[data-testid="role-menu"]', { timeout: 3000 });
  ok("role menu: 'Question 2 does', three two-line items, the move line, the foot",
    /Question 2 does/.test(await pop.locator(".qz-lg-pt").innerText()) &&
    (await pop.locator('[role="menuitemradio"]').count()) === 3 &&
    /moves it from Q1 and clears Q1's mapping/.test(await pop.innerText()) &&
    /Only one question can pick the result\./.test(await pop.innerText()));
  await shot("08-role-menu");
  await pop.locator('[role="menuitemradio"]', { hasText: "Picks the result" }).click();
  await page.waitForSelector(".qz-toast.has-action", { timeout: 3000 });
  ok("the move toasts what it cleared, with Undo",
    /Q1's 3 recommendations were removed/.test(await toast.innerText()) && /Q2's \d+ values? (was|were) removed/.test(await toast.innerText()));
  await shot("09-role-toast");
  const dMoved = await draftWhere((d) => qNode(d, "q2").data.role === "decides");
  ok("Q2 picks now; Q1 is Info with its targets cleared",
    qNode(dMoved, "q2").data.role === "decides" && qNode(dMoved, "q1").data.role === "qualifier" &&
    !qNode(dMoved, "q1").data.answers.some((a) => a.target_id));
  await page.locator(".qz-toast-action").click();
  const dUndo = await draftWhere((d) => qNode(d, "q1").data.role === "decides");
  ok("Undo restores both roles and every target",
    qNode(dUndo, "q1").data.role === "decides" && qNode(dUndo, "q2").data.role === "filter" &&
    (qNode(dUndo, "q1").data.answers[0].target_ids ?? []).length === 2 &&
    qNode(dUndo, "q2").data.answers[2].no_preference === true);

  // 10 ── the info (scale) question
  await rail.locator(".qz-lg-qi").nth(2).click();
  await settle(500);
  ok("Info: inert dashes, numbered keys, faint → Results on the last question",
    (await pane.locator(".qz-lg-cell.is-inert").count()) === 5 &&
    (await pane.locator(".qz-lg-akey.is-num").allInnerTexts()).join("") === "12345" &&
    (await pane.locator(".qz-lg-go.is-set").count()) === 0 && /Results/.test(await rows.nth(0).locator(".qz-lg-go").innerText()));
  await pane.locator(".qz-lg-qtype").click();
  await page.waitForSelector('[data-testid="type-popover"]', { timeout: 3000 });
  await pop.getByLabel("Decrease scale points").click();
  await page.waitForSelector(".qz-toast.has-action", { timeout: 3000 });
  ok("removing a point is announced with Undo", /Removed point 5 from Q3/.test(await toast.innerText()));
  await shot("10-scale-points");
  await page.locator(".qz-toast-action").click();
  const dPts = await draftWhere((d) => qNode(d, "q3").data.answers.length === 5);
  ok("Undo puts the point back", qNode(dPts, "q3").data.answers.length === 5);
  await page.keyboard.press("Escape");

  // 11 ── Add a question
  await rail.locator('[data-testid="logic-add-question"]').click();
  await page.waitForSelector('.qz-modal [aria-label="Question"]', { timeout: 3000 });
  const modal = page.locator(".qz-modal");
  ok("hint counts filled answers (0 of 2 needed)", /0 of 2 needed/.test(await modal.innerText()));
  await modal.getByLabel("Question", { exact: true }).fill("Probe question?");
  await modal.getByLabel("Answer 1", { exact: true }).fill("Yes");
  await modal.getByLabel("Answer 2", { exact: true }).fill("No");
  ok("footer reads 'Adds Q4 with 2 answers'", /Adds Q4 with 2 answers/.test(await modal.innerText()));
  await page.mouse.click(10, 900); // the scrim
  await settle(250);
  ok("a scrim click keeps the draft (draft-safe)", (await page.locator(".qz-modal").count()) === 1);
  await shot("11-add-question");
  await modal.locator("button", { hasText: /^Add question$/ }).click();
  await settle(900);
  // The toast names the question's REAL number in the flow after the commit
  // (appendBankQuestion's landing slot is the handoff's open "where the new
  // question lands" conflict, so the probe reads the number off the rail).
  const onRow = rail.locator(".qz-lg-qi.is-on");
  const newN = (await onRow.locator(".qz-lg-qn").innerText()).trim();
  ok("the new question is selected (Info) and toasted 'Qn added' with its real number",
    /Probe question/.test(await onRow.innerText()) && /info/i.test(await onRow.locator(".qz-lg-qtag").innerText()) &&
    (await toast.innerText()).includes(`Q${newN} added`), `rail number ${newN}`);

  // 12 ── keyboard: the Picks cell opens from Enter; Esc returns focus
  await rail.locator(".qz-lg-qi", { hasText: "shopping" }).click();
  await settle(400);
  await rows.nth(0).locator(".qz-lg-cell").focus();
  await page.keyboard.press("Enter");
  await settle(300);
  const kbOpen = (await pop.count()) === 1;
  await page.keyboard.press("Escape");
  await settle(200);
  ok("keyboard: Enter opens the picker, Esc closes it back to the cell",
    kbOpen && (await pop.count()) === 0 && (await page.evaluate(() => document.activeElement?.hasAttribute("data-pane-cell"))));

  // 13 ── the focusRequest `control` seam: with no picking question, the
  // check popover's "no question picks" row lands on Q1's role button.
  await pane.locator(".qz-lg-rolebtn").click();
  await page.waitForSelector('[data-testid="role-menu"]', { timeout: 3000 });
  await pop.locator('[role="menuitemradio"]', { hasText: "Info only" }).click();
  await settle(600);
  await page.locator(".qz-topbar-continue").click();
  await settle(400);
  const pickRow = page.locator(".qz-popover button.qz-lg-find", { hasText: /no question (picks|decides)/i }).first();
  const hasRow = (await pickRow.count()) === 1;
  if (hasRow) await pickRow.click();
  await settle(700);
  ok("a check-popover row with control 'role' focuses the pane's role button",
    hasRow && (await page.evaluate(() => document.activeElement?.getAttribute("data-pane-control"))) === "role");
  await page.screenshot({ path: `${SHOTS}/12-focus-role.png` });

  // 14 ── many recommendations: one row, "+N more", the armed chip never
  // collapses (B52). Twelve extra quiz-scoped rows on the clone, then reload.
  const src = await prisma.category.findFirst({ where: { quizId: clone.id } });
  for (let i = 1; i <= 12; i++) {
    await prisma.category.create({
      data: {
        shopId: src.shopId, quizId: clone.id, name: `Probe group ${String(i).padStart(2, "0")}`,
        description: "", tags: [], productIds: src.productIds.slice(0, 2), source: "manual",
        manualProductIds: [], discoveryRunId: "logic-filter-probe",
      },
    });
  }
  await page.locator(".qz-toast-action").click().catch(() => {}); // undo the Info move above
  await settle(1200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 });
  await settle(1400);
  await rail.locator(".qz-lg-qi", { hasText: "shopping" }).click();
  await settle(500);
  const more = tray.locator(".qz-lg-tchip.is-more");
  ok("the tray stays one row and ends with '+N more'",
    (await more.isVisible()) && /^\+\d+ more$/.test((await more.innerText()).trim()) &&
    (await tray.evaluate((el) => el.getBoundingClientRect().height)) < 50);
  await more.click();
  await page.waitForSelector(".qz-popover .qz-lg-vpsearch", { timeout: 3000 });
  ok("'All recommendations · N' lists every one with its note, search focused",
    /All recommendations · 15/.test(await pop.locator(".qz-lg-pt").innerText()) &&
    (await pop.locator(".qz-lg-mi.is-tl").count()) === 15 &&
    (await page.evaluate(() => document.activeElement?.getAttribute("type"))) === "search");
  await settle(300);
  await shot("13-tray-more");
  await pop.locator(".qz-lg-mi.is-tl", { hasText: "Probe group 12" }).click();
  await settle(400);
  ok("arming from the list keeps the armed chip on the row (B52)",
    await tray.locator(".qz-lg-tchip.is-armed", { hasText: "Probe group 12" }).isVisible());
  await shot("14-tray-armed-from-more");
  await page.keyboard.press("Escape");

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await clone.drop();
  await prisma.$disconnect();
  await browser?.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
}
process.exit(failures ? 1 : 0);
