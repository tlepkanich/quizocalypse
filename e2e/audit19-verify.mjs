// AUDIT-19 live-verify — the builder's preview surfaces vs the phone-preview
// SPEC.md primitive (newest-wins) + the build-tab prototype's stagebar Expand,
// against a LOCAL production build (BASE env, default http://localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — every
// interaction is device-toggle / expand / scroll / carousel selection; no doc
// commit fires (Show-as is deliberately NOT clicked: it writes doc.placement),
// so there is nothing to restore.
//
// Ported 2026-08-14 to drag/2026-08 (ResizableViewport, owner 2026-08-13):
// the builder canvas is a RESIZABLE 1:1 browser viewport — the scaled fixed
// DeviceFrame (VIEWPORT 2026-08 + QRTZ-S3) now serves the funnel surfaces
// only. Phone/Desktop are WIDTH PRESETS (390 / 1280) and the frame ALWAYS
// renders transform scale(1). Assertions that pinned the scaled-device
// contract (fade affordance, 46/20px phone radius, fit scale ≤ 1,
// top-anchored stage, .qz-canvas-card Expand) were updated or deleted with
// dated notes in place.
//
// Asserts:
//  1. Phone preset = a true 390px browser viewport at EXACTLY 1:1, with the
//     neutral browser-window skin (--qz-radius, paper bg, no dark hardware
//     ring), mobile mode, and a scrolling screen (overscroll contained).
//  2. The SCREEN scrolls on overflow.
//  3. Scroll position resets when the previewed step changes.
//  4. Expand: overlay opens (portal scrim), hosts the SAME width state at
//     1:1, Esc closes; desktop Expand shows the shared 1280 and ✕ closes.
//  5. Desktop preset regression: centred pane + the Show-as control present
//     (§4/§7 stay intact).
// Screenshots land in /tmp/bt-shots/.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/bt-shots";

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

// ── 1: the Phone preset (drag/2026-08 — a 390px browser window at 1:1) ──────
await page.locator('button[aria-label^="Phone"]').first().click();
await page.waitForSelector(".qz-device-fit-mobile", { timeout: 5000 });
await page.waitForTimeout(400);

const frameInfo = await page.evaluate(() => {
  const fit = document.querySelector(".qz-device-fit-mobile");
  const frame = fit?.querySelector(".qz-rsvp-frame");
  if (!frame) return null;
  const cs = getComputedStyle(frame);
  return {
    radius: cs.borderRadius,
    rootRadius: getComputedStyle(document.documentElement).getPropertyValue("--qz-radius").trim(),
    bg: cs.backgroundColor,
    logicalW: frame.offsetWidth,
    paintedW: frame.getBoundingClientRect().width,
    transform: cs.transform,
    overflow: cs.overflow,
    mode: frame.dataset.qzMode,
  };
});
ok("phone-preset frame renders", !!frameInfo);
// drag/2026-08: the 46px BLD-3 bezel and the 20px --qz-phone-r screen
// (QRTZ-S3) are both RETIRED on this surface (2026-08-14) — the frame is a
// neutral browser window with the one --qz-radius skin in both modes.
ok(
  "neutral browser-window skin (--qz-radius)",
  frameInfo != null && frameInfo.radius === frameInfo.rootRadius,
  `${frameInfo?.radius} vs var ${frameInfo?.rootRadius}`,
);
ok(
  "no dark hardware ring (paper bg)",
  frameInfo != null && !/32,\s*32,\s*36/.test(frameInfo.bg),
  frameInfo?.bg,
);
ok("true 390 browser viewport (preset width)", frameInfo?.logicalW === 390, `${frameInfo?.logicalW}`);
// The scaled-frame "never upscales (scale ≤ 1)" rule is retired: the frame
// is ALWAYS exactly 1:1 now (A2 keeps a literal scale(1) transform).
ok(
  "EXACTLY 1:1 — scale(1), painted width = layout width",
  frameInfo != null &&
    frameInfo.transform === "matrix(1, 0, 0, 1, 0, 0)" &&
    Math.abs(frameInfo.paintedW - 390) < 0.5,
  `${frameInfo?.transform} painted=${frameInfo?.paintedW}`,
);
ok("mobile mode below the 900 line", frameInfo?.mode === "mobile", frameInfo?.mode);
ok("frame clips its corners (overflow hidden)", frameInfo?.overflow === "hidden");

const screenInfo = await page.evaluate(() => {
  const fit = document.querySelector(".qz-device-fit-mobile");
  const screen = fit?.querySelector(".qz-devscreen");
  if (!screen) return null;
  const cs = getComputedStyle(screen);
  return {
    overflowY: cs.overflowY,
    overscroll: cs.overscrollBehaviorY || cs.overscrollBehavior,
  };
});
ok("the SCREEN scrolls (overflow-y auto)", screenInfo?.overflowY === "auto", screenInfo?.overflowY);
ok("overscroll contained", /contain/.test(screenInfo?.overscroll ?? ""), screenInfo?.overscroll);
await page.screenshot({ path: `${SHOTS}/01-mobile-primitive.png` });

