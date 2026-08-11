// viewport/2026-08 live-verify — the fixed two-viewport preview contract
// (GLOBAL-VIEWPORT.md) against a LOCAL production build (BASE env, default
// http://localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — every
// interaction is device-toggle / zoom / expand / scroll; no doc commit fires.
//
// Asserts:
//  1. Phone frame is EXACTLY 390×745 layout px (a browser viewport, not the
//     844px device screen), carries a transform (never none) + contain:paint,
//     and its painted box never exceeds the pane (scale ≤ 1).
//  2. The height chain resolves: screen = root = page = 745 on a short step,
//     page padding 24/24, content vertically CENTRED (symmetric gaps).
//  3. Desktop frame is exactly 960×700, runtime renders qz-bp-desktop with
//     padding-top 48.
//  4. Zoom clamps the fit scale (80% → scale ≤ 0.8), never multiplies.
//  5. Expand: same frame in the overlay host, scale ≤ 1 (never upscales).
// Screenshots land in /tmp/vp-shots/.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = process.env.QUIZ ?? "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/vp-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));

await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 15000 });
await page.waitForTimeout(1500);

// ── 1+2: the phone viewport (DEFAULT_TIER — should already be selected) ─────
const phonePressed = await page
  .locator('button[aria-label="Phone"]')
  .first()
  .getAttribute("aria-pressed");
ok("phone is the default tier", phonePressed === "true");
await page.waitForSelector(".qz-device-fit-mobile .qz-devframe", { timeout: 5000 });
await page.waitForTimeout(400);

const phone = await page.evaluate(() => {
  const pane = document.querySelector(".qz-builder-canvas .qz-vp-pane");
  const frame = pane?.querySelector(".qz-devframe");
  const screen = frame?.querySelector(".qz-devscreen");
  const root = screen?.querySelector(".qz-bp-mobile, .qz-bp-desktop");
  const pageEl = root?.querySelector(".qz-runtime-page");
  const shell = pageEl?.querySelector(".qz-runtime-shell");
  if (!pane || !frame || !screen || !root || !pageEl) return null;
  const cs = getComputedStyle(frame);
  const pcs = getComputedStyle(pageEl);
  const fr = frame.getBoundingClientRect();
  const pr = pane.getBoundingClientRect();
  const pg = pageEl.getBoundingClientRect();
  const sh = shell?.getBoundingClientRect() ?? null;
  return {
    tier: frame.dataset.qzTier,
    frameW: frame.offsetWidth,
    frameH: frame.offsetHeight,
    transform: cs.transform,
    contain: cs.contain,
    screenH: screen.offsetHeight,
    rootH: root.offsetHeight,
    rootClass: root.className,
    pageH: pageEl.offsetHeight,
    padTop: pcs.paddingTop,
    padBottom: pcs.paddingBottom,
    scrollTop: screen.scrollTop,
    paintedInPane:
      fr.width <= pr.width + 1 &&
      fr.height <= pr.height + 1 &&
      fr.left >= pr.left - 1 &&
      fr.top >= pr.top - 1,
    centreDelta: sh ? Math.abs(sh.top - pg.top - (pg.bottom - sh.bottom)) : null,
  };
});

ok("phone frame exists", !!phone);
if (phone) {
  ok("phone layout box is exactly 390×745", phone.frameW === 390 && phone.frameH === 745, `${phone.frameW}×${phone.frameH}`);
  ok("frame always carries a transform", phone.transform !== "none", phone.transform);
  ok("frame contains paint", phone.contain.includes("paint"), phone.contain);
  ok("tier stamped on the frame", phone.tier === "phone");
  ok("runtime got the mobile breakpoint", phone.rootClass.includes("qz-bp-mobile"));
  ok("height chain: screen fills the frame", phone.screenH === 745, `screen ${phone.screenH}`);
  ok("height chain: root fills the screen", phone.rootH === 745, `root ${phone.rootH}`);
  ok("height chain: page fills the root (or grows)", phone.pageH >= 745, `page ${phone.pageH}`);
  ok("page padding 24/24", phone.padTop === "24px" && phone.padBottom === "24px", `${phone.padTop}/${phone.padBottom}`);
  ok("not pre-scrolled on load", phone.scrollTop === 0);
  ok("painted frame stays inside the pane (scale ≤ 1, whole device visible)", phone.paintedInPane);
  if (phone.pageH === 745 && phone.centreDelta !== null) {
    ok("content vertically centred (symmetric gaps)", phone.centreDelta < 2, `delta ${phone.centreDelta?.toFixed(1)}px`);
  }
}
await page.screenshot({ path: `${SHOTS}/01-phone.png` });

