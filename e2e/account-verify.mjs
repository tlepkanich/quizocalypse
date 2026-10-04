// Account & Billing (docs/design/settings/billing/BILLING-HANDOFF.md) — the
// two pages live against a LOCAL production build + local DB: the rail link,
// the plan and credit figures in each state (trial, normal, nearly out,
// over, booked downgrade, cancelled), bill emails, and the Change plan
// dialogs, which must change nothing while Shopify billing is not connected.
//
// Seed/restore: the shop's ShopBilling row is saved and put back (or deleted
// if there was none). Every seeded Event, CreditUse and CreditGrant row is
// removed at the end. Usage rows carry the "acct-probe" session marker.
//
//   BASE=http://localhost:3000 node --env-file=.env e2e/account-verify.mjs
import { chromium } from "playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/account-verify-shots";
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

const MARK = "acct-probe";
const DAY = 24 * 60 * 60 * 1000;
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

const shopDomain = process.env.STUDIO_MODE === "standalone" ? "studio.local" : process.env.DEV_SHOP_DOMAIN;
const shop = await prisma.shop.findUnique({ where: { shopDomain } });
if (!shop) {
  console.error(`No shop for ${shopDomain}`);
  process.exit(1);
}
const quizzes = await prisma.quiz.findMany({ where: { shopId: shop.id }, take: 2, select: { id: true, name: true } });
if (quizzes.length === 0) {
  console.error("The shop needs at least one quiz to seed usage against.");
  process.exit(1);
}
const savedBilling = await prisma.shopBilling.findUnique({ where: { shopId: shop.id } });
const grantIds = [];

/** A cycle that started 12 days ago: 18 days left, like the mock. */
const cycleStart = new Date(today.getTime() - 12 * DAY);
const cycleEnd = new Date(cycleStart.getTime() + 30 * DAY);
const inCycle = new Date(cycleStart.getTime() + DAY);

// The shop's own engagements in the probe cycle. Seeded counts are topped up
// to the target, so the figures below are exact on any local DB.
const shopQuizIds = (await prisma.quiz.findMany({ where: { shopId: shop.id }, select: { id: true } })).map((q) => q.id);
const baseEngagements = (
  await prisma.event.findMany({
    where: {
      quizId: { in: shopQuizIds },
      eventType: "quiz_engaged",
      ts: { gte: cycleStart, lt: cycleEnd },
      NOT: { sessionId: { startsWith: MARK } },
    },
    select: { quizId: true, sessionId: true },
    distinct: ["quizId", "sessionId"],
  })
).length;

async function clearUsage() {
  await prisma.event.deleteMany({ where: { sessionId: { startsWith: MARK } } });
  await prisma.creditUse.deleteMany({ where: { sessionId: { startsWith: MARK } } });
  await prisma.creditGrant.deleteMany({ where: { id: { in: grantIds } } });
  grantIds.length = 0;
}

/** Put the shop in a state. Usage is split over the shop's first two quizzes. */
async function seed({ billing, engagements: target = 0, recCopy = 0, askAi = 0, grants = [] }) {
  const engagements = Math.max(0, target - baseEngagements);
  await clearUsage();
  await prisma.shopBilling.upsert({
    where: { shopId: shop.id },
    update: { pendingPlan: null, cancelAt: null, everyCycleCredits: 0, ...billing },
    create: { shopId: shop.id, plan: "starter", status: "trial", cycleStart, cycleEnd, ...billing },
  });
  const quizFor = (i) => quizzes[i % quizzes.length].id;
  // Events before the cycle must not count; one is seeded to prove it.
  await prisma.event.createMany({
    data: [
      ...Array.from({ length: engagements }, (_, i) => ({
        quizId: quizFor(i),
        shopId: shop.id,
        sessionId: `${MARK}-${i}`,
        eventType: "quiz_engaged",
        payload: {},
        ts: inCycle,
      })),
      // The same session engaging twice is one engagement.
      ...(engagements > 0
        ? [{ quizId: quizFor(0), shopId: shop.id, sessionId: `${MARK}-0`, eventType: "quiz_engaged", payload: {}, ts: inCycle }]
        : []),
      {
        quizId: quizFor(0),
        shopId: shop.id,
        sessionId: `${MARK}-before`,
        eventType: "quiz_engaged",
        payload: {},
        ts: new Date(cycleStart.getTime() - DAY),
      },
    ],
  });
  await prisma.creditUse.createMany({
    data: [
      ...Array.from({ length: recCopy }, (_, i) => ({
        shopId: shop.id,
        quizId: quizFor(i),
        feature: "rec_copy",
        sessionId: `${MARK}-${i}`,
        milliCredits: 200,
        ts: inCycle,
      })),
      // Ask AI on the first quiz only, so the second shows a dash.
      ...Array.from({ length: askAi }, (_, i) => ({
        shopId: shop.id,
        quizId: quizFor(0),
        feature: "ask_ai",
        sessionId: `${MARK}-${i}`,
        milliCredits: 100,
        ts: inCycle,
      })),
    ],
  });
  for (const grant of grants) {
    const row = await prisma.creditGrant.create({ data: { shopId: shop.id, cycleStart, ...grant } });
    grantIds.push(row.id);
  }
}

