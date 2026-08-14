// FIX-2 live-verify — builder stage whitespace + build-tab.html geometry
// parity, against a LOCAL production build (BASE env, default
// http://localhost:3000).
//
// Fixture: LOCAL draft cmr7khgd50001vkhscvox8dgt. Snapshots draftJson up
// front, strips build_session for the session (builder, not funnel), drives
// the device/placement toggles, and restores draftJson BYTE-FOR-BYTE in
// `finally`. Screenshots land in /tmp/fix2-shots/probe.
//
// Asserts (the build-tab.html page geometry + the frame-fill fix):
//  1. Chrome columns at spec: rail 60 · library 244 · inspector 320.
//  2. Canvas padding 24px 16px 16px (spec .stage), centered, top-anchored.
//  3. The stagebar exists (step name · Show-as on desktop · Expand · zoom) and
//     those controls are OFF the top bar.
//  4. Mobile frame fill: the runtime root stretches to the full 844px logical
//     screen and paints a non-transparent background (no dead-white region).
//  5. Desktop full-page fill: the fill chain spans the full 760px frame.
//  6. Pop-up: the modal's quiz fills the modal envelope.
//  7. Filmstrip RETIRED (QRTZ-H4): the Flow tab renders the screen rows.
//  8. Panel ed-tabs clear the collapse chevron. 9. Zero page errors.
//
// Run:  set -a; source .env; set +a; node e2e/fix2-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/fix2-shots/probe";

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
const { build_session: _bs, ...builderDoc } = quiz.draftJson;
await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: builderDoc } });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));