// ── 3: the desktop viewport ─────────────────────────────────────────────────
await page.locator('button[aria-label="Desktop"]').first().click();
await page.waitForSelector(".qz-device-fit-desktop .qz-devframe", { timeout: 5000 });
await page.waitForTimeout(400);

const desk = await page.evaluate(() => {
  const frame = document.querySelector(".qz-builder-canvas .qz-devframe");
  const screen = frame?.querySelector(".qz-devscreen");
  const root = screen?.querySelector(".qz-bp-mobile, .qz-bp-desktop");
  const pageEl = root?.querySelector(".qz-runtime-page");
  if (!frame || !root || !pageEl) return null;
  const cs = getComputedStyle(frame);
  const pcs = getComputedStyle(pageEl);
  return {
    tier: frame.dataset.qzTier,
    frameW: frame.offsetWidth,
    frameH: frame.offsetHeight,
    transform: cs.transform,
    rootClass: root.className,
    padTop: pcs.paddingTop,
  };
});
ok("desktop frame exists", !!desk);
if (desk) {
  ok("desktop layout box is exactly 960×700", desk.frameW === 960 && desk.frameH === 700, `${desk.frameW}×${desk.frameH}`);
  ok("desktop transform present", desk.transform !== "none", desk.transform);
  ok("runtime got the desktop breakpoint", desk.rootClass.includes("qz-bp-desktop"));
  ok("desktop padding-top 48 (shell rule)", desk.padTop === "48px", desk.padTop);
}
await page.screenshot({ path: `${SHOTS}/02-desktop.png` });

// ── 4: zoom clamps, never multiplies ────────────────────────────────────────
await page.locator('button[aria-label="Zoom out"]').click();
await page.locator('button[aria-label="Zoom out"]').click(); // 100 → 80
await page.waitForTimeout(300);
const zoomScale = await page.evaluate(() => {
  const frame = document.querySelector(".qz-builder-canvas .qz-devframe");
  if (!frame) return null;
  const m = new DOMMatrix(getComputedStyle(frame).transform);
  return m.a;
});
ok("zoom 80% clamps the scale (≤ 0.8, > 0)", zoomScale !== null && zoomScale <= 0.801 && zoomScale > 0, `scale ${zoomScale?.toFixed(3)}`);
await page.locator('button[aria-label="Zoom in"]').click();
await page.locator('button[aria-label="Zoom in"]').click(); // back to 100

// ── 5: Expand — a bigger pane, not a zoom ───────────────────────────────────
await page.locator("button.qz-s3-expandbtn").click();
await page.waitForSelector(".qz-builder-expandhost .qz-devframe", { timeout: 5000 });
await page.waitForTimeout(400);
const expand = await page.evaluate(() => {
  const frame = document.querySelector(".qz-builder-expandhost .qz-devframe");
  if (!frame) return null;
  const m = new DOMMatrix(getComputedStyle(frame).transform);
  return { w: frame.offsetWidth, h: frame.offsetHeight, scale: m.a, tier: frame.dataset.qzTier };
});
ok("expand renders the same fixed frame", !!expand && expand.w === 960 && expand.h === 700, expand ? `${expand.w}×${expand.h}` : "missing");
ok("expand never upscales past 1:1", !!expand && expand.scale <= 1.001, `scale ${expand?.scale?.toFixed(3)}`);
await page.screenshot({ path: `${SHOTS}/03-expand.png` });
await page.keyboard.press("Escape");

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
