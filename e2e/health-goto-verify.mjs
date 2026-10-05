// Builder health popover — every "Go to it" lands on its fix (the builder
// once handled only question and rule links, so a "never recommended" or a
// "needs a rule" finding closed the popover and did nothing), and "Fix N
// issues" opens the report from every view, not only Build. Live-verify
// against a LOCAL production build + local DB.
//
// Runs on THROWAWAY clones of the local fixture cmr7khgd50001vkhscvox8dgt
// (e2e/logic-fixture-clone.mjs); each clone is deleted at the end.
// Fixture shape: q1 single-select PICKS (A → QS Boards, B → QS Accessories;
// "Accessory" on no answer), one rule (prioritize QS Boards).
//
//   BASE=http://localhost:3000 node --env-file=.env e2e/health-goto-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { cloneFixture } from "./logic-fixture-clone.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/health-goto-shots";
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

const clones = [];
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  const card = page.locator('[data-testid="logic-tab-card"]');
  const health = page.locator(".qz-s3-health");
  const ruleWindow = page.locator('[data-testid="rule-window"]');

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" }).catch((e) => {
    throw new Error(mask(e.message));
  });

  const openBuilder = async (name, mutate) => {
    const clone = await cloneFixture(prisma, { name });
    clones.push(clone);
    if (mutate) await clone.setDraft(mutate(await clone.draft()));
    await page.goto(`${BASE}/studio/${clone.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-s3-healthpill", { timeout: 20000 });
    await settle(1200);
    return clone;
  };
  // The finding's own jump control: a "Go to it" link in the check list, or
  // the whole row in the publish-blocked card.
  // The pill is Build-view chrome: step back to Build when another view is up.
  const openHealth = async () => {
    if ((await page.locator(".qz-s3-healthpill").count()) === 0) {
      await page.locator(".qz-builder-rail-item", { hasText: "Build" }).click();
      await settle(700);
    }
    await page.locator(".qz-s3-healthpill").click();
    await health.waitFor({ timeout: 5000 });
  };
  const goTo = async (text) => {
    await openHealth();
    const listed = health.locator(".qz-ql-check-findings li", { hasText: text }).first();
    if (await listed.count()) await listed.locator(".qz-ql-report-goto").click();
    else await health.locator("button.qz-pb-row", { hasText: text }).first().click();
    await settle();
  };

  // ── 1. Filter Results + Rules: "never recommended" arms the recommendation ─
  const filter = await openBuilder("Health goto probe (filter)");
  ok("the pill counts something to review", /to review/.test((await page.locator(".qz-s3-healthpill").textContent()) ?? ""));
  await goTo("“Accessory” is never recommended");
  ok("the popover closed", (await health.count()) === 0);
  ok("the Logic view opened", (await card.count()) === 1);
  ok("the picking question is selected", (await card.locator('.qz-lg-qi.is-on[data-node-id="q1"]').count()) === 1);
  ok("the recommendation is armed in the tray", ((await card.locator(".qz-lg-tchip.is-armed").textContent()) ?? "").includes("Accessory"));
  const drops = card.locator(".qz-lg-cell.is-drop");
  ok("every answer offers to place it", (await drops.count()) === 2, `${await drops.count()} drop cells`);
  ok("the first answer cell holds the focus", await drops.first().evaluate((el) => el === document.activeElement));
  await shot("01-filter-armed");
  await drops.first().click();
  await settle(1600);
  const accessory = await prisma.category.findFirst({
    where: { quizId: filter.id, name: "Accessory" },
    select: { id: true },
  });
  const placed = (await filter.draft()).nodes.find((n) => n.id === "q1").data.answers[0];
  ok(
    "one click places it on the answer",
    [placed.target_id, ...(placed.target_ids ?? [])].includes(accessory?.id),
    JSON.stringify(placed.target_ids),
  );
  await openHealth();
  ok("the finding is gone from the report", (await health.locator("li", { hasText: "“Accessory” is never recommended" }).count()) === 0);
  await shot("02-filter-resolved");
  await page.keyboard.press("Escape");

  // ── 2. Rules only: "never recommended" opens the rule window, filled in ────
  await openBuilder("Health goto probe (rules)", (doc) => ({ ...doc, logic_style: "rules" }));
  await goTo("“Accessory” is never recommended");
  ok("the rule window opened", (await ruleWindow.count()) === 1);
  ok("the recommendation is already chosen", (await ruleWindow.locator('.qz-lm-tcard.is-on [aria-label="Accessory"]').count()) === 1);
  await shot("03-rules-window");
  await ruleWindow.locator(".qz-lg-mx").click();
  await settle(500);
  ok("the rule window closed", (await ruleWindow.count()) === 0);
  // A stale request must not re-fire when the Logic view remounts.
  await page.locator(".qz-builder-rail-item").first().click();
  await settle(500);
  await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
  await settle(900);
  ok("back in the Logic view", (await card.count()) === 1);
  ok("the rule window stays closed after leaving and returning", (await ruleWindow.count()) === 0);

  // ── 3. Rules only, no rules: "needs a rule" opens a blank rule window ──────
  await openBuilder("Health goto probe (no rules)", (doc) => ({
    ...doc,
    logic_style: "rules",
    decision_rules: [],
  }));
  await goTo("Rules only needs at least one rule");
  ok("the Logic view opened", (await card.count()) === 1);
  ok("a blank rule window opened", (await ruleWindow.count()) === 1 && (await ruleWindow.locator(".qz-lm-tcard.is-on").count()) === 0);
  await shot("04-no-rules-window");
  await ruleWindow.locator(".qz-lg-mx").click();
  await settle(400);

  // ── 4. A rule finding scrolls to the rule and opens it ────────────────────
  await openBuilder("Health goto probe (broken rule)", (doc) => ({
    ...doc,
    decision_rules: doc.decision_rules.map((r) => ({
      ...r,
      conditions: r.conditions.map((c) => ({ ...c, answer_id: "gone" })),
    })),
  }));
  await goTo("Rule 1");
  ok("the Logic view opened", (await card.count()) === 1);
  ok("the rule's own window opened", (await ruleWindow.count()) === 1);
  await shot("05-rule-window");
  await ruleWindow.locator(".qz-lg-mx").click();
  await settle(500);

  // ── 5. Off the stage, "Fix N issues" hosts the report itself ──────────────
  // (the pill is stagebar chrome: outside Build the button once opened nothing)
  const fixBtn = page.locator("button.is-blocked", { hasText: /^Fix \d+ issue/ });
  ok("still in the Logic view, with no pill", (await card.count()) === 1 && (await page.locator(".qz-s3-healthpill").count()) === 0);
  await fixBtn.click();
  await settle(500);
  ok("Fix N issues opens the report in the Logic view", (await health.count()) === 1);
  const box = await health.boundingBox();
  ok("the report sits inside the viewport", !!box && box.x >= 0 && box.x + box.width <= 1440 && box.y >= 0, JSON.stringify(box));
  await shot("06-fix-button-report");
  await health.locator("button.qz-pb-row", { hasText: "Rule 1" }).first().click();
  await settle();
  ok("its row jumps to the rule", (await health.count()) === 0 && (await ruleWindow.count()) === 1);
  await ruleWindow.locator(".qz-lg-mx").click();
  await settle(400);
  await fixBtn.click();
  await settle(400);
  await page.keyboard.press("Escape");
  await settle(300);
  ok("Esc closes the report", (await health.count()) === 0);
  await page.locator(".qz-builder-rail-item", { hasText: "Settings" }).click();
  await settle(700);
  await fixBtn.click();
  await settle(500);
  ok("Fix N issues opens the report in Settings", (await health.count()) === 1);
  await page.keyboard.press("Escape");
  // On the stage the pill still hosts it (one report, never two).
  await page.locator(".qz-builder-rail-item", { hasText: "Build" }).click();
  await settle(700);
  await fixBtn.click();
  await settle(500);
  ok("in Build the pill hosts the one report", (await health.count()) === 1 && (await page.locator(".qz-s3-healthpill").count()) === 1);
  await page.keyboard.press("Escape");

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  failures++;
  console.error("✗ probe crashed —", mask(e?.stack ?? e));
} finally {
  await browser?.close();
  for (const c of clones) await c.drop();
  await prisma.$disconnect();
}
console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
