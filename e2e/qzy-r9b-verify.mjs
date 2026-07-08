// QZY-R9-2 live-verify — override-writes-a-rule reflected in the Table.
// The local fixture has NO resolvable categories, so the override PICKER can't
// be driven live (that path is covered by createRuleWithConditions' unit tests
// + the mutation's own contract). Here we prove the OTHER half: a rule in the
// stack re-badges the affected path "rule" (via R1's ruleOverridden) and
// DELETING it reverts — the LV4 acceptance. Rule seeded/removed with prisma,
// wrapped in try/finally so the fixture is ALWAYS restored (net-zero).
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
const seededRules = Number((backup.decision_rules ?? []).length);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).split("\n")[0]));

async function openTableExpandAll() {
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.locator(".qz-builder-rail button", { hasText: "Logic" }).click();
  await page.waitForTimeout(400);
  await page.locator(".qz-logic-tab", { hasText: "Table" }).click();
  await page.waitForTimeout(300);
  const n = await page.locator(".qz-ltable-group").count();
  for (let i = 0; i < n; i++) {
    await page.locator(".qz-ltable-group").nth(i).click();
    await page.waitForTimeout(120);
  }
}

try {
  // Baseline — no rules → no "rule" badges. Override affordance is gated on
  // categories (0 here) so it must be absent too.
  await openTableExpandAll();
  ok("baseline: no rule badges (no rules)", (await page.locator(".qz-ltable-ruled").count()) === 0);
  ok("override affordance gated off when no categories",
    (await page.locator(".qz-ltable-override").count()) === 0);
  const baseSkips = await page.locator(".qz-ltable-skip").count();

  // Seed a path-signature rule: "Q(decider) is Carving groomers → (all-mountain
  // bucket)". The two carving paths become rule-overridden + regroup.
  const rule = {
    id: "rule_r9b_test",
    conditions: [{ question_id: "q_decide", answer_id: "a_carve", op: "is" }],
    target_id: "cmptr2kib002dvkmrz1hxxf9m",
  };
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: { ...backup, decision_rules: [...(backup.decision_rules ?? []), rule] } },
  });

  await openTableExpandAll();
  const badges = await page.locator(".qz-ltable-ruled").count();
  ok("a seeded rule re-badges the affected paths 'rule'", badges === 2, `badges=${badges}`);
  ok("skipped-cell count unchanged by the rule (structure stable)",
    (await page.locator(".qz-ltable-skip").count()) === baseSkips);

  // Delete the rule (the Map's delete path) → revert.
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: backup } });
  await openTableExpandAll();
  ok("deleting the rule reverts the badges", (await page.locator(".qz-ltable-ruled").count()) === 0);
  ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
} finally {
  // ALWAYS restore the exact original draft (net-zero), whatever happened.
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: backup } });
  const after = await prisma.quiz.findUnique({ where: { id: QUIZ } });
  ok("net-zero: fixture rule count restored",
    Number((after.draftJson.decision_rules ?? []).length) === seededRules);
  await prisma.$disconnect();
  await browser.close();
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
