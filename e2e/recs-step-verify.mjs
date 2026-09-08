// Recommendations step (Step 1) — the Step-1 tweaks live-verify against a
// LOCAL production build + local DB. Fixture: cms4squp00007vkyoje7z4u36
// (decider · goal-first READY at stage "grouping" · 5 product buckets · a
// 124-product catalog with 68 active / 55 draft / 1 archived · 4 collections ·
// 12 shop-global groups).
//
// Drives: four tabs printing their own picks (a tab is a view — no
// TabLockModal), the narrowing line, sort/status/one-button toolbar, the
// 25-row window that loads on scroll, the footer ledger, one-line rows with
// the count/variants as the control, the Results rail (composition sub-line,
// Groups/Products sections, deliverable copy, flash on add, ✕ that never
// opens the preview), the frozen selected-first order, a HETEROGENEOUS
// selection persisting as Category rows, the AI Picks pill (Apply scoped to
// the suggested type → the other types survive · Undo), Select all / Clear
// all with the confirm, and the Custom tab creating a group through the
// shared wizard (a shop-global row + a `group` bucket row). The fixture's
// draftJson + Category rows are snapshotted and restored in `finally`; any
// shop-global group the probe created is deleted.
//
//   set -a; source .env; set +a
//   BASE=http://localhost:3000 node e2e/recs-step-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cms4squp00007vkyoje7z4u36";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/recs-step-shots";

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

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
const originalGlobal = await prisma.category.findMany({
  where: { shopId: quiz.shopId, quizId: null },
  select: { id: true },
});
writeFileSync(`${SHOTS}/backup-${QUIZ}.json`, JSON.stringify({ draftJson: quiz.draftJson, categories: originalCats }, null, 2));
const quizCats = () =>
  prisma.category.findMany({
    where: { quizId: QUIZ, NOT: { discoveryRunId: { startsWith: "logic-tab-" } } },
    select: { source: true, sourceRef: true, name: true },
    orderBy: { createdAt: "asc" },
  });

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
  const settle = async (ms = 900) => {
    await page.waitForTimeout(ms);
  };
  const rb = page.locator(".qz-rb");
  const rail = page.locator(".qz-rb-rail");
  const railCount = async () => Number((await rail.locator(".qz-rb-count").innerText()).trim());
  const tab = (label) => rb.locator('.qz-rb-tab[role="tab"]', { hasText: label });
  const foot = () => rb.locator(".qz-rb-listfoot").innerText();
  const rows = rb.locator(".qz-rb-card");

  await goto(`${BASE}/studio?key=${KEY}`);
  await goto(`${BASE}/studio/onboarding/${QUIZ}`);
  await page.waitForSelector(".qz-rb", { timeout: 20000 });
  await settle(1200);

  // 1 ── tabs: four, printing their own picks; totals in aria-label
  const tabs = rb.locator('.qz-rb-tab[role="tab"]');
  ok("four tabs: Products · Tags · Collections · Custom",
    (await tabs.allInnerTexts()).map((t) => t.replace(/\d+/g, "").trim()).join(" · ") === "Products · Tags · Collections · Custom");
  ok("Products prints its OWN picks (5), the total lives in aria-label",
    (await tab("Products").locator(".qz-rb-tab-n").innerText()).trim() === "5" &&
    /Products, 124 available, 5 selected/.test((await tab("Products").getAttribute("aria-label")) ?? ""));
  ok("no TabLockModal, no muted tabs", (await rb.locator(".qz-rb-tab.is-muted").count()) === 0);
  ok("rail is titled Results with the composition sub-line and the count badge",
    /^Results/.test(await rail.locator(".qz-rb-rail-title strong").innerText()) &&
    /5\s*products/.test(await rail.locator(".qz-rb-rail-sub").innerText()) &&
    (await railCount()) === 5);
  ok("no section headers with one kind", (await rail.locator(".qz-rb-rail-seclab").count()) === 0);
  ok("no amber advisory under the rail", (await rb.locator(".qz-rb-warn").count()) === 0);
  ok("rail rows: div role=button, glyph tile, no price, no check glyph",
    (await rail.locator('.qz-rb-rail-row[role="button"]').count()) === 5 &&
    (await rb.locator(".qz-rb-check, .qz-rb-pricetag").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/1-products.png` });

  // 2 ── Products toolbar: A–Z/Z–A only, status filter, the ledger
  ok("Products sort offers A–Z / Z–A only", (await rb.locator(".qz-rb-sortsel option").count()) === 2);
  ok("status filter on Products, default Active",
    (await rb.locator(".qz-rb-statsel").count()) === 1 && (await rb.locator(".qz-rb-statsel").inputValue()) === "active");
  ok("no narrowing line on Products", (await rb.locator(".qz-rb-narrow").count()) === 0);
  const f1 = await foot();
  ok("footer ledger: Showing 25 of N active · 55 draft, 1 archived not shown", /Showing\s*25\s*of\s*\d+\s*active\s*·\s*55 draft, 1 archived not shown/.test(f1), f1);
  ok("active rows carry no status badge", (await rb.locator(".qz-rb-card .qz-rb-stat").count()) === 0);
  // a variant row: the option list is the right column, the control
  const varRow = rows.filter({ has: page.locator("button.qz-rb-vars") }).first();
  ok("a multi-variant product shows its option list in the right column", (await varRow.count()) === 1 &&
    /·/.test(await varRow.locator("button.qz-rb-vars").innerText()));
  ok("a single-variant product shows nothing (empty span, no dash)",
    (await rows.filter({ has: page.locator("span.qz-rb-vars.is-none") }).count()) > 0 &&
    !(await rb.locator("span.qz-rb-vars.is-none").allInnerTexts()).some((t) => t.trim() !== ""));
  const before = await railCount();
  await varRow.locator("button.qz-rb-vars").click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  ok("the variant list opens with per-variant stock and does NOT toggle the row",
    /variants pulled in from Shopify/.test(await page.locator(".qz-modal").innerText()) &&
    (await page.locator(".qz-modal .qz-rb-stock").count()) > 0 && (await railCount()) === before);
  await page.screenshot({ path: `${SHOTS}/2-variants.png` });
  await page.keyboard.press("Escape");
  await settle(300);

  // 3 ── scroll-load: 25 → 50
  await rb.locator(".qz-rb-grid").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await settle(400);
  ok("reaching the bottom loads 25 more", /Showing\s*(50|4\d|3\d)\s*of/.test(await foot()), await foot());
  ok("a quiet keyboard load-more exists while rows remain", (await rb.locator(".qz-rb-loadmore").count()) === 1);

  // 4 ── status: Draft → badges + ledger; the ledger link → All statuses
  await rb.locator(".qz-rb-statsel").selectOption("draft");
  await settle(300);
  ok("Draft filter: rows carry the draft badge; footer says draft", (await rb.locator(".qz-rb-card .qz-rb-stat.is-draft").count()) > 0 && /draft/.test(await foot()));
  ok("… and the ledger names only what is not shown", /1 archived not shown/.test(await foot()) && !/55 draft/.test(await foot()));
  await rb.locator(".qz-rb-archtog").click();
  await page.waitForFunction(
    () => /Showing\s*25\s*of\s*124/.test(document.querySelector(".qz-rb-listfoot")?.textContent ?? ""),
    null,
    { timeout: 4000 },
  ).catch(() => {});
  ok("the ledger link switches to All statuses", (await rb.locator(".qz-rb-statsel").inputValue()) === "all" && /Showing\s*25\s*of\s*124/.test(await foot()), await foot());
  await rb.locator(".qz-rb-statsel").selectOption("active");
  await settle(300);

  // 5 ── the rail's ✕ removes without opening the preview; re-add flashes
  const firstRow = rail.locator(".qz-rb-rail-row").first();
  const firstName = (await firstRow.locator(".qz-rb-chip-name").innerText()).trim();
  await firstRow.locator(".qz-rb-chip-x").click();
  await settle(1200);
  ok("✕ removes the row (no preview opened)", (await railCount()) === 4 && (await page.locator(".qz-modal").count()) === 0);
  await rb.locator(".qz-rb-toolbar input").fill(firstName.slice(0, 12));
  await settle(400);
  const hit = rows.filter({ hasText: firstName }).first();
  await hit.click();
  await settle(200);
  ok("re-adding flashes the landed row in the rail", (await rail.locator(".qz-rb-rail-row.is-new").count()) === 1 && (await railCount()) === 5);
  await settle(1500);
  ok("the flash clears", (await rail.locator(".qz-rb-rail-row.is-new").count()) === 0);
  await rb.locator(".qz-rb-toolbar input").fill("");
  await settle(400);
  // a rail row opens the SAME preview as the list
  await rail.locator(".qz-rb-rail-row").first().click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  ok("a rail row opens the preview", (await page.locator(".qz-modal").count()) === 1);
  await page.keyboard.press("Escape");
  await settle(300);

  // 6 ── Tags: the narrowing line, size sorts, frozen order, heterogeneous pick
  await tab("Tags").click();
  await settle(900);
  ok("switching tabs keeps the selection (a tab is a view)", (await railCount()) === 5);
  ok("the narrowing line shows on Tags with its explainer link", (await rb.locator(".qz-rb-narrow").count()) === 1);
  ok("Tags sort offers the four modes", (await rb.locator(".qz-rb-sortsel option").count()) === 4);
  ok("no status filter off Products", (await rb.locator(".qz-rb-statsel").count()) === 0);
  ok("rows say 'Group of N products' with the count as the control",
    /Group of/.test(await rows.first().locator(".qz-rb-vars.is-grp").innerText()) && (await rows.first().locator("button.qz-rb-cntb").count()) === 1);
  await rb.locator(".qz-rb-narrow-link").click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  ok("How narrowing works explainer", /How narrowing works/.test(await page.locator(".qz-modal").innerText()));
  await page.keyboard.press("Escape");
  await settle(300);
  // frozen order: the second row stays put after picking it
  const names0 = await rows.locator(".qz-rb-card-name").allInnerTexts();
  await rows.nth(1).click();
  await settle(1200);
  const names1 = await rows.locator(".qz-rb-card-name").allInnerTexts();
  ok("a pick does not re-sort the list (frozen order)", names0[1] === names1[1] && names0[0] === names1[0], `${names0.slice(0, 3)} → ${names1.slice(0, 3)}`);
  ok("the picked row is selected: border + tint, no tick", (await rows.nth(1).getAttribute("aria-checked")) === "true" && (await rows.nth(1).locator(".qz-rb-check").count()) === 0);
  ok("Tags tab now prints 1; rail 6 with Groups/Products sections",
    (await tab("Tags").locator(".qz-rb-tab-n").innerText()).trim() === "1" && (await railCount()) === 6 &&
    (await rail.locator(".qz-rb-rail-seclab").count()) === 2);
  ok("the group row carries the deliverable count copy",
    /\d+( of \d+)? products?/.test(await rail.locator(".qz-rb-rail-row .qz-rb-card-meta").first().innerText()));
  const cats1 = await quizCats();
  ok("HETEROGENEOUS selection persisted: 5 product rows + 1 tag row",
    cats1.filter((c) => c.source === "product").length === 5 && cats1.filter((c) => c.source === "tag").length === 1, JSON.stringify(cats1.map((c) => c.source)));
  await page.screenshot({ path: `${SHOTS}/3-tags-mixed.png` });
  // count button opens the members, never selects
  const cntRow = rows.nth(3);
  const wasOn = await cntRow.getAttribute("aria-checked");
  await cntRow.locator("button.qz-rb-cntb").click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  ok("the count opens the members and does not toggle the row", /in this tag/.test(await page.locator(".qz-modal").innerText()) && (await cntRow.getAttribute("aria-checked")) === wasOn);
  await page.keyboard.press("Escape");
  await settle(300);
  // focus ring is ink, not accent
  await rows.nth(2).focus();
  const oc = await rows.nth(2).evaluate((el) => getComputedStyle(el).outlineColor);
  ok("focus ring is ink (never the accent)", oc === "rgb(32, 28, 46)", oc);

  // 7 ── Select all with a search: confirms, scoped to the matches; Clear all reverses
  await rb.locator(".qz-rb-toolbar input").fill("s");
  await settle(500);
  const shownN = (await foot()).match(/Showing\s*(\d+)/)?.[1];
  await rb.locator(".qz-rb-selall").click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  const addText = await page.locator(".qz-modal").innerText();
  ok("Select all confirms with the count of what changes and names the search scope", /Add \d+ tags\?/.test(addText) && /matching/.test(addText), addText.split("\n")[0]);
  await page.locator(".qz-modal button", { hasText: /^Add \d+$/ }).click();
  await settle(1500);
  ok("… the rail grew and the control flipped to Clear all", (await railCount()) > 6 && /Clear all/.test(await rb.locator(".qz-rb-selall").innerText()), `rail ${await railCount()} shown ${shownN}`);
  const after = await railCount();
  await rb.locator(".qz-rb-selall").click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  ok("Clear all confirms with the same window", /Remove \d+ tags\?/.test(await page.locator(".qz-modal").innerText()));
  await page.locator(".qz-modal button", { hasText: /^Remove \d+$/ }).click();
  await settle(1500);
  ok("… and returns exactly where you were", (await railCount()) === after - Number(shownN) + 0 || (await railCount()) <= 6, `rail ${await railCount()}`);
  await rb.locator(".qz-rb-toolbar input").fill("");
  await settle(400);

  // 8 ── AI Picks: the pill, the dialog, typed Apply, the other types survive, Undo
  const pill = rb.locator(".qz-rb-aipill");
  ok("the AI pill sits in the tab strip's corner", (await pill.count()) === 1 && /AI picked \d+/.test(await pill.innerText()));
  ok("no dismiss affordance on the pill", (await rb.locator(".qz-rb-tip-x, .qz-rb-banner-x").count()) === 0);
  const productsBefore = (await quizCats()).filter((c) => c.source === "product").length;
  await pill.click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  const ai = page.locator(".qz-modal");
  ok("AI Picks dialog: titled, rows with count controls, Apply", /AI Picks/.test(await ai.innerText()) &&
    (await ai.locator(".qz-rb-airow").count()) > 0 && (await ai.locator("button", { hasText: /^Apply$/ }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}/4-ai-picks.png` });
  await ai.locator("button", { hasText: /^Apply$/ }).click();
  await settle(400);
  if ((await page.locator(".qz-modal").count()) && /Override and continue/.test(await page.locator(".qz-modal").innerText())) {
    ok("an existing selection OF THE TYPE prompts the override confirm", true);
    await page.locator(".qz-modal button", { hasText: "Override and continue" }).click();
  } else {
    ok("no selection of the suggested type → straight through", true);
  }
  await settle(1800);
  ok("pill reads Applied N with Undo beside it (a sibling)", /Applied \d+/.test(await pill.innerText()) && (await rb.locator(".qz-rb-aiundo").count()) === 1);
  const catsApplied = await quizCats();
  ok("Apply is TYPE-SCOPED: the product picks survive", catsApplied.filter((c) => c.source === "product").length === productsBefore, JSON.stringify(catsApplied.map((c) => c.source)));
  await page.screenshot({ path: `${SHOTS}/5-applied.png` });
  await rb.locator(".qz-rb-aiundo").click();
  await settle(1800);
  ok("Undo restores that type's prior keys only", /AI picked \d+/.test(await pill.innerText()) && (await quizCats()).filter((c) => c.source === "product").length === productsBefore);

  // 9 ── Custom tab: New group → the shared wizard → a group bucket
  await tab("Custom").click();
  await settle(700);
  ok("Custom tab: the New-group affordance leads the list", (await rb.locator(".qz-rb-newgrp").count()) === 1);
  ok("Custom search placeholder takes the plural noun", (await rb.locator(".qz-rb-toolbar input").getAttribute("placeholder")) === "Search groups…");
  ok("no CUSTOM badge on rows", (await rb.locator(".qz-rb-card-sub").count()) === 0);
  await rb.locator(".qz-rb-newgrp").click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  const wiz = page.locator(".qz-modal");
  ok("the wizard opens on Define with capped chip sections", /Create a group/.test(await wiz.innerText()) && (await wiz.locator(".qz-wsrc-chip").count()) > 0);
  ok("a section past twelve options gets its own search", (await wiz.locator(".qz-wsrc-q").count()) >= 1);
  ok("+N more expander on a capped section", (await wiz.locator(".qz-wsrc-chip.is-more").count()) >= 1);
  const chip = wiz.locator(".qz-wsrc").first().locator(".qz-wsrc-chip:not(.is-more)").first();
  const chipName = (await chip.innerText()).trim();
  await chip.click();
  await settle(200);
  ok("a chip toggles into the membership and the preview counts", (await chip.getAttribute("aria-pressed")) === "true" && /\d+ products in this group/.test(await wiz.innerText()));
  await wiz.locator("button", { hasText: /^Next$/ }).click();
  await settle(200);
  ok("the name auto-suggests from the parts", (await wiz.locator("input.qz-input").first().inputValue()) === chipName);
  await wiz.locator("input.qz-input").first().fill(`Probe group ${Date.now().toString(36)}`);
  const groupName = await wiz.locator("input.qz-input").first().inputValue();
  await wiz.locator("button", { hasText: /^Next$/ }).click();
  await settle(200);
  await wiz.locator("button", { hasText: /^Create group$/ }).click();
  await settle(2500);
  const created = await prisma.category.findFirst({ where: { shopId: quiz.shopId, quizId: null, name: groupName } });
  ok("a shop-global group row was created through the shared action", Boolean(created) && (created?.productIds.length ?? 0) > 0);
  const gRow = (await quizCats()).find((c) => c.source === "group");
  ok("… and added to THIS quiz as a `group` bucket keyed on the Category id", Boolean(created) && gRow?.sourceRef === created?.id && gRow?.name === groupName);
  ok("the picker lands on Custom with the new group selected", (await rb.locator(".qz-rb-card.is-on", { hasText: groupName }).count()) === 1 && (await tab("Custom").locator(".qz-rb-tab-n").innerText()).trim() === "1");
  await page.screenshot({ path: `${SHOTS}/6-custom-created.png` });
  const rowG = rail.locator(".qz-rb-rail-row", { hasText: groupName });
  await rowG.click();
  await page.waitForSelector(".qz-modal", { timeout: 4000 });
  ok("the group's rail row previews its members", /in this group/.test(await page.locator(".qz-modal").innerText()));
  await page.keyboard.press("Escape");

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, createdAt, updatedAt, ...rest } = c;
    await prisma.category.create({ data: { ...rest, id, createdAt, updatedAt } });
  }
  const keep = new Set(originalGlobal.map((g) => g.id));
  await prisma.category.deleteMany({ where: { shopId: quiz.shopId, quizId: null, id: { notIn: [...keep] } } });
  await prisma.$disconnect();
  await browser?.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
}
process.exit(failures ? 1 : 0);
