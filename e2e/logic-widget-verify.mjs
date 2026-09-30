// QWIDGET — the Logic step's question widget, re-pinned to the Logic step
// redesign (mock rules-row/index.html railItems / pane / picker; handoff
// "Filter Results + Rules · Edit", D14, D18, D23). Live-verify against a
// LOCAL production build + local DB, on a THROWAWAY clone of the fixture
// cmr7khgd50001vkhscvox8dgt (e2e/logic-fixture-clone.mjs; deleted at the end):
// q1 single-select PICKS with two mapped answers · q2 multi-select NARROWS ·
// q3 rating INFO · three quiz-scoped recommendations (QS Boards, QS
// Accessories, Accessory).
//
// Pins the QWIDGET-M data contract through the new UI: a picking answer
// holds SEVERAL recommendations (target_ids, target_id mirrors [0]), placing
// ADDS, each chip's × removes only itself and a length-1 list collapses back
// to target_id alone; the step's own recommendations surface in the tray
// (text chips in catalogue order, green when unplaced, D14); Info cells are
// inert (D23); a multi-select question may pick the result.
// The broader pane (type line, role Undo, value picker, route menu, Add a
// question, keyboard) is e2e/logic-filter-verify.mjs.
//
//   BASE=http://localhost:3718 node --env-file=.env e2e/logic-widget-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { cloneFixture } from "./logic-fixture-clone.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-widget-shots";
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

