// drag/2026-08 live-verify — the builder canvas's RESIZABLE 1:1 viewport
// contract against a LOCAL production build (BASE env, default
// http://localhost:3000). Owner decision 2026-08-13: the preview is a
// browser window, not a scaled device mock.
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — every
// interaction is preset / drag / expand / scroll; no doc commit fires.
//
// Asserts:
//  1. Default is FILL: the frame tracks the pane (minus the handle rails),
//     renders at EXACTLY 1:1 (transform scale(1), contain:paint), and the
//     width readout prints the frame's real width.
//  2. The Desktop preset sets 1280px: the runtime renders qz-bp-desktop,
//     the shell inside is width-capped at 1100 (terminal size), padding-top
//     48, still 1:1 — the pane scrolls horizontally instead of scaling.
//  3. The Phone preset sets 390px: qz-bp-mobile, height capped at the 745
//     phone viewport, page padding 24/24.
//  4. DRAGGING the edge handle resizes symmetrically (2·dx) and crossing
//     the 900 line flips the layout live.
//  5. Double-clicking a handle resets to fill.
//  6. Expand hosts the same viewport at the same width state.
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

// Reads the canvas viewport's full state in one evaluate.
const readState = () =>
  page.evaluate(() => {
    const pane = document.querySelector(".qz-builder-canvas .qz-rsvp");
    const frame = pane?.querySelector(".qz-rsvp-frame");
    const screen = frame?.querySelector(".qz-devscreen");
    const root = screen?.querySelector(".qz-bp-mobile, .qz-bp-desktop");
    const pageEl = root?.querySelector(".qz-runtime-page");
    const shell = pageEl?.querySelector(".qz-runtime-shell");
    const readout = document.querySelector(".qz-bt-zlabel");
    if (!pane || !frame || !screen || !root || !pageEl) return null;
    const cs = getComputedStyle(frame);
    const pcs = getComputedStyle(pageEl);
    return {
      paneW: pane.clientWidth,
      paneH: pane.clientHeight,
      paneScrollW: pane.scrollWidth,
      frameW: frame.offsetWidth,
      frameH: frame.offsetHeight,
      paintedW: frame.getBoundingClientRect().width,
      mode: frame.dataset.qzMode,
      transform: cs.transform,
      contain: cs.contain,
      rootClass: root.className,
      shellW: shell ? shell.offsetWidth : null,
      padTop: pcs.paddingTop,
      padBottom: pcs.paddingBottom,
      scrollTop: screen.scrollTop,
      readout: readout ? readout.textContent : null,
      handles: pane.querySelectorAll(".qz-rsvp-handle").length,
    };
  });

// ── 1: default = fill, 1:1 ──────────────────────────────────────────────────
await page.waitForSelector(".qz-builder-canvas .qz-rsvp-frame", { timeout: 5000 });
await page.waitForTimeout(400);
const fill = await readState();
ok("viewport renders (frame + runtime + readout)", !!fill);
if (fill) {
  ok("fill mode: frame tracks the pane minus the handle rails", Math.abs(fill.frameW - (fill.paneW - 28)) <= 1, `frame ${fill.frameW}, pane ${fill.paneW}`);
  ok("EXACTLY 1:1 — painted width equals layout width", Math.abs(fill.paintedW - fill.frameW) < 0.5, `painted ${fill.paintedW}`);
  ok("frame carries transform scale(1)", fill.transform === "matrix(1, 0, 0, 1, 0, 0)", fill.transform);
  ok("frame contains paint", fill.contain.includes("paint"), fill.contain);
  ok("readout prints the frame's real width", fill.readout === `${fill.frameW}px`, `${fill.readout} vs ${fill.frameW}`);
  ok("mode matches the width's side of the 900 line", fill.mode === (fill.frameW < 900 ? "mobile" : "desktop"), `${fill.frameW}px → ${fill.mode}`);
  ok("runtime breakpoint agrees with the mode", fill.rootClass.includes(`qz-bp-${fill.mode}`), fill.rootClass);
  ok("both edge handles present", fill.handles === 2);
  ok("not pre-scrolled on load", fill.scrollTop === 0);
}
await page.screenshot({ path: `${SHOTS}/01-fill.png` });

