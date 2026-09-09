// QWIDGET — the Logic step's question widget (Attributes + Rules) live-verify
// against a LOCAL production build + local DB. Fixture: cmr7khgd50001vkhscvox8dgt
// (decider · stage "logic" · attributes style · q1 single-select DECIDES with
// two mapped answers · q2 multi-select NARROWS · q3 rating INFO · three
// quiz-scoped step-1 groups: QS Boards, QS Accessories, Accessory).
//
// Validates the two things the owner asked for — the step-1 recommendations
// SURFACE on the Logic page (the tray, the picks picker, real thumbnails) and
// the design matches the artifact (Format B rail with role tags, the pane's
// text-with-caret role control, the tray, four-column rows with the count
// inside the chip, the cell as the control, single-target REPLACE, the
// narrows picker staging, inert info rows, and a multi-select question that
// can now decide). The draft is snapshotted and restored byte-for-byte.
//
//   set -a; source .env; set +a
//   BASE=http://localhost:3000 node e2e/logic-widget-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-widget-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
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
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const draft = async () =>
  (await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } }))?.draftJson;
const qNode = (doc, id) => doc.nodes.find((n) => n.id === id);

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
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const card = page.locator('[data-testid="logic-tab-card"]');
  const widget = card.locator(".qz-lw-grid--b");
  const rail = widget.locator(".qz-lw-rail");
  const pane = widget.locator(".qz-lw-pane");
  const rows = pane.locator(".qz-lw-arow");
  const rowByKey = (k) => rows.filter({ has: page.locator(`.qz-lw-akey:text-is("${k}")`) }).first();

  await goto(`${BASE}/studio?key=${KEY}`);
  await goto(`${BASE}/studio/onboarding/${QUIZ}`);
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 });
  await settle(1200);

  // 1 ── the widget replaces the old table; STYLE bar + ledger untouched
  ok("Format B widget mounts (rail + one pane)", (await widget.count()) === 1 && (await pane.count()) === 1);
  ok("STYLE bar still above it", (await page.locator('[data-testid="logic-style-bar"]').count()) === 1);
  ok("Rules ledger still below it", (await card.locator(".qz-lw-rzone").count()) === 1);
  ok("no PRODUCTS column, no uppercase header row", (await pane.locator(".qz-lw-ah, .qz-lw-acount").count()) === 0);
  ok("the explainer holds the three role definitions",
    /Picks results\./.test(await page.locator(".qz-ls-ledebox").innerText()) &&
    /Narrows results\./.test(await page.locator(".qz-ls-ledebox").innerText()) &&
    /Info only\./.test(await page.locator(".qz-ls-ledebox").innerText()));

  // 2 ── the rail: numbers, clamped text, ROLE tags
  const tags = await rail.locator(".qz-lw-qtag").allInnerTexts();
  ok("rail rows carry role tags Picks · Narrows · Info", tags.map((t) => t.trim().toLowerCase()).join(" · ") === "picks · narrows · info", tags.join(","));
  ok("the deciding question is selected by default", (await rail.locator(".qz-lw-qi.is-on").count()) === 1 && /picks/i.test(await rail.locator(".qz-lw-qi.is-on").innerText()));

  // 3 ── the pane header: title + text-with-caret role control
  ok("pane title is the question text", /shopping for/i.test(await pane.locator(".qz-lw-panet").innerText()));
  ok("role control reads 'Picks results ▾' (text with a caret, no pill)",
    /Picks results/.test(await pane.locator(".qz-lw-rolebtn").innerText()) && (await pane.locator(".qz-ltab-pill").count()) === 0);

  // 4 ── the tray: RECOMMENDATIONS FROM STEP 1 — the step-1 groups SURFACE here
  const tray = pane.locator(".qz-lw-tray");
  ok("tray labelled Recommendations from step 1", /Recommendations from step 1/i.test(await tray.locator(".qz-lw-tray-lb").first().innerText()));
  const cardNames = (await tray.locator(".qz-lw-tcard .qz-lw-tname").allInnerTexts()).map((t) => t.trim());
  ok("the three step-1 groups are the tray cards", cardNames.length === 3 && ["QS Boards", "QS Accessories", "Accessory"].every((n) => cardNames.includes(n)), cardNames.join(" | "));
  ok("a card carries a real product thumbnail", (await tray.locator("img.qz-lw-thumb").count()) >= 1);
  ok("used groups grey out and slide last; the free one leads", cardNames[0] === "Accessory" && (await tray.locator(".qz-lw-tcard.is-used").count()) === 2);
  ok("no See-more tile with three cards", await tray.locator("[data-tray-more]").evaluate((el) => getComputedStyle(el).display === "none"));
  await page.screenshot({ path: `${SHOTS}/1-decides.png` });

  // 5 ── rows: key · answer · one chip with the count INSIDE · then-go-to
  ok("four-column rows, one chip each on the mapped answers",
    (await rows.count()) === 2 && (await rowByKey("A").locator(".qz-lw-chip.is-res").count()) === 1 &&
    (await rowByKey("A").locator(".qz-lw-cn").count()) === 1);
  ok("the count inside the chip opens the products popover", await (async () => {
    await rowByKey("A").locator(".qz-ltab-countbtn").click();
    await page.waitForSelector(".qz-popover .qz-pp", { timeout: 3000 });
    const okp = (await page.locator(".qz-popover .qz-pp-card").count()) > 0;
    await page.keyboard.press("Escape");
    await settle(200);
    return okp && (await page.locator(".qz-popover").count()) === 0;
  })());
  ok("then-go-to is near-silent on the default route", /→ Next/.test(await rowByKey("A").locator(".qz-lw-go").innerText()) && !(await rowByKey("A").locator(".qz-lw-go").evaluate((el) => el.classList.contains("is-set"))));

  // 6 ── the cell is the control: white space opens the picks picker (radios)
  const cellA = rowByKey("A").locator(".qz-lw-cell");
  const beforeA = qNode(await draft(), "q1").data.answers[0].target_id;
  await cellA.click({ position: { x: 225, y: 14 } }); // the cell's WHITE SPACE, past the chip
  await page.waitForSelector(".qz-popover", { timeout: 3000 });
  const picker = page.locator(".qz-popover");
  ok("picks picker: search, source chips, RADIO rows over step-1 output only",
    (await picker.locator('input[type="search"]').count()) === 1 &&
    (await picker.locator('[role="radio"]').count()) === 3 &&
    (await picker.locator(".qz-lw-vp-grp").allInnerTexts()).some((t) => /custom groups|tag buckets/i.test(t)));
  ok("the current target is the checked radio", (await picker.locator('[role="radio"][aria-checked="true"]').innerText()).includes("QS Boards"));
  ok("clicking inside keeps it open", await (async () => { await picker.locator('input[type="search"]').click(); return (await page.locator(".qz-popover").count()) === 1; })());
  await picker.locator(".qz-lw-vp-drill").first().click();
  await settle(200);
  ok("› drills into the products behind a row, ‹ Back returns", /products/.test(await picker.locator(".qz-lw-vp-title").innerText()) && (await picker.locator(".qz-lw-pp").count()) > 0);
  await picker.locator("button", { hasText: "Back" }).click();
  await settle(150);
  await picker.locator('[role="radio"]', { hasText: "Accessory" }).first().click();
  await settle(1500);
  ok("picking REPLACES the answer's one target and closes (writes on click)",
    (await page.locator(".qz-popover").count()) === 0 &&
    (await rowByKey("A").locator(".qz-lw-chip.is-res").innerText()).trim() === "Accessory" &&
    qNode(await draft(), "q1").data.answers[0].target_id !== beforeA);
  ok("the changed cell flashes", (await rowByKey("A").locator(".qz-lw-cell.is-flash").count()) === 1);
  ok("the tray re-sorts: QS Boards is free again and leads", (await tray.locator(".qz-lw-tcard .qz-lw-tname").first().innerText()).trim() === "QS Boards");
  await page.screenshot({ path: `${SHOTS}/2-picker.png` });

  // 7 ── arm and place: an occupied cell says Replace {old} with {new}
  await tray.locator(".qz-lw-tcard", { hasText: "QS Boards" }).click();
  await settle(300);
  ok("arming a card lights it and opens its peek", (await tray.locator(".qz-lw-tcard.is-armed").count()) === 1 && (await page.locator(".qz-popover .qz-lw-pp").count()) > 0);
  ok("an occupied cell reads Replace {old} with {new}", /Replace Accessory with QS Boards/.test(await cellA.innerText()));
  await page.screenshot({ path: `${SHOTS}/3-armed.png` });
  await cellA.click();
  await settle(1500);
  ok("placing replaces the target (one chip, never two)",
    (await rowByKey("A").locator(".qz-lw-chip.is-res").count()) === 1 &&
    (await rowByKey("A").locator(".qz-lw-chip.is-res").innerText()).trim() === "QS Boards" &&
    (await tray.locator(".qz-lw-tcard.is-armed").count()) === 0);
  // clear ×
  await rowByKey("A").hover();
  await rowByKey("A").locator(".qz-lw-xone").click();
  await settle(1500);
  ok("the clear × empties the cell (Choose a result) and drops the key",
    /Choose a result/.test(await cellA.innerText()) && !("target_id" in qNode(await draft(), "q1").data.answers[0]));
  // keyboard: Enter opens, Escape closes
  await cellA.focus();
  await page.keyboard.press("Enter");
  await settle(250);
  const kbOpen = (await page.locator(".qz-popover").count()) === 1;
  await page.keyboard.press("Escape");
  await settle(200);
  ok("keyboard: Enter opens the picker, Escape closes it", kbOpen && (await page.locator(".qz-popover").count()) === 0);

  // 8 ── narrows: same chrome, staged; Cancel writes nothing
  await rail.locator(".qz-lw-qi").nth(1).click();
  await settle(600);
  // The fixture maps A (a product type, chip + its field) and B (Keeps
  // everything); C and D are empty.
  ok("narrows question: no tray, a hairline, mapped chips keep their field, empty cells read Choose a value",
    (await pane.locator(".qz-lw-tray").count()) === 0 && (await pane.locator(".qz-lw-prule").count()) === 1 &&
    (await rowByKey("A").locator(".qz-lw-qf").count()) === 1 && /Keeps everything/.test(await rowByKey("B").innerText()) &&
    /Choose a value/.test(await rowByKey("C").locator(".qz-lw-cell").innerText()));
  ok("a narrows chip carries its own × and the match count beside it",
    (await rowByKey("A").locator(".qz-lw-xone").count()) === 1 && /of 124/.test(await rowByKey("A").innerText()));
  const docBefore = JSON.stringify(await draft());
  await rowByKey("C").locator(".qz-lw-cell").click({ position: { x: 225, y: 14 } });
  await page.waitForSelector(".qz-popover", { timeout: 3000 });
  const vp = page.locator(".qz-popover");
  ok("narrows picker: checkbox rows with a › drill-in per value, Cancel + Done",
    (await vp.locator('.qz-lw-vp-opt[aria-pressed]').count()) > 0 && (await vp.locator(".qz-lw-vp-drill").count()) > 0 &&
    (await vp.locator("button", { hasText: /^Cancel$/ }).count()) === 1);
  await vp.locator('.qz-lw-vp-opt[aria-pressed]').first().click();
  await vp.locator('.qz-lw-vp-opt[aria-pressed]').nth(1).click();
  await vp.locator("button", { hasText: /^Cancel$/ }).click();
  await settle(1200);
  ok("ticking stages; Cancel writes NOTHING", JSON.stringify(await draft()) === docBefore && (await page.locator(".qz-popover").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/4-narrows.png` });

  // 9 ── info rows are inert
  await rail.locator(".qz-lw-qi").nth(2).click();
  await settle(600);
  ok("info question: inert cells, no picker, no ×",
    (await pane.locator(".qz-lw-vinert").count()) === 5 && (await pane.locator(".qz-lw-cell, .qz-lw-xone").count()) === 0);

  // 10 ── decision 2: the multi-select question can now decide
  await rail.locator(".qz-lw-qi").nth(1).click();
  await settle(500);
  await pane.locator(".qz-lw-rolebtn").click();
  await page.waitForSelector(".qz-popover", { timeout: 3000 });
  const picksRow = page.locator(".qz-popover .qz-ltab-menu-row", { hasText: "Picks the result" });
  ok("the role menu offers Picks the result to a multi-select (not disabled)", (await picksRow.count()) === 1 && !(await picksRow.isDisabled()));
  await picksRow.click();
  await settle(1500);
  const d2 = await draft();
  ok("the multi-select is now the decider; the old one demoted",
    qNode(d2, "q2").data.role === "decides" && qNode(d2, "q1").data.role === "qualifier");
  ok("the tray now shows for it, and the rail tag flipped to Picks",
    (await pane.locator(".qz-lw-tray").count()) === 1 && /picks/i.test(await rail.locator(".qz-lw-qi").nth(1).innerText()));
  await page.screenshot({ path: `${SHOTS}/5-multi-decides.png` });

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.$disconnect();
  await browser?.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
}
process.exit(failures ? 1 : 0);
