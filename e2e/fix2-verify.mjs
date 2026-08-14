// FIX-2 live-verify — builder stage whitespace + build-tab.html geometry
// parity, against a LOCAL production build (BASE env, default
// http://localhost:3000).
//
// Fixture: LOCAL draft cmr7khgd50001vkhscvox8dgt. Snapshots draftJson up
// front, strips build_session for the session (builder, not funnel), drives
// the device/placement toggles, and restores draftJson BYTE-FOR-BYTE in
// `finally`. Screenshots land in /tmp/fix2-shots/probe.
//
// Ported 2026-08-14 to drag/2026-08 (ResizableViewport, owner 2026-08-13):
// the old fill-chain classes (.qz-devfill, .qz-canvas-card) and the 844/760
// frame heights are GONE, and so is the interim fixed 390×745/960×700
// DeviceFrame on this surface. The builder canvas is a resizable 1:1 browser
// viewport (.qz-rsvp-frame): Phone/Desktop are WIDTH PRESETS (390 / 1280),
// the zoom cluster is retired for a width readout, and the definite height
// chain (screen → root → page) replaced the old fill divs.
//
// Asserts (the build-tab.html page geometry + the resizable viewport):
//  1. Chrome columns at spec: rail 60 · library 244 · inspector 320.
//  2. Canvas padding 24px 16px 16px (spec .stage), centered, stretch-anchored.
//  3. The stagebar exists (step name · Show-as on desktop · Expand · width
//     readout) and those controls are OFF the top bar.
//  4. Phone preset: a 390px browser window at 1:1; the runtime root fills
//     the (≤745-capped) screen.
//  5. Desktop preset: 1280px at 1:1 with the browser-chrome bar; the root
//     fills the screen under it.
//  6. Pop-up: the launcher modal over the dimmed mock storefront; the quiz
//     fills the .qz-dpop-modal envelope.
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
  // drag/2026-08: the zoom cluster is RETIRED (the frame is always 1:1) —
  // the stagebar carries the width readout instead (updated 2026-08-14).
  ok("width readout lives on the stagebar", (await bar.locator(".qz-bt-zlabel").count()) === 1);
  ok(
    "top bar carries neither Expand nor Show-as",
    (await page.locator(".qz-topbar .qz-s3-expandbtn").count()) === 0 &&
      (await page.locator('.qz-topbar [aria-label="Show as"]').count()) === 0,
  );

  // ── 4: the Phone preset (drag/2026-08) ────────────────────────────────────
  // .qz-devfill is GONE (rewritten 2026-08-14) and the interim fixed 390×745
  // frame retired: the Phone button is now a 390px WIDTH PRESET on the 1:1
  // .qz-rsvp-frame (height caps at the 745 phone viewport). The runtime root
  // is the direct child of .qz-devscreen; the definite height chain fills it.
  // The old "paints its own background" check stays retired — the QB-10
  // canvas rule strips the page backdrop on purpose.
  await page.locator('button[aria-label^="Phone"]').first().click();
  await page.waitForSelector(".qz-device-fit-mobile", { timeout: 5000 });
  await page.waitForTimeout(500);
  const mobileFill = await page.evaluate(() => {
    const frame = document.querySelector(".qz-builder-canvas .qz-rsvp-frame");
    const screen = frame?.querySelector(".qz-devscreen");
    const root = screen?.querySelector(":scope > div");
    if (!frame || !screen || !root) return null;
    return {
      frameW: frame.offsetWidth,
      painted: frame.getBoundingClientRect().width,
      screenH: screen.clientHeight,
      rootH: root.offsetHeight,
    };
  });
  ok("phone: viewport chain present (frame → screen → root)", !!mobileFill);
  ok(
    "phone preset: a 390px browser window at 1:1",
    !!mobileFill && mobileFill.frameW === 390 && Math.abs(mobileFill.painted - 390) < 0.5,
    mobileFill ? `w=${mobileFill.frameW} painted=${mobileFill.painted}` : "",
  );
  ok(
    "phone: quiz fills the (≤745-capped) screen",
    !!mobileFill && mobileFill.rootH >= mobileFill.screenH - 2,
    mobileFill ? `root=${mobileFill.rootH} screen=${mobileFill.screenH}` : "",
  );
  await page.screenshot({ path: `${SHOTS}/mobile-fill.png` });

  // ── 5: the Desktop preset (drag/2026-08) ──────────────────────────────────
  // .qz-canvas-card is GONE and the interim fixed 960×700 frame retired
  // (rewritten 2026-08-14): Desktop is a 1280px WIDTH PRESET at 1:1 — wider
  // than the pane, which scrolls instead of scaling — with the browser-chrome
  // bar on top; the root fills the screen under it.
  await page.locator('button[aria-label^="Desktop"]').first().click();
  await page.waitForSelector(".qz-device-fit-desktop", { timeout: 5000 });
  await page.waitForTimeout(700);
  ok(
    "Show-as joins the stagebar on desktop",
    (await bar.locator('[aria-label="Show as"]').count()) === 1,
  );
  const deskFill = await page.evaluate(() => {
    const frame = document.querySelector(".qz-builder-canvas .qz-rsvp-frame");
    const screen = frame?.querySelector(".qz-devscreen");
    const root = screen?.querySelector(":scope > div");
    if (!frame || !screen || !root) return null;
    return {
      frameW: frame.offsetWidth,
      painted: frame.getBoundingClientRect().width,
      chrome: !!frame.querySelector(".qz-rsvp-chrome"),
      screenH: screen.clientHeight,
      rootH: root.offsetHeight,
    };
  });
  ok("desktop: viewport chain present (frame → screen → root)", !!deskFill);
  ok(
    "desktop preset: 1280px at 1:1 with the browser-chrome bar",
    !!deskFill && deskFill.frameW === 1280 && Math.abs(deskFill.painted - 1280) < 0.5 && deskFill.chrome,
    deskFill ? `w=${deskFill.frameW} painted=${deskFill.painted} chrome=${deskFill.chrome}` : "",
  );
  ok(
    "desktop full page: quiz fills the screen under the chrome bar",
    !!deskFill && deskFill.rootH >= deskFill.screenH - 2,
    deskFill ? `root=${deskFill.rootH} screen=${deskFill.screenH}` : "",
  );
  await page.screenshot({ path: `${SHOTS}/desktop-fill.png` });

  // ── 6: pop-up modal fill (writes doc.placement; restored in finally) ──────
  await bar.locator('[aria-label="Show as"] button', { hasText: "Pop-up" }).click();
  await page.waitForTimeout(1600); // let the autosave PUT settle before restore
  // Pop-up placement (rewritten 2026-08-14, drag/2026-08): the screen renders
  // the launcher modal OVER the dimmed mock storefront — .qz-mockstore behind,
  // .qz-dpop-backdrop > .qz-dpop-modal > quiz root (ResizableViewport.tsx).
  const popFill = await page.evaluate(() => {
    const screen = document.querySelector(".qz-builder-canvas .qz-rsvp-frame .qz-devscreen");
    const store = screen?.querySelector(".qz-mockstore");
    const modal = screen?.querySelector(".qz-dpop-modal");
    const root = modal?.querySelector(":scope > div");
    if (!store || !modal || !root) return null;
    return { modalH: modal.clientHeight, rootH: root.scrollHeight };
  });
  ok("pop-up: launcher modal over the dimmed mock storefront", !!popFill);
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