// ── 2: the Desktop preset — terminal size, 1:1, horizontal scroll ──────────
await page.locator('button[aria-label^="Desktop"]').first().click();
await page.waitForTimeout(400);
const desk = await readState();
ok("desktop preset applied", !!desk);
if (desk) {
  ok("frame is exactly 1280 wide", desk.frameW === 1280, `${desk.frameW}`);
  ok("still 1:1 (never scaled to fit)", Math.abs(desk.paintedW - 1280) < 0.5, `painted ${desk.paintedW}`);
  ok("readout prints 1280px", desk.readout === "1280px", desk.readout ?? "");
  ok("runtime got the desktop breakpoint", desk.rootClass.includes("qz-bp-desktop"));
  ok("desktop padding-top 48 (shell rule)", desk.padTop === "48px", desk.padTop);
  // The point of 1280: the shell has hit its 1100 cap instead of being
  // squeezed — the merchant designs against the TRUE max size.
  ok("shell is width-capped at 1100 (terminal size)", desk.shellW === 1100, `shell ${desk.shellW}px`);
  ok("pane scrolls horizontally instead of scaling", desk.paneScrollW > desk.paneW, `scrollW ${desk.paneScrollW}, pane ${desk.paneW}`);
  ok("Desktop toggle highlighted", (await page.locator('button[aria-label^="Desktop"]').first().getAttribute("aria-pressed")) === "true");
}
await page.screenshot({ path: `${SHOTS}/02-desktop-preset.png` });

// ── 3: the Phone preset ─────────────────────────────────────────────────────
await page.locator('button[aria-label^="Phone"]').first().click();
await page.waitForTimeout(400);
const phone = await readState();
ok("phone preset applied", !!phone);
if (phone) {
  ok("frame is exactly 390 wide at 1:1", phone.frameW === 390 && Math.abs(phone.paintedW - 390) < 0.5, `${phone.frameW}`);
  ok("runtime got the mobile breakpoint", phone.rootClass.includes("qz-bp-mobile"));
  ok("height caps at the 745 phone viewport", phone.frameH === Math.min(phone.paneH, 745), `frame ${phone.frameH}, pane ${phone.paneH}`);
  ok("page padding 24/24", phone.padTop === "24px" && phone.padBottom === "24px", `${phone.padTop}/${phone.padBottom}`);
  ok("Phone toggle highlighted", (await page.locator('button[aria-label^="Phone"]').first().getAttribute("aria-pressed")) === "true");
}
await page.screenshot({ path: `${SHOTS}/03-phone-preset.png` });

// ── 4: dragging resizes symmetrically and flips the layout at 900 ──────────
const handle = page.locator('.qz-builder-canvas .qz-rsvp-handle[data-side="right"]');
const hb = await handle.boundingBox();
ok("right handle is visible", !!hb);
if (hb) {
  // From the 390 preset, drag +140px → width 390 + 2·140 = 670 (still mobile).
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 140, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  let d = await readState();
  ok("drag grows the width symmetrically (2·dx)", d?.frameW === 670, `${d?.frameW}`);
  ok("still mobile below 900", d?.rootClass.includes("qz-bp-mobile"), `${d?.frameW}px`);

  // Keep dragging past the 900 line → the layout flips to desktop LIVE.
  const hb2 = await handle.boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb2.x + hb2.width / 2 + 160, hb2.y + hb2.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  d = await readState();
  ok("drag crosses 900 → width 990", d?.frameW === 990, `${d?.frameW}`);
  ok("…and the layout flips to desktop LIVE", d?.rootClass.includes("qz-bp-desktop"), d?.rootClass ?? "");
  ok("…and the Desktop toggle follows the drag", (await page.locator('button[aria-label^="Desktop"]').first().getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: `${SHOTS}/04-dragged-990.png` });

  // ── 5: double-click resets to fill ────────────────────────────────────────
  await handle.dblclick();
  await page.waitForTimeout(300);
  d = await readState();
  ok("double-click resets to fill", d != null && Math.abs(d.frameW - (d.paneW - 28)) <= 1, `frame ${d?.frameW}, pane ${d?.paneW}`);
}

// ── 6: Expand hosts the same viewport, same width state ────────────────────
await page.locator('button[aria-label^="Desktop"]').first().click();
await page.waitForTimeout(200);
await page.locator("button.qz-s3-expandbtn").click();
await page.waitForSelector(".qz-builder-expandhost .qz-rsvp-frame", { timeout: 5000 });
await page.waitForTimeout(400);
const expand = await page.evaluate(() => {
  const frame = document.querySelector(".qz-builder-expandhost .qz-rsvp-frame");
  if (!frame) return null;
  return { w: frame.offsetWidth, painted: frame.getBoundingClientRect().width };
});
ok("expand renders the shared width at 1:1", !!expand && expand.w === 1280 && Math.abs(expand.painted - 1280) < 0.5, expand ? `${expand.w}` : "missing");
await page.screenshot({ path: `${SHOTS}/05-expand.png` });
await page.keyboard.press("Escape");

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
