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
// Asserts: segmented "One screen | All screens" (aria-pressed, QRTZ-H4 mock labels) · grid renders
// one live card per reachable screen + the dashed New-screen card · Global
// panel kickers/hints · brand color, button softness and content padding edits
// repaint ≥2 DIFFERENT cards (getComputedStyle) AND persist through the
// autosave PUT (prisma read-back) · filmstrip retired (QRTZ-H4) ·
// card click focuses the screen + flips to One-screen · + New screen adds a
// question BEFORE the terminal (the add-anchor rule) · zero page errors.
// FIX-4 layout assertions (the BLD-3 grid regression shipped past the DOM
// checks): the stage track really holds the cards, the inspector is the
// right-edge 320px column, cells = screens + 1, top-bar segs present.
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
  const oneBtn = modeGroup.locator("button", { hasText: "One screen" });
  ok(
    "defaults to One screen (aria-pressed)",
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
  // FIX-4 — the device/mode segs STAY in All-screens (the BLD-3 regression
  // stripped them); the stage-scoped Expand/zoom cluster still steps aside.
  ok(
    "canvas-bar segs stay in All-screens mode (Preview device + Preview mode)",
    (await page.locator('[role=group][aria-label="Preview device"]').count()) === 1 &&
      (await page.locator('[role=group][aria-label="Preview mode"]').count()) === 1 &&
      (await page.locator(".qz-s3-expandbtn").count()) === 0,
  );
  // QRTZ-H4 — the filmstrip is retired; the grid cards ARE the switcher here.
  ok("filmstrip retired (QRTZ-H4)", (await page.locator(".qz-screens").count()) === 0);

  // ── FIX-4 layout assertions (the BLD-3 grid regression: the stage fell
  //    into the is-libhidden 0-width track and the inspector into the 1fr
  //    track — DOM presence passed while the layout was destroyed) ──────────
  const stageBox = await page.locator(".qz-builder-stage").boundingBox();
  const inspBox = await page.locator(".qz-builder-inspector").boundingBox();
  const gspBox = await page.locator(".qz-gsp").boundingBox();
  const card0Box = await page.locator(".qz-allcard").first().boundingBox();
  const bodyBox = await page.locator(".qz-builder-body").boundingBox();
  ok(
    "stage track holds the card grid (width ≥ 320, cards inside it)",
    stageBox !== null &&
      card0Box !== null &&
      stageBox.width >= 320 &&
      card0Box.x >= stageBox.x - 1 &&
      card0Box.x + card0Box.width <= stageBox.x + stageBox.width + 1,
    `stage=${JSON.stringify(stageBox)} card0=${JSON.stringify(card0Box)}`,
  );
  ok(
    "inspector is the right-edge 320px column and hosts the Global panel",
    inspBox !== null &&
      gspBox !== null &&
      bodyBox !== null &&
      inspBox.width >= 300 &&
      inspBox.width <= 340 &&
      Math.abs(inspBox.x + inspBox.width - (bodyBox.x + bodyBox.width)) <= 2 &&
      gspBox.x >= inspBox.x - 1 &&
      gspBox.x + gspBox.width <= inspBox.x + inspBox.width + 1,
    `insp=${JSON.stringify(inspBox)} gsp=${JSON.stringify(gspBox)}`,
  );
  ok(
    "grid cells = screens + the New-screen cell (no duplicate mounts)",
    (await page.locator(".qz-allscreens-cell").count()) === nodeCount + 1,
  );

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

  // ── card click → focus + flip to One screen (QRTZ-H4: the filmstrip is
  //    gone; the grid cards are the All-screens switcher, the Flow tab the
  //    single-screen one) ──────────────────────────────────────────────────
  const targetTitle = (await page.locator(".qz-allcard-title").nth(2).textContent()) ?? "";
  await page.locator(".qz-allcard").nth(2).click();
  await page.waitForTimeout(800);
  ok(
    "card click flips to One screen",
    (await oneBtn.getAttribute("aria-pressed")) === "true" &&
      (await page.locator(".qz-allscreens").count()) === 0 &&
      (await page.locator(".qz-builder-canvas").count()) === 1,
  );
  ok(
    "…and focuses that screen (the Flow tab's open row follows)",
    (await page.locator(".qz-ftree-row.is-open").count()) === 1,
    `opened: ${targetTitle}`,
  );
  ok(
    "single-screen stage controls return (Expand)",
    (await page.locator(".qz-s3-expandbtn").count()) === 1 &&
      (await page.locator('[role=group][aria-label="Preview device"]').count()) === 1,
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
