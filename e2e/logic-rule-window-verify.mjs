// Logic step redesign — the rule window + Add recommendations + Paste rules
// (agent E; D12, D13, D15, D24, B2) live-verify against a LOCAL production
// build + local DB, in BOTH logic styles. Works on a throwaway COPY of the
// Logic fixture (e2e/logic-fixture-clone.mjs), deleted in `finally`, so the
// shared fixture is never touched.
//
//   BASE=http://localhost:3747 node --env-file=.env e2e/logic-rule-window-verify.mjs
//
// Screenshots (1440×950 and 1280×720) land in $SHOTS_DIR.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { cloneLogicFixture } from "./logic-fixture-clone.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-rule-window-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing (node --env-file=.env …)");
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

const copies = [];
let browser;
try {
  // Filter Results + Rules copy: the fixture as it stands (q1 picks, q2
  // narrows, q3 info; one stored Pin rule "lwrule1"), plus a second rule so
  // delete / duplicate / binding have something to act on.
  const filter = await cloneLogicFixture(prisma, {
    name: "[probe] rule window · filter",
    mutateDoc: (d) => {
      d.logic_style = "attributes";
      const q1 = d.nodes.find((n) => n.id === "q1");
      const q2 = d.nodes.find((n) => n.id === "q2");
      q2.data.max_selections = 2;
      d.decision_rules.push({
        id: "probe_r2",
        conditions: [{ question_id: "q1", answer_id: q1.data.answers[1].id, op: "is" }],
        target_id: d.decision_rules[0].target_id,
        action: "show",
      });
      return d;
    },
  });
  copies.push(filter);
  const rulesOnly = await cloneLogicFixture(prisma, {
    name: "[probe] rule window · rules only",
    mutateDoc: (d) => {
      d.logic_style = "rules";
      return d;
    },
  });
  copies.push(rulesOnly);

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
  const win = page.locator('[data-testid="rule-window"]');
  const box = (loc) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  const toastText = async () => (await page.locator(".qz-toast").allTextContents()).join(" | ");
  const waitSaved = async (copy, pred, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const d = await copy.read();
      if (pred(d)) return d;
      await page.waitForTimeout(250);
    }
    return copy.read();
  };
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  const openStep = async (copy) => {
    await goto(`${BASE}/studio/onboarding/${copy.id}`);
    await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 });
    await page.waitForTimeout(700);
  };

  await goto(`${BASE}/studio?key=${KEY}`);

  // ══════════════════════════════════════════════════════════════════════
  // A · Filter Results + Rules
  // ══════════════════════════════════════════════════════════════════════
  await openStep(filter);
  await page.locator('[data-testid="logic-tab-card"] .qz-lg-rcol-h .qz-lg-btn').click();
  await win.waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  ok("A1 no title bar; aria-label Create a rule", (await win.getAttribute("aria-label")) === "Create a rule" &&
    (await win.locator("h2").count()) === 0);
  ok("A2 focus lands on the chosen verb", await page.evaluate(() => document.activeElement?.textContent === "Show" &&
    document.activeElement?.getAttribute("aria-pressed") === "true"));
  const verbs = await win.locator(".qz-lg-vseg button").allTextContents();
  ok("A3 Filter offers Show / Pin / Hide", verbs.join(",") === "Show,Pin,Hide", verbs.join(","));
  ok("A4 hint for Show", (await win.locator(".qz-lg-vhint").textContent()) === "these become the results");
  await win.locator(".qz-lg-vseg button", { hasText: "Pin" }).click();
  ok("A5 hint follows the verb", (await win.locator(".qz-lg-vhint").textContent()) === "these move to the top");
  ok("A6 band fraction reads are covered", /\d+\/\d+ are covered/.test(await win.locator(".qz-lg-frac").textContent()));
  const wb = await box(win);
  ok("A7 box at least 680px wide and never taller than the viewport", wb.w >= 679 && wb.h <= 950, `${wb.w}×${wb.h}`);
  const bk = await box(win.locator(".qz-lg-mrow").first().locator(".qz-lg-bk").first());
  ok("A8 answer bucket is 104 × 68", Math.abs(bk.w - 104) < 1 && Math.abs(bk.h - 68) < 1, `${bk.w}×${bk.h}`);
  const rows = win.locator(".qz-lg-mrow");
  ok("A9 one row per question", (await rows.count()) === 3);
  ok("A10 multi-select type tag", /Multi-select · pick 1–2/i.test((await rows.nth(1).locator(".qz-lg-mtag").textContent()) ?? ""));
  ok("A11 page behind is inert and its scroll locked", await page.evaluate(() => {
    const card = document.querySelector('[data-testid="logic-tab-card"]');
    return !!card?.closest("[inert]") && document.documentElement.style.overflow === "hidden";
  }));
  await shot("A-create-filter");

  // Picks: Q2 two answers → any of ⇄ appears; all of; is not hides it (D12).
  const q2 = rows.nth(1);
  await q2.locator(".qz-lg-bk").nth(0).click();
  await q2.locator(".qz-lg-bk").nth(1).click();
  ok("A12 two picks on a multi-select show any of ⇄", /any of ⇄/.test(await q2.locator(".qz-lg-opb.is-sub").textContent()));
  await q2.locator(".qz-lg-bk").nth(2).click();
  await q2.locator(".qz-lg-opb.is-sub").click();
  const warn = await q2.locator(".qz-lg-mwarn").textContent().catch(() => "");
  ok("A13 all of over the max warns and blocks saving",
    /at most 2 here, so all 3 can never happen together/.test(warn ?? "") &&
    (await win.locator(".qz-lg-mfoot .qz-lg-btn.is-pri").isDisabled()), warn ?? "");
  await shot("A-allof-warning");
  await q2.locator(".qz-lg-opb").first().click(); // is → is not
  ok("A14 is-not row hides the join but keeps its slot",
    (await q2.locator(".qz-lg-opb.is-gone").count()) === 1 &&
    (await q2.locator(".qz-lg-opb.is-gone").evaluate((el) => getComputedStyle(el).visibility)) === "hidden" &&
    (await q2.locator(".qz-lg-mwarn").count()) === 0);
  await shot("A-is-not-row");
  await q2.locator(".qz-lg-opb").first().click(); // back to is (any of again)
  // A single-select second pick → stated any of.
  const q1 = rows.nth(0);
  await q1.locator(".qz-lg-bk").nth(0).click();
  // Pick a recommendation.
  await win.locator(".qz-lg-rc-t").first().click();
  const say = await win.locator(".qz-lg-msay").textContent();
  ok("A15 footer sentence is verb-first, answers-only", /^Pin .+ when /.test(say ?? ""), say ?? "");
  const saveBtn = win.locator(".qz-lg-mfoot .qz-lg-btn.is-pri");
  ok("A16 Create rule enabled once answers + recommendation + possible", !(await saveBtn.isDisabled()));
  // Toast never sits on the footer: Create & add another keeps the window.
  await win.locator(".qz-lg-mfoot .qz-lg-btn", { hasText: "Create & add another" }).click();
  await page.waitForTimeout(400);
  ok("A17 toast Rule created", /Rule created/.test(await toastText()));
  const tb = await box(page.locator(".qz-toast").first());
  const fb = await box(win.locator(".qz-lg-mfoot"));
  ok("A18 the toast clears the window's footer (B34)", tb.y >= fb.y + fb.h - 1 || tb.y + tb.h <= fb.y + 1, `toast y${tb.y} foot y${fb.y}+${fb.h}`);
  await shot("A-toast-over-window");
  ok("A19 & add another lands on a blank draft at the top, focus on the verb",
    (await win.locator(".qz-lg-bk.is-on").count()) === 0 &&
    (await win.locator(".qz-lg-mscroll").evaluate((el) => el.scrollTop)) === 0 &&
    (await page.evaluate(() => document.activeElement?.textContent === "Show")));
  let d = await waitSaved(filter, (x) => x.decision_rules.length === 3);
  const made = d.decision_rules[2];
  ok("A20 the saved rule: prioritize, q1 + q2 any_of on q2", made?.action === "prioritize" &&
    made.conditions.length === 4 && JSON.stringify(made.any_of) === '["q2"]' && !("match" in made), JSON.stringify(made));

  // Add recommendations over the rule window (D15).
  await win.locator(".qz-lg-addelse").click();
  const ar = page.locator(".qz-lg-arbox");
  await ar.waitFor({ timeout: 5000 });
  await page.waitForTimeout(250);
  ok("B1 search focused on open", await page.evaluate(() => document.activeElement?.classList.contains("qz-lg-arsearch")));
  ok("B2 the rule window is inert under it", await win.evaluate((el) => !!el.closest("[inert]")));
  const tabs = await ar.locator(".qz-lg-artabs button").allTextContents();
  ok("B3 tabs All / Collections / Tags / Products / Custom groups with counts",
    /^All\d+,Collections\d+,Tags\d+,Products\d+,Custom groups\d+$/.test(tabs.join(",")), tabs.join(","));
  ok("B4 a row already in the quiz is checked + disabled", (await ar.locator(".qz-lg-arsel:disabled").count()) >= 1 &&
    (await ar.locator(".qz-lg-ct", { hasText: "In this quiz" }).count()) >= 1);
  await shot("B-add-recs-over-window");
  await page.keyboard.type('<b>x</b>"');
  ok("B5 a query renders literally", (await ar.locator(".qz-lg-arempty").textContent()) === 'Nothing matches “<b>x</b>"”.');
  await ar.locator(".qz-lg-arsearch").fill("");
  // Esc closes only this window, the draft stays.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  ok("B6 Esc closes Add recommendations only", (await ar.count()) === 0 && (await win.count()) === 1);
  // Failure: ensure-targets aborted → the window stays open, picks ticked.
  await win.locator(".qz-lg-addelse").click();
  await ar.waitFor();
  await ar.locator(".qz-lg-artabs button", { hasText: "Tags" }).click();
  const freeTag = ar.locator(".qz-lg-arsel:not(:disabled)").first();
  const tagName = await freeTag.locator(".qz-lg-nm").textContent();
  await freeTag.click();
  await page.route("**/api/categories/ensure-targets", (r) => r.abort());
  await ar.locator(".qz-lg-arfoot .qz-lg-btn.is-pri").click();
  await page.waitForTimeout(500);
  ok("B7 a failed Add keeps the window open with the pick ticked",
    (await ar.count()) === 1 && (await ar.locator(".qz-lg-arrow.is-on").count()) === 1 &&
    /Nothing was added/.test(await toastText()));
  await page.unroute("**/api/categories/ensure-targets");
  await ar.locator(".qz-lg-arfoot .qz-lg-btn.is-pri").click();
  await page.waitForTimeout(900);
  ok("B8 Add lifts the row and picks it for this rule", (await ar.count()) === 0 &&
    /Added and picked for this rule/.test(await toastText()) &&
    (await win.locator(".qz-lg-rc.is-on", { hasText: tagName ?? "" }).count()) === 1, tagName ?? "");
  const cats = await prisma.category.findMany({ where: { quizId: filter.id, discoveryRunId: `logic-tab-${filter.id}` } });
  ok("B9 the new row is quiz-scoped and stamped logic-tab", cats.length === 1 && cats[0].source === "tag", JSON.stringify(cats.map((c) => c.sourceRef)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok("A21 Esc closes the rule window; focus returns to + Add",
    (await win.count()) === 0 && (await page.evaluate(() => document.activeElement?.textContent?.trim() === "+ Add")));

  // Edit → Duplicate → Undo closes the window (B2 binding).
  await page.locator('[data-rule-id="probe_r2"] .qz-lg-rbody').click();
  await win.waitFor();
  ok("C1 edit window labelled Edit rule, bound to its id", (await win.getAttribute("aria-label")) === "Edit rule" &&
    (await win.getAttribute("data-rule-id")) === "probe_r2");
  await win.locator(".qz-lg-mdel.is-dup").click();
  await page.waitForTimeout(400);
  const copyId = await win.getAttribute("data-rule-id");
  ok("C2 Duplicate moves the window onto the copy", copyId !== "probe_r2" && /Rule 3 is a copy of rule 2 · you are editing the copy/.test(await toastText()), await toastText());
  d = await waitSaved(filter, (x) => x.decision_rules.length === 4);
  ok("C3 the copy sits directly below", d.decision_rules[2]?.id === copyId, d.decision_rules.map((r) => r.id).join(","));
  await shot("C-duplicate");
  await page.locator(".qz-toast button").first().click();
  await page.waitForTimeout(500);
  ok("C4 Undo removes the copy; the window closes and says why", (await win.count()) === 0 &&
    /Undone. The rule you had open is gone/.test(await toastText()), await toastText());
  // Delete from the window.
  await page.locator('[data-rule-id="probe_r2"] .qz-lg-rbody').click();
  await win.waitFor();
  await win.locator(".qz-lg-mdel:not(.is-dup)").click();
  await page.waitForTimeout(400);
  ok("C5 Delete rule closes the window with Rule 2 deleted + Undo",
    (await win.count()) === 0 && /Rule 2 deleted/.test(await toastText()) && (await page.locator(".qz-toast button", { hasText: "Undo" }).count()) === 1);
  ok("C6 the Undo has keyboard focus", await page.evaluate(() => document.activeElement?.textContent === "Undo"));
  await page.keyboard.press("Enter");
  d = await waitSaved(filter, (x) => x.decision_rules.some((r) => r.id === "probe_r2"));
  ok("C7 Undo restores it at its place", d.decision_rules[1]?.id === "probe_r2", d.decision_rules.map((r) => r.id).join(","));

  // B2: delete rule 1, open rule 2 while its Undo is up, Undo, Save.
  // Let the autosave settle on what the page shows before taking the baseline.
  const shown = await page.locator('[data-testid="logic-tab-card"] li[data-rule-id]').count();
  const before = JSON.stringify((await waitSaved(filter, (x) => x.decision_rules.length === shown, 8000)).decision_rules);
  await page.locator('[data-rule-id="lwrule1"] .qz-lg-xdel').click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('[data-rule-id="probe_r2"] .qz-lg-rbody').click();
  await win.waitFor();
  await page.locator(".qz-toast button", { hasText: "Undo" }).click();
  await page.waitForTimeout(300);
  ok("C8 the window stays bound to its rule through an unrelated Undo", (await win.getAttribute("data-rule-id")) === "probe_r2");
  await win.locator(".qz-lg-mrow").first().locator(".qz-lg-bk").nth(0).click();
  await win.locator(".qz-lg-mfoot .qz-lg-btn.is-pri").click();
  d = await waitSaved(filter, (x) => x.decision_rules.find((r) => r.id === "probe_r2")?.conditions.length === 2);
  const b = JSON.parse(before);
  const changed = d.decision_rules.filter((r) => JSON.stringify(r) !== JSON.stringify(b.find((x) => x.id === r.id)));
  ok("C9 only the edited rule changed", changed.length === 1 && changed[0].id === "probe_r2" && d.decision_rules.length === b.length,
    `${changed.map((r) => r.id).join(",")} · ${d.decision_rules.length} vs ${b.length}`);

  // ══════════════════════════════════════════════════════════════════════
  // E · Paste rules splits a cross-question "or" (D13)
  // ══════════════════════════════════════════════════════════════════════
  const nBefore = (await waitSaved(filter, () => false, 1200)).decision_rules.length;
  await page.locator(".qz-lg-rcol-f .qz-lg-link", { hasText: "Paste rules" }).click();
  await page.locator(".qz-lm-paste textarea").fill("when A snowboard or Powder float then show QS Boards");
  await page.waitForTimeout(250);
  await page.locator(".qz-lm-paste .qz-btn-primary").click();
  d = await waitSaved(filter, (x) => x.decision_rules.length >= nBefore + 2);
  const pasted = d.decision_rules.slice(nBefore);
  ok("E1 one pasted cross-question or → two adjacent rules, same verb and target, no match",
    pasted.length === 2 && pasted.every((r) => !("match" in r) && r.action === "show" && r.target_id === pasted[0].target_id) &&
    pasted[0].conditions[0].question_id !== pasted[1].conditions[0].question_id &&
    /2 rules created/.test(await toastText()), JSON.stringify(pasted));

  // ══════════════════════════════════════════════════════════════════════
  // D · Rules only
  // ══════════════════════════════════════════════════════════════════════
  await openStep(rulesOnly);
  await page.locator('[data-rule-id="lwrule1"] .qz-lg-rbody').click();
  await win.waitFor();
  await page.waitForTimeout(250);
  ok("D1 Rules only offers Show alone", (await win.locator(".qz-lg-vseg button").allTextContents()).join(",") === "Show");
  ok("D2 a stored Pin opens as Show and says so",
    (await win.locator(".qz-lg-vhint").textContent()) ===
      "Pin only works in Filter Results + Rules · saving makes this a Show rule");
  ok("D3 fraction reads have a rule", /\d+\/\d+ have a rule/.test(await win.locator(".qz-lg-frac").textContent()));
  await shot("D-edit-rules-only");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  const small = await box(win);
  ok("D4 at 1280×720 the window stays inside the viewport", small.y >= 0 && small.y + small.h <= 720, `${small.y}+${small.h}`);
  await shot("D-edit-rules-only-1280");
  await page.setViewportSize({ width: 1440, height: 950 });
  await win.locator(".qz-lg-mx").click();
  // The strip's "+ Create a rule" prefills its recommendation.
  const pill = page.locator(".qz-lg-rpill.is-none").first();
  if (await pill.count()) {
    const recName = await pill.locator(".qz-lg-rpill-n").textContent();
    await pill.click();
    await win.waitFor();
    // The edit window closed a moment ago: wait for the NEW draft to seed
    // (reading at once could catch the old window's last frame).
    await page
      .waitForFunction(
        (name) =>
          [...document.querySelectorAll(".qz-lg-rc.is-on")].some((el) => (el.textContent ?? "").includes(name)),
        recName ?? "",
        { timeout: 3000 },
      )
      .catch(() => {});
    ok("D5 + Create a rule opens a create draft with that recommendation picked",
      (await win.getAttribute("aria-label")) === "Create a rule" &&
      (await win.locator(".qz-lg-rc.is-on", { hasText: recName ?? "" }).count()) === 1,
      `${recName} · ${await win.getAttribute("aria-label")} · on=${(await win.locator(".qz-lg-rc.is-on").allTextContents()).join("/")}`);
    await shot("D-prefill");
    await page.keyboard.press("Escape");
  } else ok("D5 (no uncovered pill on this copy)", true);
  // The strip's Add recommendations (not the rule window).
  await page.locator(".qz-lg-rpill.is-add", { hasText: "+ Add recommendations" }).click();
  const ar2 = page.locator(".qz-lg-arbox");
  await ar2.waitFor();
  await ar2.locator(".qz-lg-artabs button", { hasText: "Products" }).click();
  const p1 = ar2.locator(".qz-lg-arsel:not(:disabled)").first();
  await p1.click();
  await ar2.locator(".qz-lg-arfoot .qz-lg-btn.is-pri").click();
  await page.waitForTimeout(900);
  ok("D6 the strip's Add says it needs a rule", /Added 1 recommendation\. It needs a rule/.test(await toastText()), await toastText());

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  failures++;
  console.error("✗ probe crashed:", mask(e?.stack ?? e));
} finally {
  await browser?.close();
  for (const c of copies) await c.drop();
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
