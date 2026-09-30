// The rule window, D24 layout (owner 2026-09-17/18) — geometry and flows,
// against a LOCAL production build + local DB. Supersedes the one-screen
// 1,330px shell this probe used to pin (title bar, 130×62 buckets, 124px
// operator column, "N selected", "+ Add something else").
//
// Works on throwaway COPIES of the Logic fixture (e2e/logic-fixture-clone.mjs)
// deleted in `finally`; the shared fixture is never written.
//   A · funnel (flow "onboarding"): no title bar; What happens → Your
//       recommendations → When they answer; one scrolling body, pinned
//       footer; the box hugs its widest row (min 680, strips ≤ 676 with a
//       right fade); 104×68 buckets; 22/184/44 row grid; two-row band with
//       "See N more · K picked" (30 recommendations); 10 answers scroll
//       sideways; "Save & add another" in edit mode lands at the top.
//   B · builder (flow "builder", D6 parked): the "What the quiz shows"
//       catalogue band in the same slot; 13 raw picks save through
//       ensure-targets as batches of 12 + 1.
//
//   BASE=http://localhost:3747 node --env-file=.env e2e/create-rule-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { cloneLogicFixture } from "./logic-fixture-clone.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/create-rule-shots";
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
  // Stress copy: Q2 carries 10 answers; 30 recommendations.
  const stress = await cloneLogicFixture(prisma, {
    name: "[probe] rule window · D24 stress",
    mutateDoc: (d) => {
      d.logic_style = "rules";
      const q2 = d.nodes.find((n) => n.id === "q2");
      for (let i = q2.data.answers.length; i < 10; i++) {
        q2.data.answers.push({ ...q2.data.answers[0], id: `probe_a${i}`, text: `Extra answer number ${i + 1}` });
      }
      return d;
    },
  });
  copies.push(stress);
  const src = await prisma.category.findFirst({ where: { quizId: stress.id } });
  for (let i = 0; i < 27; i++) {
    await prisma.category.create({
      data: {
        shopId: src.shopId,
        quizId: stress.id,
        name: `Probe rec ${String(i + 1).padStart(2, "0")}`,
        description: "",
        tags: [],
        productIds: src.productIds,
        source: "manual",
        discoveryRunId: "probe",
      },
    });
  }
  const builder = await cloneLogicFixture(prisma, { name: "[probe] rule window · builder" });
  copies.push(builder);

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
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

  await goto(`${BASE}/studio?key=${KEY}`);

  // ══════════════════════════════════════════════════════════════════════
  // A · the funnel window (flow "onboarding"), Rules only
  // ══════════════════════════════════════════════════════════════════════
  await goto(`${BASE}/studio/onboarding/${stress.id}`);
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 }).catch(async (e) => {
    await shot("crash-A");
    console.log(mask((await page.innerText("body")).slice(0, 600)));
    throw e;
  });
  await page.waitForTimeout(700);
  await page.locator(".qz-lg-sact .qz-lg-btn.is-pri").click();
  await win.waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);

  const order = await win.evaluate((el) =>
    [...el.querySelectorAll(".qz-lg-mthen, .qz-lg-mband, .qz-lg-mq")].map((x) => x.className.split(" ")[0]),
  );
  ok("A1 no title bar; order What happens → band → When they answer",
    (await win.locator("h2, header").count()) === 0 && order.join(",") === "qz-lg-mthen,qz-lg-mband,qz-lg-mq", order.join(","));
  ok("A2 the × and nothing else sit right of the verb row (create mode)",
    (await win.locator(".qz-lg-mthen .qz-lg-mx").count()) === 1 && (await win.locator(".qz-lg-mdel").count()) === 0);
  ok("A3 one scrolling body; only the footer is pinned", await win.evaluate((el) => {
    const s = el.querySelector(".qz-lg-mscroll");
    const f = el.querySelector(".qz-lg-mfoot");
    return getComputedStyle(s).overflowY === "auto" && s.contains(el.querySelector(".qz-lg-mthen")) && !s.contains(f);
  }));
  const wb = await box(win);
  const strip = win.locator(".qz-lg-mrow").nth(1).locator(".qz-lg-mans");
  const sb = await box(strip);
  ok("A4 the box hugs its widest row: ≥ 680px, strips capped at 676", wb.w >= 679 && sb.w <= 676.5, `box ${wb.w} strip ${sb.w}`);
  ok("A5 a 10-answer row scrolls sideways with a right fade",
    (await strip.evaluate((el) => el.scrollWidth > el.clientWidth)) &&
    (await win.locator(".qz-lg-mrow").nth(1).locator(".qz-lg-manswrap.is-more").count()) === 1);
  const cols = await win.locator(".qz-lg-mrow").first().evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  ok("A6 row grid 22 | 184 | 44 | answers", /^22px 184px 44px /.test(cols), cols);
  const bk = await box(win.locator(".qz-lg-bk").first());
  ok("A7 buckets 104 × 68; scale points 58 wide", Math.abs(bk.w - 104) < 1 && Math.abs(bk.h - 68) < 1 &&
    Math.abs((await box(win.locator(".qz-lg-bk.is-pt").first())).w - 58) < 1, `${bk.w}×${bk.h}`);
  const fh = (await box(win.locator(".qz-lg-mfoot"))).h;
  ok("A8 footer about 65px", fh > 60 && fh < 70, `${fh}`);
  ok("A9 no 'N selected' count and no '+ Add something else'",
    !/selected|Add something else/.test(await win.innerText()));
  // 30 recommendations: two rows at most, "See N more".
  const band = win.locator(".qz-lg-mrecs");
  const rowTops = async () =>
    band.evaluate((el) => new Set([...el.children].filter((c) => !c.hidden && c.offsetWidth > 0).map((c) => c.offsetTop)).size);
  ok("A10 30 recommendations fit two rows with See N more", (await rowTops()) <= 2 &&
    /^See \d+ more$/.test((await band.locator(".qz-lg-rc.is-more").textContent()) ?? ""));
  await shot("A-30-recs");
  // Pick the last three through the popover → "See N more · K picked".
  await band.locator(".qz-lg-rc.is-more").click();
  const pop = page.locator(".qz-popover.qz-lg-pop");
  await pop.waitFor();
  ok("A11 See more popover: search focused, 30 rows", (await page.evaluate(() => document.activeElement?.getAttribute("type") === "search")) &&
    (await pop.locator(".qz-lg-mi").count()) === 30 && /All recommendations · 30/.test(await pop.innerText()));
  const rowsIn = pop.locator(".qz-lg-mi");
  for (const i of [27, 28, 29]) await rowsIn.nth(i).click();
  ok("A12 foot reads 3 picked", /3\s*picked/.test(await pop.locator(".qz-lg-vpfoot").innerText()));
  await shot("A-see-more-popover");
  await pop.locator(".qz-lg-btn", { hasText: "Done" }).click();
  await page.waitForTimeout(250);
  ok("A13 picks keep priority in the two rows", (await rowTops()) <= 2 &&
    (await band.locator(".qz-lg-rc.is-on:not([hidden])").count()) === 3,
    (await band.locator(".qz-lg-rc.is-more").textContent()) ?? "");
  // Pick answers and save & add another.
  await win.locator(".qz-lg-mrow").first().locator(".qz-lg-bk").first().click();
  await strip.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await win.locator(".qz-lg-mscroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await win.locator(".qz-lg-mfoot .qz-lg-btn", { hasText: "Create & add another" }).click();
  await page.waitForTimeout(500);
  ok("A14 & add another: blank draft at the top, strips back at the start",
    (await win.locator(".qz-lg-mscroll").evaluate((el) => el.scrollTop)) === 0 &&
    (await win.locator(".qz-lg-mrow").nth(1).locator(".qz-lg-mans").evaluate((el) => el.scrollLeft)) === 0 &&
    (await win.locator(".qz-lg-rc.is-on").count()) === 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // Edit mode: Duplicate + Delete rule + Save & add another.
  await page.locator('[data-testid="logic-tab-card"] li[data-rule-id] .qz-lg-rbody').last().click();
  await win.waitFor();
  ok("A15 edit mode: Duplicate, Delete rule, Save & add another, Save rule",
    (await win.locator(".qz-lg-mdel").allTextContents()).join(",") === "Duplicate,Delete rule" &&
    (await win.locator(".qz-lg-mfoot .qz-lg-btn").allTextContents()).slice(1).join(",") === "Save & add another,Save rule");
  await shot("A-edit");
  await win.locator(".qz-lg-mfoot .qz-lg-btn", { hasText: "Save & add another" }).click();
  await page.waitForTimeout(400);
  ok("A16 after Save & add another the window is a create draft",
    (await win.getAttribute("aria-label")) === "Create a rule" && (await win.locator(".qz-lg-mdel").count()) === 0);
  await page.keyboard.press("Escape");

  // ══════════════════════════════════════════════════════════════════════
  // B · the builder band (flow "builder") + batching
  // ══════════════════════════════════════════════════════════════════════
  await goto(`${BASE}/studio/${builder.id}`);
  await page.waitForSelector(".qz-builder", { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="logic-tab-card"] .qz-lg-rcol-h .qz-lg-btn').click();
  await win.waitFor();
  const bband = win.locator(".qz-lm-showband");
  ok("B1 builder keeps What the quiz shows in the band slot, no title bar",
    /What the quiz shows/.test(await bband.innerText()) && (await win.locator("h2").count()) === 0 &&
    (await win.locator(".qz-lg-mfoot .qz-lg-msay").count()) === 1);
  await bband.locator(".qz-lm-tsearch").fill("a");
  await page.waitForTimeout(200);
  const freeTags = () =>
    bband.locator(".qz-lm-tcard:not(.is-on)").filter({ has: page.locator(".qz-lm-kd", { hasText: /^Tag$/ }) });
  let n = 0;
  while (n < 13 && (await freeTags().count()) > 0) {
    await freeTags().first().locator(".qz-lm-tsel").click();
    n++;
  }
  await win.locator(".qz-lg-mrow").first().locator(".qz-lg-bk").first().click();
  const calls = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/categories/ensure-targets")) calls.push(JSON.parse(r.postData() ?? "{}").resources.length);
  });
  await shot("B-builder");
  await win.locator(".qz-lg-mfoot .qz-lg-btn.is-pri").click();
  await page.waitForTimeout(2500);
  ok(`B2 ${n} raw picks go out in batches of at most 12`, calls.length === Math.ceil(n / 12) && calls.every((c) => c <= 12),
    calls.join("+"));
  ok("B3 the rule saves and the window closes", (await win.count()) === 0);

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  failures++;
  console.error("✗ probe crashed:", mask(e?.stack ?? e));
} finally {
  await browser?.close();
  for (const c of copies) await c.drop();
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