const clone = await cloneFixture(prisma, { name: "Logic widget probe" });
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const draftWhere = async (pred, ms = 6000) => {
    const end = Date.now() + ms;
    for (;;) {
      const d = await clone.draft();
      if (pred(d) || Date.now() > end) return d;
      await page.waitForTimeout(250);
    }
  };
  const card = page.locator('[data-testid="logic-tab-card"]');
  const rail = card.locator(".qz-lg-rail");
  const pane = card.locator('[data-testid="logic-question-pane"]');
  const rows = pane.locator(".qz-lg-arow");
  const rowA = rows.nth(0);
  const cellA = rowA.locator(".qz-lg-cell");
  const tray = pane.locator('[data-testid="logic-tray"]');

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" }).catch((e) => {
    throw new Error(mask(e.message));
  });
  await page.goto(`${BASE}/studio/onboarding/${clone.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 });
  await settle(1200);

  // 1 ── the widget in the card: rail + pane + the rules column (D22)
  ok("rail + one pane + the rules column", (await rail.count()) === 1 && (await pane.count()) === 1 &&
    (await card.locator(".qz-lg-rcol").count()) === 1);
  ok("rail tags Picks · Narrows · Info",
    (await rail.locator(".qz-lg-qtag").allInnerTexts()).map((t) => t.trim().toLowerCase()).join(" · ") === "picks · narrows · info");

  // 2 ── the tray: the step's recommendations, text chips, catalogue order
  const names = (await tray.locator(".qz-lg-tchip:not(.is-more)").allInnerTexts()).map((t) => t.trim());
  ok("tray labelled Recommendations (D18), three text chips, no thumbnails",
    /^recommendations$/i.test((await tray.locator(".qz-lg-tray-lb").innerText()).trim()) &&
    names.length === 3 && ["QS Boards", "QS Accessories", "Accessory"].every((n) => names.includes(n)) &&
    (await tray.locator("img").count()) === 0, names.join(" | "));
  ok("placed chips are black, the unplaced one green (D14)",
    (await tray.locator(".qz-lg-tchip.is-fresh").allInnerTexts()).join() === "Accessory");
  await page.screenshot({ path: `${SHOTS}/1-decides.png` });

  // 3 ── multi-map through the picker: a second row ADDS
  const beforeA = qNode(await clone.draft(), "q1").data.answers[0].target_id;
  await cellA.click();
  await page.waitForSelector('[data-testid="picks-picker"]', { timeout: 3000 });
  const picker = page.locator(".qz-popover");
  ok("the current target is the checked row",
    (await picker.locator('[role="checkbox"][aria-checked="true"]').innerText()).includes("QS Boards"));
  await picker.locator('[role="checkbox"]', { hasText: "Accessory" }).first().click();
  const a0 = qNode(await draftWhere((d) => (qNode(d, "q1").data.answers[0].target_ids ?? []).length === 2), "q1").data.answers[0];
  ok("a second row ADDS (picker stays open, two chips, mirror = first entry)",
    (await picker.count()) === 1 && (await rowA.locator(".qz-lg-chip").count()) === 2 &&
    a0.target_id === beforeA && a0.target_ids?.[0] === beforeA && a0.target_ids.length === 2);
  await page.screenshot({ path: `${SHOTS}/2-picker.png` });
  await page.keyboard.press("Escape");
  await settle(250);

  // 4 ── per-chip ×: removes only that one, collapses to target_id alone
  await rowA.hover();
  await rowA.locator(".qz-lg-chipw", { hasText: "Accessory" }).locator(".qz-lg-xone").click();
  const a0b = qNode(await draftWhere((d) => !("target_ids" in qNode(d, "q1").data.answers[0])), "q1").data.answers[0];
  ok("× removes ONLY that one; length-1 collapses back to target_id alone",
    (await rowA.locator(".qz-lg-chip").count()) === 1 && a0b.target_id === beforeA && !("target_ids" in a0b));

  // 5 ── arm and place ADDS; a cell that already holds it adds nothing
  await tray.locator(".qz-lg-tchip", { hasText: "QS Boards" }).click();
  ok("a cell already holding the armed chip says so", /QS Boards is already here/.test((await cellA.getAttribute("aria-label")) ?? ""));
  await cellA.click();
  await settle(500);
  ok("clicking it adds nothing and disarms",
    (await rowA.locator(".qz-lg-chip").count()) === 1 && (await tray.locator(".qz-lg-tchip.is-armed").count()) === 0);
  await tray.locator(".qz-lg-tchip", { hasText: "Accessory" }).click();
  await page.screenshot({ path: `${SHOTS}/3-armed.png` });
  await cellA.click();
  await draftWhere((d) => (qNode(d, "q1").data.answers[0].target_ids ?? []).length === 2);
  ok("placing ADDS the chip (two again)", (await rowA.locator(".qz-lg-chip").count()) === 2);

  // 6 ── info rows are inert (D23)
  await rail.locator(".qz-lg-qi").nth(2).click();
  await settle(500);
  ok("info question: inert dashes, no picker, no ×",
    (await pane.locator(".qz-lg-cell.is-inert").count()) === 5 && (await pane.locator(".qz-lg-cell:not(.is-inert), .qz-lg-xone").count()) === 0);

  // 7 ── decision 2: a multi-select question can pick the result
  await rail.locator(".qz-lg-qi").nth(1).click();
  await settle(500);
  await pane.locator(".qz-lg-rolebtn").click();
  await page.waitForSelector('[data-testid="role-menu"]', { timeout: 3000 });
  const picks = page.locator('.qz-popover [role="menuitemradio"]', { hasText: "Picks the result" });
  ok("the role menu offers Picks the result to a multi-select", (await picks.count()) === 1 && !(await picks.isDisabled()));
  await picks.click();
  const d2 = await draftWhere((d) => qNode(d, "q2").data.role === "decides");
  ok("the multi-select now picks; the old one is Info",
    qNode(d2, "q2").data.role === "decides" && qNode(d2, "q1").data.role === "qualifier");
  ok("the tray shows for it, the rail tag flipped to Picks",
    (await pane.locator('[data-testid="logic-tray"]').count()) === 1 && /picks/i.test(await rail.locator(".qz-lg-qi").nth(1).innerText()));
  await page.screenshot({ path: `${SHOTS}/4-multi-decides.png` });

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await clone.drop();
  await prisma.$disconnect();
  await browser?.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
}
process.exit(failures ? 1 : 0);
