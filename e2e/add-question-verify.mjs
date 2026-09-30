// The ONE shared "Add a question" dialog (studio/AddQuestionDialog.tsx) —
// live-verify its mock look (docs/design/logic-tab/rules-row/index.html
// #aqm aqHTML, owner ruling 2026-09-30) and its behaviour in BOTH hosts:
// the Logic step (LogicTabCard rail "+ Add question") and the Questions
// step (QuestionsWalkthrough "Add question").
//
// Runs on a THROWAWAY clone of the local fixture cmr7khgd50001vkhscvox8dgt
// (e2e/logic-fixture-clone.mjs); the clone is deleted at the end.
//
//   BASE=http://localhost:3718 node --env-file=.env e2e/add-question-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { cloneFixture } from "./logic-fixture-clone.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/add-question-shots";
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

const clone = await cloneFixture(prisma, { name: "Add question probe" });
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  const draftWhere = async (pred, ms = 6000) => {
    const end = Date.now() + ms;
    for (;;) {
      const d = await clone.draft();
      if (pred(d) || Date.now() > end) return d;
      await page.waitForTimeout(250);
    }
  };
  const modal = page.locator(".qz-modal.qz-lg-aqbox");
  const answers = modal.locator('input[aria-label^="Answer "]');
  const values = () => answers.evaluateAll((els) => els.map((e) => e.value));

  // The look + the behaviour, identical in either host.
  const exercise = async (host) => {
    await page.waitForSelector('.qz-lg-aqbox [aria-label="Question"]', { timeout: 5000 });
    await page.waitForTimeout(300);
    const box = await modal.boundingBox();
    ok(`${host}: the window is 620 wide`, Math.round(box?.width ?? 0) === 620, `${box?.width}`);
    ok(`${host}: title "Add a question" at 16px/700`,
      (await modal.locator(".qz-modal-title").evaluate((el) => {
        const cs = getComputedStyle(el);
        return `${el.textContent}|${cs.fontSize}|${cs.fontWeight}`;
      })) === "Add a question|16px|700");
    const types = await modal.locator(".qz-lg-aqtgrid > .qz-lg-aqt").evaluateAll((els) =>
      els.map((e) => ({ t: e.textContent, top: Math.round(e.getBoundingClientRect().top) })));
    ok(`${host}: four types across, each with its hint`,
      types.length === 4 && new Set(types.map((t) => t.top)).size === 1 &&
      types.map((t) => t.t).join(",") ===
        "Single selectthey pick one answer,Multi-selectthey pick several,Image selectanswers show as image tiles,Five-point scalethey rate from 1 to 5");
    ok(`${host}: numbered sentence-case bands`,
      (await modal.locator(".qz-lg-aqbt").allInnerTexts()).join(",") === "Type,Question,Answers" &&
      (await modal.locator(".qz-lg-aqbn").allInnerTexts()).join(",") === "1,2,3");
    ok(`${host}: the mock's question placeholder`,
      (await modal.getByLabel("Question", { exact: true }).getAttribute("placeholder")) ===
        "How does your skin feel by the end of the day?");
    ok(`${host}: hint "0 of 2 needed" on the Answers band`,
      (await modal.locator(".qz-lg-aqbhint").innerText()) === "0 of 2 needed");
    ok(`${host}: ground footer "Adds Qn with 0 answers"`,
      /^Adds Q\d+ with 0 answers$/.test(await modal.locator(".qz-lg-aqsum").innerText()));
    await shot(`${host}-1-empty`);

    await modal.getByLabel("Question", { exact: true }).fill("Probe question?");
    await modal.getByLabel("Answer 1", { exact: true }).fill("Alpha");
    await modal.getByLabel("Answer 2", { exact: true }).fill("Bravo");
    await modal.locator("button", { hasText: /^\+ Add answer$/ }).click();
    await modal.getByLabel("Answer 3", { exact: true }).fill("Charlie");
    ok(`${host}: hint counts filled answers`, (await modal.locator(".qz-lg-aqbhint").innerText()) === "3 answers");

    // pointer drag: C's grip onto row A
    const g = await modal.locator(".qz-lg-aqgrip").nth(2).boundingBox();
    const top = await modal.locator(".qz-lg-aqrow").nth(0).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, top.y + 4, { steps: 8 });
    ok(`${host}: a drop line shows while dragging`, (await modal.locator(".qz-lg-aqrow.is-drop-before").count()) === 1);
    await page.mouse.up();
    ok(`${host}: pointer drag reorders`, (await values()).join(",") === "Charlie,Alpha,Bravo");
    await modal.locator(".qz-lg-aqgrip").nth(0).focus();
    await page.keyboard.press("ArrowDown");
    ok(`${host}: arrow keys on the grip reorder and keep focus`,
      (await values()).join(",") === "Alpha,Charlie,Bravo" &&
      (await page.evaluate(() => document.activeElement?.classList.contains("qz-lg-aqgrip"))));

    // the real 12-answer cap
    for (let i = 0; i < 12; i++) {
      const add = modal.locator("button", { hasText: /^\+ Add answer$/ });
      if (!(await add.count())) break;
      await add.click();
    }
    ok(`${host}: rows stop at 12 and say so`,
      (await answers.count()) === 12 && /12 answers is the most a question can have\./.test(await modal.innerText()));
    for (let i = 12; i > 3; i--) await modal.getByLabel(`Delete answer ${i}`, { exact: true }).click();
    ok(`${host}: deletes bring it back to 3`, (await answers.count()) === 3);

    await page.mouse.click(10, 900); // the scrim
    await page.waitForTimeout(250);
    ok(`${host}: a scrim click keeps the draft`, (await modal.count()) === 1);
  };

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" }).catch((e) => {
    throw new Error(mask(e.message));
  });
  await page.goto(`${BASE}/studio/onboarding/${clone.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 });
  await page.waitForTimeout(1400);

  // ── host 1: the Logic step ──
  await page.locator('[data-testid="logic-add-question"]').click();
  await exercise("logic");
  await modal.locator("button", { hasText: /^Five-point scale/ }).click();
  ok("logic: Five-point hides the rows and counts 5", /with 5 answers/.test(await modal.locator(".qz-lg-aqsum").innerText()) &&
    (await answers.count()) === 0);
  await shot("logic-2-five");
  await modal.locator("button", { hasText: /^Add question$/ }).click();
  const dFive = await draftWhere((d) => d.nodes.some((n) => n.data?.text === "Probe question?"));
  const five = dFive.nodes.find((n) => n.data?.text === "Probe question?");
  ok("logic: Five-point lands with 1–5 and the 1–5 preset",
    five?.data.question_type === "rating" && five.data.answers.map((a) => a.text).join(",") === "1,2,3,4,5" &&
    five.data.scale_config?.min === 1 && five.data.scale_config?.max === 5);

  // ── host 2: the Questions step ──
  await page.getByRole("button", { name: /Questions/ }).first().click();
  await page.waitForSelector('[data-testid="questions-walkthrough"]', { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Add question", exact: true }).first().click();
  await exercise("questions");
  await shot("questions-2-filled");
  await modal.getByLabel("Question", { exact: true }).fill("Probe single?");
  await modal.locator("button", { hasText: /^Add question$/ }).click();
  const dOne = await draftWhere((d) => d.nodes.some((n) => n.data?.text === "Probe single?"));
  const one = dOne.nodes.find((n) => n.data?.text === "Probe single?");
  ok("questions: the new question lands with its three answers in order",
    one?.data.question_type === "single_select" && one.data.answers.map((a) => a.text).join(",") === "Alpha,Charlie,Bravo");

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser?.close();
  await clone.drop();
  await prisma.$disconnect();
}
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