try {
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 15000 });
  await page.waitForTimeout(1500);

  // ── 1+2: build-tab.html page geometry ─────────────────────────────────────
  const geo = await page.evaluate(() => {
    const w = (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? null;
    const canvas = document.querySelector(".qz-builder-canvas");
    return {
      rail: w(".qz-builder-rail"),
      panel: w(".qz-builder-panel"),
      inspector: w(".qz-builder-inspector"),
      canvasPad: canvas ? getComputedStyle(canvas).padding : null,
      canvasJustify: canvas ? getComputedStyle(canvas).justifyContent : null,
      canvasAlign: canvas ? getComputedStyle(canvas).alignItems : null,
    };
  });
  ok("rail is 60px (spec col 1)", geo.rail === 60, `${geo.rail}`);
  ok("library is 244px (spec col 2)", geo.panel === 244, `${geo.panel}`);
  ok("inspector is 320px (spec col 4)", geo.inspector === 320, `${geo.inspector}`);
  ok("canvas padding 24px 16px 16px (spec .stage)", geo.canvasPad === "24px 16px 16px", geo.canvasPad);
  // viewport/2026-08 — align-items is STRETCH now (the DeviceFrame fit rule
  // needs a definite height axis); centered on the inline axis stands.
  ok(
    "canvas centered + stretch-anchored (viewport/2026-08)",
    geo.canvasJustify === "center" && geo.canvasAlign === "stretch",
    `${geo.canvasJustify}/${geo.canvasAlign}`,
  );

  // ── 3: the stagebar owns the stage-scoped controls ────────────────────────
  const bar = page.locator(".qz-stagebar");
  ok("stagebar renders", (await bar.count()) === 1);
  ok(
    "stagebar shows the step name",
    ((await page.locator(".qz-stagebar-name").textContent()) ?? "").trim().length > 0,
    (await page.locator(".qz-stagebar-name").textContent()) ?? "",
  );
  ok("Expand lives on the stagebar", (await bar.locator(".qz-s3-expandbtn").count()) === 1);
  ok("zoom lives on the stagebar", (await bar.locator('[aria-label="Zoom in"]').count()) === 1);
  ok(
    "top bar carries neither Expand nor Show-as",
    (await page.locator(".qz-topbar .qz-s3-expandbtn").count()) === 0 &&
      (await page.locator('.qz-topbar [aria-label="Show as"]').count()) === 0,
  );

  // ── 4: mobile frame fill ──────────────────────────────────────────────────
  await page.locator('button[aria-label="Phone"]').click();
  await page.waitForSelector(".qz-device-fit-mobile", { timeout: 5000 });
  await page.waitForTimeout(500);
  const mobileFill = await page.evaluate(() => {
    const screen = document.querySelector(".qz-builder-canvas .qz-devscreen");
    const fill = screen?.querySelector(".qz-devfill");
    const root = fill?.querySelector(":scope > div");
    if (!screen || !fill || !root) return null;
    const bg = getComputedStyle(root).backgroundColor;
    return {
      screenH: screen.clientHeight,
      fillH: fill.getBoundingClientRect().height / (new DOMMatrix(getComputedStyle(document.querySelector(".qz-devframe")).transform).a || 1),
      rootH: root.getBoundingClientRect().height / (new DOMMatrix(getComputedStyle(document.querySelector(".qz-devframe")).transform).a || 1),
      rootBgOpaque: bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent",
    };
  });
  ok("mobile: fill chain present", !!mobileFill);
  ok(
    "mobile: quiz stretches to the full 844 screen",
    !!mobileFill && mobileFill.rootH >= mobileFill.screenH - 2,
    mobileFill ? `root=${mobileFill.rootH.toFixed(1)} screen=${mobileFill.screenH}` : "",
  );
  ok("mobile: quiz paints its own background (no dead white)", !!mobileFill?.rootBgOpaque);
  await page.screenshot({ path: `${SHOTS}/mobile-fill.png` });

  // ── 5: desktop full-page fill ─────────────────────────────────────────────
  await page.locator('button[aria-label="Desktop"]').click();
  await page.waitForSelector(".qz-device-fit-desktop", { timeout: 5000 });
  await page.waitForTimeout(700);
  ok(
    "Show-as joins the stagebar on desktop",
    (await bar.locator('[aria-label="Show as"]').count()) === 1,
  );
  const deskFill = await page.evaluate(() => {
    const card = document.querySelector(".qz-device-fit-desktop .qz-canvas-card");
    const fill = card?.querySelector(":scope > .qz-devfill");
    const root = fill?.querySelector(":scope > div");
    if (!card || !fill || !root) return null;
    return { cardH: card.clientHeight, rootH: root.getBoundingClientRect().height / (new DOMMatrix(getComputedStyle(card).transform).a || 1) };
  });
  ok("desktop full page: fill chain present", !!deskFill);
  ok(
    "desktop full page: quiz spans the full 760 frame",
    !!deskFill && deskFill.rootH >= deskFill.cardH - 2,
    deskFill ? `root=${deskFill.rootH.toFixed(1)} card=${deskFill.cardH}` : "",
  );
  await page.screenshot({ path: `${SHOTS}/desktop-fill.png` });

  // ── 6: pop-up modal fill (writes doc.placement; restored in finally) ──────
  await bar.locator('[aria-label="Show as"] button', { hasText: "Pop-up" }).click();
  await page.waitForTimeout(1600); // let the autosave PUT settle before restore
  const popFill = await page.evaluate(() => {
    const modal = document.querySelector(".qz-device-fit-desktop .qz-canvas-card .qz-devfill");
    const root = modal?.querySelector(":scope > div");
    if (!modal || !root) return null;
    return { modalH: modal.clientHeight, rootH: root.scrollHeight };
  });
  ok("pop-up: modal fill chain present", !!popFill);
  ok(
    "pop-up: quiz fills the modal envelope",
    !!popFill && popFill.rootH >= popFill.modalH - 2,
    popFill ? `root=${popFill.rootH} modal=${popFill.modalH}` : "",
  );
  await page.screenshot({ path: `${SHOTS}/popup-fill.png` });

  // ── 7: the filmstrip is RETIRED (QRTZ-H4 — the Flow tab is the switcher) ──
  ok(
    "filmstrip retired (no .qz-screens; the Flow tab renders rows)",
    (await page.locator(".qz-screens").count()) === 0 &&
      (await page.locator(".qz-ftree-row").count()) >= 2,
  );

  // ── 8: panel tabs clear the collapse chevron ──────────────────────────────
  const lib = await page.evaluate(() => {
    // QRTZ-H4 — the tabs are the mock's ed-tabs seg (.qz-bt-edtabs).
    const seg = document.querySelector(".qz-builder-panel .qz-bt-edtabs")?.getBoundingClientRect();
    const chev = document.querySelector(".qz-builder-panel-collapse")?.getBoundingClientRect();
    return seg && chev ? { segRight: seg.right, chevLeft: chev.left } : null;
  });
  ok(
    "library tabs clear the collapse chevron",
    !!lib && lib.segRight <= lib.chevLeft + 1,
    lib ? `seg.right=${lib.segRight.toFixed(1)} chev.left=${lib.chevLeft.toFixed(1)}` : "",
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
