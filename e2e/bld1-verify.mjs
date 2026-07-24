// BLD-1 live-verify — the All-screens canvas + simplified Global styles panel
// against a LOCAL production build (BASE env, default http://localhost:3000).
//
// Fixture: LOCAL draft cmr7khgd50001vkhscvox8dgt. The probe snapshots
// draftJson up front, strips build_session for the session (so /studio/:id
// opens the builder, not the funnel), drives the real affordances (mode
// toggle, Global-panel edits through the autosave PUT, card click, + New
// screen), and restores draftJson BYTE-FOR-BYTE in `finally`. Screenshots
// land in /tmp/bld1-shots.
//
// Asserts: segmented "All screens | This screen" (aria-pressed) · grid renders
// one live card per reachable screen + the dashed New-screen card · Global
// panel kickers/hints · brand color, button softness and content padding edits
// repaint ≥2 DIFFERENT cards (getComputedStyle) AND persist through the
// autosave PUT (prisma read-back) · filmstrip stays and highlights follow ·
// card click focuses the screen + flips to This-screen · + New screen adds a
// question BEFORE the terminal (the add-anchor rule) · zero page errors.
//
// Run:  set -a; source .env; set +a; node e2e/bld1-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/bld1-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const mask = (s) => String(s).replaceAll(KEY, "***");
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${mask(detail)}` : ""}`);
  if (!cond) failures++;
};

const prisma = new PrismaClient();
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found in the LOCAL DB");
  await prisma.$disconnect();
  process.exit(1);
}
const snapshot = JSON.stringify(quiz.draftJson);
console.log(`snapshot taken (${snapshot.length} bytes)`);

// Builder, not funnel: strip build_session for the session (restored below).
const { build_session: _bs, ...builderDoc } = quiz.draftJson;
await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: builderDoc } });
const nodeCount = builderDoc.nodes.length;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));

// Static in-page readers (no dynamic code eval).
const readCardPrimaries = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".qz-allcard-doc")]
      .slice(0, 3)
      .map((el) => getComputedStyle(el).getPropertyValue("--qz-color-primary").trim()),
  );
const readCardPaddings = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".qz-allcard-doc")]
      .slice(0, 3)
      .map((el) => getComputedStyle(el).paddingTop),
  );
const readCardButtonRadii = () =>
  page.evaluate(() => {
    const out = [];
    for (const doc of document.querySelectorAll(".qz-allcard-doc")) {
      const b = doc.querySelector("button");
      if (b) out.push(getComputedStyle(b).borderRadius);
    }
    return out;
  });

