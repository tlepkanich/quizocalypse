// QZY-R8-2 live-verify — the shared global rules stack, pinned above all three
// Logic tabs. Fixture has 0 rules, so we seed one (prisma, try/finally restore
// → net-zero) and assert the bar shows on Map/Paths/Table + jumps to the Map.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
if (!KEY) { console.error("no token"); process.exit(1); }
let failures = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };

const prisma = new PrismaClient();
const before = await prisma.quiz.findUnique({ where: { id: QUIZ } });
const backup = before.draftJson;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).split("\n")[0]));

async function openLogic() {
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.locator(".qz-builder-rail button", { hasText: "Logic" }).click();
  await page.waitForTimeout(400);
}

try {
  // Baseline: no rules → the bar is absent (no clutter).
  await openLogic();
  ok("no rules → rules bar hidden", (await page.locator(".qz-logic-rules").count()) === 0);

  // Seed one rule.
  const rule = {
    id: "rule_r8b_test",
    conditions: [{ question_id: "q_decide", answer_id: "a_park", op: "is" }],
    target_id: "cmptr2kib002cvkmrnt91y5i9",
  };
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: { ...backup, decision_rules: [...(backup.decision_rules ?? []), rule] } },
  });

  await openLogic();
  ok("rules bar appears above the tabs (Map)", (await page.locator(".qz-logic-rules").count()) === 1);
  ok("bar lists the rule with an R1 priority + plain-language summary",
    (await page.locator(".qz-logic-rule-pri", { hasText: "R1" }).count()) === 1 &&
      /If Q1 is/.test(await page.locator(".qz-logic-rule-text").first().innerText()),
    await page.locator(".qz-logic-rule-text").first().innerText());

  // Shared across tabs.
  await page.locator(".qz-logic-tab", { hasText: "Paths" }).click();
  await page.waitForTimeout(300);
  ok("rules bar shared on the Paths tab", (await page.locator(".qz-logic-rules").count()) === 1);
  await page.locator(".qz-logic-tab", { hasText: "Table" }).click();
  await page.waitForTimeout(300);
  ok("rules bar shared on the Table tab", (await page.locator(".qz-logic-rules").count()) === 1);

  // "Manage in Map" jumps back to the Map tab.
  await page.locator(".qz-logic-rules-manage").click();
  await page.waitForTimeout(300);
  ok("Manage-in-Map jumps to the Map tab",
    (await page.locator(".qz-logic-tab.is-active").innerText()) === "Map" &&
      (await page.locator('[aria-label="Logic map"]').count()) === 1);
  ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
} finally {
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: backup } });
  const after = await prisma.quiz.findUnique({ where: { id: QUIZ } });
  ok("net-zero: fixture rule count restored",
    Number((after.draftJson.decision_rules ?? []).length) === Number((backup.decision_rules ?? []).length));
  await prisma.$disconnect();
  await browser.close();
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