const active = (plan, extra = {}) => ({ plan, status: "active", cycleStart, cycleEnd, ...extra });
const text = (page, selector) => page.locator(selector).first().innerText();
const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ""));

let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  page.on("console", (m) => {
    // A refused bill email is a 422 by design; the browser logs every 4xx.
    if (m.type() === "error" && !/status of 422/.test(m.text())) pageErrors.push(mask(m.text().split("\n")[0]));
  });
  const open = async (path) => {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  };
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

  await page.goto(`${BASE}/studio?key=${encodeURIComponent(KEY)}`, { waitUntil: "networkidle" });

  /* ── 1 · First open: a free trial on Starter ── */
  await clearUsage();
  await prisma.shopBilling.deleteMany({ where: { shopId: shop.id } });
  await open("/studio");
  const railLink = page.locator('.qz-rail-foot a[href="/studio/account"]');
  ok("rail footer item reads Account and links to /studio/account", (await railLink.innerText()).trim() === "Account");
  await railLink.click();
  await page.waitForURL("**/studio/account");
  await page.waitForSelector(".acct-head h1");
  ok("rail item is active on Account", (await railLink.getAttribute("aria-current")) === "page");
  const trialRow = await prisma.shopBilling.findUnique({ where: { shopId: shop.id } });
  ok("first open saves a trial on Starter", trialRow?.plan === "starter" && trialRow?.status === "trial");
  ok(
    "the trial is 14 days",
    trialRow && Math.round((trialRow.cycleEnd.getTime() - trialRow.cycleStart.getTime()) / DAY) === 14,
  );
  ok("plan chip: Free trial · 14 days left", /Free trial · 14 days left/i.test(await text(page, ".acct-tag.is-trial")));
  ok("bill box: First bill $50.00", /First bill/i.test(await text(page, ".acct-bill")) && /\$50\.00/.test(await text(page, ".acct-bill")));
  ok("figure: left of 400 in your trial", /left of 400 in your trial/.test(await text(page, ".acct-fig")));
  ok("past bills: empty state", /No bills yet\. Your first bill is on /.test(await text(page, ".acct-empty")));
  ok("no teal signal on a fresh trial", (await page.locator(".acct-signal").count()) === 0);
  await shot("01-trial");

  /* ── 2 · Normal: Growth, usage adds up ── */
  await seed({
    billing: active("growth", { everyCycleCredits: 0 }),
    engagements: 1180,
    recCopy: 644,
    askAi: 276,
    grants: [{ source: "rollover", credits: 180 }],
  });
  await open("/studio/account");
  // 644 × 0.2 = 128.8 → 129; 276 × 0.1 = 27.6 → 28; used = 1,180 + 157.
  ok("plan chip: Active", /Active/i.test(await text(page, ".acct-tag.is-live")));
  ok("figure: 1,043 left of 2,380 this cycle", /1,043/.test(await text(page, ".acct-fig")) && /left of 2,380 this cycle/.test(await text(page, ".acct-fig")));
  ok("cycle line: 18 days left", /18 days left/.test(await text(page, ".acct-aside")));
  const usedRows = await page.locator(".acct-lg").nth(0).locator("dd").allInnerTexts();
  ok("Used = engagements + AI credits", usedRows.map(num).join(",") === "1180,157,129,28,1337", usedRows.join(" | "));
  const cycleRows = await page.locator(".acct-lg").nth(1).innerText();
  ok("Current cycle: included 2,200 + rolled over 180 = 2,380", /2,200/.test(cycleRows) && /Rolled over from last cycle/.test(cycleRows) && /2,380/.test(cycleRows));
  const table = await page.locator(".acct-byq tbody tr").evaluateAll((rows) =>
    rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim())),
  );
  const sumRow = table[table.length - 1];
  const quizRows = table.slice(0, -1);
  const colSum = (i) => quizRows.reduce((sum, row) => sum + (row[i] === "—" ? 0 : num(row[i])), 0);
  ok("By quiz: columns add up to All quizzes", [1, 2, 3, 4].every((i) => colSum(i) === num(sumRow[i])), JSON.stringify(table));
  ok("By quiz: rows add up to their Credits", quizRows.every((row) => [1, 2, 3].reduce((s, i) => s + (row[i] === "—" ? 0 : num(row[i])), 0) === num(row[4])));
  ok("By quiz: All quizzes equals Used so far", num(sumRow[4]) === 1337);
  if (quizzes.length > 1) ok("By quiz: a dash where a quiz had no Ask AI use", quizRows.some((row) => row[3] === "—"));
  ok("no signal at 56%", (await page.locator(".acct-signal").count()) === 0);
  await shot("02-normal");

  /* ── 3 · Nearly out ── */
  await seed({ billing: active("growth"), engagements: 1848 });
  await open("/studio/account");
  ok("near signal: 84% used, $0.10 a credit", /84% of this cycle’s credits are used\./.test(await text(page, ".acct-signal")) && /\$0\.10/.test(await text(page, ".acct-signal")));
  await shot("03-near");

  /* ── 4 · Over, on Starter, where Growth would have been cheaper ── */
  await seed({ billing: active("starter"), engagements: 1401 });
  await open("/studio/account");
  const overSignal = await text(page, ".acct-signal");
  ok("over figure in teal: 1,001 over your 400", /1,001/.test(await text(page, ".acct-fig.is-over")) && /over your 400 credits this cycle/.test(await text(page, ".acct-fig.is-over")));
  ok("over signal: adds $150.15 so far", /You’re 1,001 credits over, which adds \$150\.15 to your .* bill so far\./.test(overSignal), overSignal);
  ok("over signal: Growth would have cost $200.00", /Growth would have cost \$200\.00 this cycle\./.test(overSignal));
  ok("bill box: $200.15 so far, extra credits line", /\$200\.15\s*so far/.test(await text(page, ".acct-bill")) && /1,001 extra credits/.test(await text(page, ".acct-bill")));
  ok("meter: All 400 used / +1,001 extra", /All 400 used/.test(await text(page, ".acct-meter-ax")) && /\+1,001 extra/.test(await text(page, ".acct-meter-ax")));
  await shot("04-over");

  /* ── 5 · Booked downgrade, added credits, one-time credits ── */
  await seed({
    billing: active("growth", { pendingPlan: "starter", everyCycleCredits: 500 }),
    engagements: 40,
    grants: [{ source: "one_time", credits: 300 }],
  });
  await open("/studio/account");
  ok("grey chip: Starter from <next bill date>", /Starter from /i.test(await text(page, ".acct-tag.is-quiet")));
  ok("plan line: $250 a month · 2,700 credits each cycle", /\$250 a month · 2,700 credits each cycle/.test(await text(page, ".acct-plan-me")));
  const cycle5 = await page.locator(".acct-lg").nth(1).innerText();
  ok("Current cycle: added every cycle 500, bought one time 300, total 3,000", /Added every cycle/.test(cycle5) && /Bought one time/.test(cycle5) && /3,000/.test(cycle5));
  await shot("05-pending-addon");

  /* ── 6 · Cancelled ── */
  await seed({ billing: active("growth", { cancelAt: cycleEnd }), engagements: 40 });
  await open("/studio/account");
  ok("grey chip: Ends <last day>, bill box: Last bill", /Ends /i.test(await text(page, ".acct-tag.is-quiet")) && /Last bill/i.test(await text(page, ".acct-bill")));

  /* ── 7 · Bill emails ── */
  await prisma.shopBilling.update({ where: { shopId: shop.id }, data: { cancelAt: null, billEmails: [], emailAlertNear: true } });
  await open("/studio/account");
  ok("no emails: the not-being-sent line", /No email saved\. Receipts and alerts aren’t being sent\./.test(await text(page, ".acct-mail-none")));
  const field = page.locator("#acct-bill-email");
  const save = page.locator(".acct-mail-to button[type=submit]");
  await field.fill("not-an-email");
  await save.click();
  await page.waitForSelector(".acct-mail-err");
  ok("bad address refused", (await text(page, ".acct-mail-err")) === "Enter a full email address, like name@yourstore.com.");
  await field.fill("Accounts@Probe-Store.com");
  await save.click();
  await page.waitForSelector(".acct-mail-list li");
  ok("save adds the address, lower-cased", (await text(page, ".acct-mail-list li span")) === "accounts@probe-store.com");
  ok("save clears the field", (await field.inputValue()) === "");
  await field.fill("accounts@probe-store.com");
  await save.click();
  await page.waitForSelector(".acct-mail-err");
  ok("duplicate refused", (await text(page, ".acct-mail-err")) === "accounts@probe-store.com is already on the list.");
  const nearSwitch = page.locator(".acct-sw").nth(1);
  await nearSwitch.click();
  await page.waitForTimeout(600);
  await shot("06-emails");
  await open("/studio/account");
  ok("a switch persists across a reload", (await page.locator(".acct-sw").nth(1).isChecked()) === false);
  ok("a saved address persists across a reload", (await page.locator(".acct-mail-list li").count()) === 1);
  await page.locator(".acct-mail-list li button").click();
  await page.waitForSelector(".acct-mail-none");
  ok("remove takes the address off the list", (await page.locator(".acct-mail-list li").count()) === 0);

  /* ── 8 · Change plan ── */
  await seed({ billing: active("starter"), engagements: 120 });
  await open("/studio/account");
  await page.locator(".acct-plan-acts a").click();
  await page.waitForURL("**/studio/account/plan");
  await page.waitForSelector(".acct-plans");
  ok("rail item stays active on Change plan", (await railLink.getAttribute("aria-current")) === "page");
  ok("header: You’re on Starter · 280 credits left", /You’re on Starter · 280 credits left/.test(await text(page, ".acct-head-now")));
  const tiles = await page.locator(".acct-pl").evaluateAll((els) =>
    els.map((el) => (el.querySelector(".acct-pl-now, button")?.textContent ?? "").trim()),
  );
  ok("tiles: Your plan / Upgrade / Talk to us", tiles.join("|") === "Your plan|Upgrade|Talk to us", tiles.join("|"));
  ok("no dialog opens on its own", (await page.locator(".qz-modal").count()) === 0);

  const amount = page.locator("#acct-amount");
  const slider = page.locator(".acct-slide input");
  ok("amount opens on the plan's usual 250", (await amount.inputValue()) === "250" && (await slider.inputValue()) === "250");
  ok("mark: 1,000 · same price as Growth", /1,000 · same price as Growth/.test(await text(page, ".acct-slide-ax")));
  await amount.fill("733");
  ok("field takes any whole number; button follows", /Buy 733 credits · \$109\.95/.test(await text(page, ".acct-mc-buy button")));
  await amount.fill("99999");
  await amount.blur();
  ok("field is clamped on blur; slider follows", (await amount.inputValue()) === "2000" && (await slider.inputValue()) === "2000");
  ok("nudge: Starter with these credits comes to $350.00", /Starter with these credits comes to \$350\.00\./.test(await text(page, ".acct-nudge")));
  await slider.fill("500");
  ok("slider moves the field", (await amount.inputValue()) === "500");
  await shot("07-change-plan");

  const before = await prisma.shopBilling.findUnique({ where: { shopId: shop.id } });
  const confirmAndCheck = async (name, openDialog, title, yesLabel) => {
    await openDialog();
    await page.waitForSelector(".qz-modal.acct-dlg");
    const dialogText = await text(page, ".qz-modal.acct-dlg");
    ok(`${name}: dialog title`, dialogText.includes(title), dialogText.replace(/\n+/g, " / "));
    const yes = page.locator(".qz-modal.acct-dlg .qz-modal-footer button").nth(1);
    ok(`${name}: action reads "${yesLabel}"`, (await yes.innerText()).trim() === yesLabel);
    // A click must land: a pointer-trapped overlay renders fine and is unclickable.
    await yes.click();
    await page.waitForSelector(".qz-modal.acct-dlg", { state: "detached" });
    await page.waitForSelector(".qz-toast");
  };
  await confirmAndCheck("upgrade", () => page.locator(".acct-pl button", { hasText: "Upgrade" }).click(), "Upgrade to Growth?", "Continue in Shopify");
  await shot("08-after-upgrade-confirm");
  await page.locator(".acct-pl button", { hasText: "Upgrade" }).click();
  await page.waitForSelector(".qz-modal.acct-dlg");
  await shot("09-upgrade-dialog");
  await page.locator(".qz-modal.acct-dlg .qz-modal-footer button").nth(0).click();
  await page.waitForSelector(".qz-modal.acct-dlg", { state: "detached" });
  ok("the quiet button closes the dialog", true);
  await confirmAndCheck("buy once", () => page.locator(".acct-mc-buy button").click(), "Buy 500 credits?", "Continue in Shopify");
  await page.locator(".acct-seg button", { hasText: "Every cycle" }).click();
  ok("every cycle: summary and button", /Your plan becomes \$125\.00 a month with 900 credits each cycle\./.test(await text(page, ".acct-mc-buy")) && /Add 500 every cycle · \$75\.00 a month/.test(await text(page, ".acct-mc-buy button")));
  await confirmAndCheck("every cycle", () => page.locator(".acct-mc-buy button").click(), "Add 500 credits every cycle?", "Continue in Shopify");
  await confirmAndCheck("cancel", () => page.locator(".acct-cancel button").click(), "Cancel Starter?", "Cancel plan");
  await page.locator(".acct-cancel button").click();
  await page.waitForSelector(".qz-modal.acct-dlg");
  await shot("10-cancel-dialog");
  await page.keyboard.press("Escape");
  ok("Escape does not close a destructive confirm", (await page.locator(".qz-modal.acct-dlg").count()) === 1);
  await page.locator(".qz-modal.acct-dlg .qz-modal-footer button").nth(0).click();
  const after = await prisma.shopBilling.findUnique({ where: { shopId: shop.id } });
  ok(
    "no dialog changed the plan state",
    JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...after, updatedAt: 0 }),
  );

  // Growth: the mark names Enterprise, and a downgrade is offered.
  await seed({ billing: active("growth", { everyCycleCredits: 500 }), engagements: 120 });
  await open("/studio/account/plan");
  ok("Growth: Downgrade / Your plan / Talk to us", (await page.locator(".acct-pl").evaluateAll((els) => els.map((el) => (el.querySelector(".acct-pl-now, button")?.textContent ?? "").trim()))).join("|") === "Downgrade|Your plan|Talk to us");
  ok("Growth: existing every-cycle credits row with Remove", /You add 500 credits every cycle · \$50\.00 a month/.test(await text(page, ".acct-mc-have")));
  await confirmAndCheck("downgrade", () => page.locator(".acct-pl button", { hasText: "Downgrade" }).click(), "Downgrade to Starter?", "Continue in Shopify");
  await confirmAndCheck("remove added credits", () => page.locator(".acct-mc-have button").click(), "Remove the 500 added credits?", "Remove");
  await shot("11-change-plan-growth");

  /* ── 9 · A cycle that has ended rolls forward ── */
  await seed({ billing: { plan: "starter", status: "trial", cycleStart: new Date(today.getTime() - 20 * DAY), cycleEnd: new Date(today.getTime() - 6 * DAY) } });
  await open("/studio/account");
  const rolled = await prisma.shopBilling.findUnique({ where: { shopId: shop.id } });
  ok("an ended trial becomes the active plan", rolled?.status === "active" && rolled.cycleStart.getTime() === today.getTime() - 6 * DAY);
  ok("the new cycle is 30 days: 24 days left", /24 days left/.test(await text(page, ".acct-aside")));
  const rolloverGrants = (cycleStartOf) =>
    prisma.creditGrant.findMany({ where: { shopId: shop.id, source: "rollover", cycleStart: cycleStartOf } });
  ok("trial credits do not roll over", (await rolloverGrants(rolled.cycleStart)).length === 0);

  /* ── 9b · An active cycle that has ended: what is left rolls over once ── */
  const oldStart = new Date(today.getTime() - 36 * DAY);
  const oldEnd = new Date(today.getTime() - 6 * DAY);
  await seed({ billing: { plan: "starter", status: "active", cycleStart: oldStart, cycleEnd: oldEnd } });
  // 100 credits were rolled INTO the old cycle; they are spent first and expire.
  grantIds.push((await prisma.creditGrant.create({ data: { shopId: shop.id, source: "rollover", credits: 100, cycleStart: oldStart } })).id);
  await prisma.event.createMany({
    data: Array.from({ length: 150 }, (_, i) => ({
      quizId: quizzes[0].id,
      shopId: shop.id,
      sessionId: `${MARK}-old-${i}`,
      eventType: "quiz_engaged",
      payload: {},
      ts: new Date(oldStart.getTime() + DAY),
    })),
  });
  const usedOld = (
    await prisma.event.findMany({
      where: { quizId: { in: shopQuizIds }, eventType: "quiz_engaged", ts: { gte: oldStart, lt: oldEnd } },
      select: { quizId: true, sessionId: true },
      distinct: ["quizId", "sessionId"],
    })
  ).length;
  const expectedRollover = Math.max(0, 400 - Math.max(0, usedOld - 100));
  await open("/studio/account");
  let carried = await rolloverGrants(oldEnd);
  grantIds.push(...carried.map((grant) => grant.id));
  ok(
    `closing a cycle rolls over the fresh credits left (${usedOld} used, 100 rolled in → ${expectedRollover})`,
    expectedRollover > 0 && carried.length === 1 && carried[0].credits === expectedRollover,
    JSON.stringify(carried.map((grant) => grant.credits)),
  );
  const cycle9 = await page.locator(".acct-lg").nth(1).innerText();
  ok(
    "Current cycle shows the rolled-over credits and the new total",
    /Rolled over from last cycle/.test(cycle9) && cycle9.includes((400 + expectedRollover).toLocaleString("en-US")),
    cycle9.replace(/\n+/g, " / "),
  );
  await open("/studio/account");
  carried = await rolloverGrants(oldEnd);
  ok("a second load does not roll the credits over again", carried.length === 1);

  /* ── 10 · /studio/settings is unchanged ── */
  await open("/studio/settings");
  ok("/studio/settings still renders", (await page.locator("h1", { hasText: "Settings" }).count()) > 0);

  ok("no page errors", pageErrors.length === 0, pageErrors.slice(0, 4).join(" · "));
} finally {
  await clearUsage();
  if (savedBilling) {
    const { id, ...row } = savedBilling;
    const rest = { ...row, billEmails: row.billEmails ?? Prisma.DbNull };
    await prisma.shopBilling.upsert({ where: { shopId: shop.id }, update: rest, create: { id, ...rest } });
  } else {
    await prisma.shopBilling.deleteMany({ where: { shopId: shop.id } });
  }
  await browser?.close();
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