try {
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 15000 });
  await page.waitForTimeout(1500); // hydration settle

  // ── mode toggle ────────────────────────────────────────────────────────────
  const modeGroup = page.locator('[role=group][aria-label="Canvas mode"]');
  ok("canvas-mode segmented control in the top bar", (await modeGroup.count()) === 1);
  const allBtn = modeGroup.locator("button", { hasText: "All screens" });
  const oneBtn = modeGroup.locator("button", { hasText: "This screen" });
  ok(
    "defaults to This screen (aria-pressed)",
    (await oneBtn.getAttribute("aria-pressed")) === "true" &&
      (await allBtn.getAttribute("aria-pressed")) === "false",
  );

  await allBtn.click();
  await page.waitForTimeout(600);
  ok(
    "All screens becomes the pressed mode",
    (await allBtn.getAttribute("aria-pressed")) === "true",
  );

  // ── grid ───────────────────────────────────────────────────────────────────
  ok("all-screens grid renders", (await page.locator(".qz-allscreens").count()) === 1);
  const cardCount = await page.locator(".qz-allcard").count();
  ok(
    "one card per reachable screen",
    cardCount === nodeCount,
    `cards=${cardCount} nodes=${nodeCount}`,
  );
  ok("dashed + New screen card", (await page.locator(".qz-allcard-add").count()) === 1);
  const kickers = await page.locator(".qz-allcard-kicker").allTextContents();
  ok(
    "cards carry mono kickers (INTRO first, terminal last)",
    kickers[0] === "INTRO" && ["RESULT", "END"].includes(kickers[kickers.length - 1]),
    kickers.join(","),
  );
  ok(
    "cards carry titles + ordinals",
    (await page.locator(".qz-allcard-title").count()) === cardCount &&
      (await page.locator(".qz-allcard-ord").first().textContent()) === "01",
  );
  ok(
    "single-screen controls leave the top bar in All-screens mode",
    (await page.locator('[role=group][aria-label="Device size"]').count()) === 0 &&
      (await page.locator(".qz-s3-expandbtn").count()) === 0,
  );
  ok("filmstrip stays in All-screens mode", (await page.locator(".qz-screens").count()) === 1);

  // ── global panel ───────────────────────────────────────────────────────────
  const gsp = page.locator(".qz-gsp");
  ok("Global styles panel in the inspector rail", (await gsp.count()) === 1);
  const gspKickers = await gsp.locator(".qz-gsp-kicker").allTextContents();
  ok(
    "panel groups: BRAND · TYPE · BUTTONS · ANSWERS · SCREEN",
    ["BRAND", "TYPE", "BUTTONS", "ANSWERS", "SCREEN"].every((k) => gspKickers.includes(k)),
    gspKickers.join(","),
  );
  ok(
    "right-aligned hints (every screen follows / all buttons / breathing room)",
    (await gsp.locator(".qz-gsp-hint", { hasText: "every screen follows" }).count()) === 1 &&
      (await gsp.locator(".qz-gsp-hint", { hasText: "all buttons" }).count()) === 1 &&
      (await gsp.locator(".qz-gsp-hint", { hasText: "breathing room" }).count()) === 1,
  );

  await page.screenshot({ path: `${SHOTS}/bld1-allscreens-grid.png` });
  await page
    .locator(".qz-builder-inspector")
    .screenshot({ path: `${SHOTS}/bld1-global-panel.png` });

  // ── brand color edit → ≥2 cards repaint + autosave persists ───────────────
  await page.screenshot({ path: `${SHOTS}/bld1-brand-before.png` });
  const before = await readCardPrimaries();
  const brandHex = page.locator('input[aria-label="Brand color hex"]');
  await brandHex.fill("#e11d48");
  await brandHex.press("Enter");
  await page.waitForTimeout(400);
  const after = await readCardPrimaries();
  ok(
    "brand color repaints ≥2 different cards live",
    after.filter((v) => v === "#e11d48").length >= 2 && before[0] !== "#e11d48",
    `before=${before.join("|")} after=${after.join("|")}`,
  );
  await page.screenshot({ path: `${SHOTS}/bld1-brand-after.png` });

  // ── button softness → primary buttons in ≥2 cards ─────────────────────────
  const btnNum = page.locator('input[aria-label="Button softness exact value"]');
  await btnNum.fill("24");
  await page.waitForTimeout(400);
  const btnRadii = await readCardButtonRadii();
  ok(
    "button softness reaches primary buttons in ≥2 cards",
    btnRadii.filter((r) => r === "24px").length >= 2,
    btnRadii.join("|"),
  );

  // ── content padding → the card surface in ≥2 cards ────────────────────────
  const padNum = page.locator('input[aria-label="Content padding exact value"]');
  await padNum.fill("48");
  await page.waitForTimeout(400);
  const pads = await readCardPaddings();
  ok(
    "content padding restyles ≥2 cards (var --qz-pp-top)",
    pads.filter((p) => p === "48px").length >= 2,
    pads.join("|"),
  );

  // Autosave PUT (700 ms debounce) → the draft persists all three edits.
  await page.waitForTimeout(1800);
  const saved = await prisma.quiz.findUnique({ where: { id: QUIZ } });
  const dt = saved.draftJson?.design_tokens ?? {};
  ok(
    "edits persist via the autosave PUT (colors.primary / button_radius / page_padding)",
    dt.colors?.primary === "#e11d48" &&
      dt.button_radius === 24 &&
      dt.page_padding?.top === 48 &&
      dt.page_padding?.left === 48,
    JSON.stringify({
      primary: dt.colors?.primary,
      button_radius: dt.button_radius,
      page_padding: dt.page_padding,
    }),
  );

  // ── filmstrip highlight follows grid selection ────────────────────────────
  await page.locator(".qz-screens-thumb").nth(1).click();
  await page.waitForTimeout(400);
  ok(
    "filmstrip click highlights the matching grid card (still All-screens)",
    (await page.locator(".qz-allcard.is-active").count()) === 1 &&
      (await page.locator(".qz-screens-item.is-active").count()) === 1 &&
      (await allBtn.getAttribute("aria-pressed")) === "true",
  );

  // ── card click → focus + flip to This screen ──────────────────────────────
  const targetTitle = (await page.locator(".qz-allcard-title").nth(2).textContent()) ?? "";
  await page.locator(".qz-allcard").nth(2).click();
  await page.waitForTimeout(800);
  ok(
    "card click flips to This screen",
    (await oneBtn.getAttribute("aria-pressed")) === "true" &&
      (await page.locator(".qz-allscreens").count()) === 0 &&
      (await page.locator(".qz-builder-canvas").count()) === 1,
  );
  ok(
    "…and focuses that screen (filmstrip highlight follows)",
    (await page.locator(".qz-screens-item.is-active").count()) === 1,
    `opened: ${targetTitle}`,
  );
  ok(
    "single-screen controls return",
    (await page.locator('[role=group][aria-label="Device size"]').count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/bld1-this-screen-after-card-click.png` });

  // ── + New screen (add-anchor rule: appends at the END, before the
  //    terminal — even with a mid-flow screen still selected) ────────────────
  await allBtn.click();
  await page.waitForTimeout(600);
  const titlesBeforeAdd = await page.locator(".qz-allcard-title").allTextContents();
  await page.locator(".qz-allcard-add").click();
  await page.waitForTimeout(800);
  const kickersAfterAdd = await page.locator(".qz-allcard-kicker").allTextContents();
  const titlesAfterAdd = await page.locator(".qz-allcard-title").allTextContents();
  const newIdx = titlesAfterAdd.findIndex((t, i) => t !== titlesBeforeAdd[i]);
  ok(
    "+ New screen adds a question card",
    kickersAfterAdd.length === cardCount + 1 &&
      kickersAfterAdd.filter((k) => k === "QUESTION").length ===
        kickers.filter((k) => k === "QUESTION").length + 1,
    kickersAfterAdd.join(","),
  );
  ok(
    "new question appends at the END (last movable slot, never after the terminal)",
    newIdx === kickersAfterAdd.length - 2 &&
      ["RESULT", "END"].includes(kickersAfterAdd[kickersAfterAdd.length - 1]),
    `newIdx=${newIdx} kickers=${kickersAfterAdd.join(",")}`,
  );

  ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: JSON.parse(snapshot) },
  });
  const restored = await prisma.quiz.findUnique({ where: { id: QUIZ } });
  console.log(
    JSON.stringify(restored.draftJson) === snapshot
      ? "fixture restored byte-for-byte"
      : "WARNING: restore mismatch — inspect the fixture",
  );
  await prisma.$disconnect();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