// ── 2 + 3: screen scroll + step-change scroll reset ─────────────────────────
// QRTZ-S3 (91b7c54): the bottom fade affordance (.qz-devfade) was REMOVED —
// the phone is a borderless solid screen, no fade. The three fade assertions
// that lived here were deleted 2026-08-14. What remains real: the screen
// scrolls, and DeviceFrame resets scrollTop when the previewed step changes
// (the resetKey effect).
// Walk the Flow rows looking for a step whose content overflows the 745
// screen; if none, synthesize overflow so the reset is still proven.
const screenSel = ".qz-builder-canvas .qz-devscreen";
// QRTZ-H4 — the Flow tab's rows replaced the filmstrip as the switcher.
const cards = page.locator(".qz-ftree-row");
const cardCount = await cards.count();
let overflowFound = false;
let currentRow = -1;
for (let i = 0; i < Math.min(cardCount, 8) && !overflowFound; i++) {
  await cards.nth(i).click();
  await page.waitForTimeout(500);
  currentRow = i;
  overflowFound = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && el.scrollHeight > el.clientHeight + 20;
  }, screenSel);
}
if (!overflowFound) {
  // SYNTHETIC overflow: grow the screen's content past the 745 viewport.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const content = el?.firstElementChild;
    if (!content) return;
    const filler = document.createElement("div");
    filler.id = "a19-filler";
    filler.style.height = "1200px";
    content.appendChild(filler);
  }, screenSel);
  await page.waitForTimeout(400);
}
await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (el) el.scrollTop = el.scrollHeight;
}, screenSel);
await page.waitForTimeout(300);
const scrolledTop = await page.evaluate((sel) => document.querySelector(sel)?.scrollTop, screenSel);
ok(
  `screen scrolls on overflow${overflowFound ? "" : " (synthetic)"}`,
  (scrolledTop ?? 0) > 0,
  `scrollTop=${scrolledTop}`,
);
await page.screenshot({ path: `${SHOTS}/02-scrolled.png` });
// step change → scrollTop resets to 0 (click a DIFFERENT Flow row)
if (cardCount > 1) {
  await cards.nth((currentRow + 1) % cardCount).click();
  await page.waitForTimeout(500);
  const resetTop = await page.evaluate((sel) => document.querySelector(sel)?.scrollTop, screenSel);
  ok("scroll resets when the previewed step changes", resetTop === 0, `scrollTop=${resetTop}`);
}
await page.evaluate(() => document.getElementById("a19-filler")?.remove());

// ── 4a: Expand (mobile) ─────────────────────────────────────────────────────
const expandBtn = page.locator(".qz-s3-expandbtn", { hasText: "Expand" });
// FIX-2 — Expand moved from the top bar onto the build-tab stagebar.
ok("Expand control on the stagebar", (await expandBtn.count()) === 1);
await expandBtn.click();
await page.waitForSelector(".qz-s3-phscrim", { timeout: 5000 });
await page.waitForTimeout(500);
ok("Expand overlay opens", await page.locator(".qz-s3-phscrim").isVisible());
// drag/2026-08: "Expand floors mobile at ≥1:1" is retired (2026-08-14) —
// the overlay hosts the SAME resizable viewport at the same width state,
// and the frame is always exactly 1:1.
const exPhone = await page.evaluate(() => {
  const frame = document.querySelector(".qz-builder-expandhost .qz-rsvp-frame");
  if (!frame) return null;
  return { w: frame.offsetWidth, painted: frame.getBoundingClientRect().width };
});
ok(
  "Expand hosts the shared 390 width at 1:1",
  !!exPhone && exPhone.w === 390 && Math.abs(exPhone.painted - 390) < 0.5,
  JSON.stringify(exPhone),
);
await page.screenshot({ path: `${SHOTS}/04-expand-mobile.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("Esc closes the Expand overlay", (await page.locator(".qz-s3-phscrim").count()) === 0);

// ── 4b + 5: desktop preset — Show-as intact, centred pane, Expand ───────────
await page.locator('button[aria-label^="Desktop"]').first().click();
await page.waitForSelector(".qz-device-fit-desktop", { timeout: 5000 });
await page.waitForTimeout(500);
ok(
  "Show-as placement control present on desktop",
  (await page.locator('[aria-label="Show as"]').count()) === 1,
);
// The old top-anchored width-fit stage is gone (updated 2026-08-14): the
// pane centres the frame row (margin:auto keeps both edges reachable when
// the 1280 preset is wider than the pane — it scrolls, never scales).
const deskAlign = await page.evaluate(() => {
  const fit = document.querySelector(".qz-device-fit-desktop");
  return fit ? getComputedStyle(fit).alignItems : null;
});
ok("desktop stage centres the frame (drag/2026-08)", deskAlign === "center", deskAlign);
await page.screenshot({ path: `${SHOTS}/05-desktop.png` });

await expandBtn.click();
await page.waitForSelector(".qz-s3-phscrim", { timeout: 5000 });
await page.waitForTimeout(500);
// drag/2026-08: "fits the overlay host" (the fit rule) is retired
// (2026-08-14) — the overlay hosts the shared width state at 1:1; a
// too-narrow host scrolls instead of scaling.
const deskEx = await page.evaluate(() => {
  const frame = document.querySelector(".qz-builder-expandhost .qz-rsvp-frame");
  if (!frame) return null;
  return { w: frame.offsetWidth, painted: frame.getBoundingClientRect().width };
});
ok(
  "desktop Expand shows the shared 1280 preset at 1:1",
  !!deskEx && deskEx.w === 1280 && Math.abs(deskEx.painted - 1280) < 0.5,
  JSON.stringify(deskEx),
);
await page.screenshot({ path: `${SHOTS}/06-expand-desktop.png` });
await page.locator(".qz-s3-phclose").click();
await page.waitForTimeout(300);
ok("✕ closes the Expand overlay", (await page.locator(".qz-s3-phscrim").count()) === 0);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" · "));

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
