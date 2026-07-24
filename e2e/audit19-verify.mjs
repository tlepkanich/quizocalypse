// AUDIT-19 live-verify — the builder's preview surfaces vs the phone-preview
// SPEC.md primitive (newest-wins) + the build-tab prototype's stagebar Expand,
// against a LOCAL production build (BASE env, default http://localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — every
// interaction is device-toggle / expand / scroll / carousel selection; no doc
// commit fires (Show-as is deliberately NOT clicked: it writes doc.placement),
// so there is nothing to restore.
//
// Asserts:
//  1. Mobile phone = the SPEC primitive: minimal bezel (radius 44, no dark
//     hardware ring), true 390-wide logical viewport, fit-the-pane scale ≤ 1.
//  2. The SCREEN scrolls (overscroll contained) with a bottom fade that shows
//     on overflow and disappears at the end of the scroll.
//  3. Scroll position resets when the previewed step changes.
//  4. Expand: overlay opens (portal scrim), mobile floors at TRUE ≥1:1 scale,
//     Esc closes; desktop Expand fits the ~90% host and ✕ closes.
//  5. Desktop regression: top-anchored width-fit frame + the Show-as control
//     present (§4/§7 stay intact).
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

// ── 1: the mobile primitive ─────────────────────────────────────────────────
await page.locator('button[aria-label="Mobile"]').click();
await page.waitForSelector(".qz-device-fit-mobile", { timeout: 5000 });
await page.waitForTimeout(400);

const frameInfo = await page.evaluate(() => {
  const fit = document.querySelector(".qz-device-fit-mobile");
  const frame = fit?.querySelector(".qz-devframe");
  if (!frame) return null;
  const cs = getComputedStyle(frame);
  const m = (frame.style.transform ?? "").match(/scale\(([\d.]+)\)/);
  return {
    radius: cs.borderRadius,
    bg: cs.backgroundColor,
    logicalW: frame.style.width,
    scale: m ? parseFloat(m[1]) : new DOMMatrix(cs.transform).a,
    overflow: cs.overflow,
  };
});
ok("mobile frame renders", !!frameInfo);
ok("minimal bezel: radius 44", frameInfo?.radius === "44px", frameInfo?.radius);
ok(
  "minimal bezel: no dark hardware ring (paper bg)",
  frameInfo != null && !/32,\s*32,\s*36/.test(frameInfo.bg),
  frameInfo?.bg,
);
ok("true 390 logical viewport", frameInfo?.logicalW === "390px", frameInfo?.logicalW);
ok(
  "fit-the-pane never upscales inline (scale ≤ 1)",
  frameInfo != null && frameInfo.scale > 0.2 && frameInfo.scale <= 1.0001,
  `s=${frameInfo?.scale}`,
);
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

// ── 2 + 3: fade affordance + step-change scroll reset ───────────────────────
// Walk the screen carousel looking for a step whose content overflows 844.
const screenSel = ".qz-builder-canvas .qz-devscreen";
const cards = page.locator(".qz-screens-thumb");
const cardCount = await cards.count();
let overflowFound = false;
for (let i = 0; i < Math.min(cardCount, 8) && !overflowFound; i++) {
  await cards.nth(i).click();
  await page.waitForTimeout(500);
  overflowFound = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && el.scrollHeight > el.clientHeight + 20;
  }, screenSel);
}
if (overflowFound) {
  const fadeSel = ".qz-builder-canvas .qz-devfade";
  const fadeOnTop = await page.evaluate((sel) => {
    const f = document.querySelector(sel);
    return f ? getComputedStyle(f).opacity : null;
  }, fadeSel);
  ok("fade visible while more content is below", fadeOnTop === "1", `opacity=${fadeOnTop}`);
  await page.screenshot({ path: `${SHOTS}/02-fade-visible.png` });
  // scroll to the end → the fade disappears
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = el.scrollHeight;
  }, screenSel);
  await page.waitForTimeout(400);
  const fadeAtEnd = await page.evaluate((sel) => {
    const f = document.querySelector(sel);
    return f ? getComputedStyle(f).opacity : null;
  }, fadeSel);
  ok("fade disappears at the end of the scroll", fadeAtEnd === "0", `opacity=${fadeAtEnd}`);
  await page.screenshot({ path: `${SHOTS}/03-fade-gone-at-end.png` });
  // step change → scrollTop resets to 0
  await cards.nth(0).click();
  await page.waitForTimeout(500);
  const resetTop = await page.evaluate((sel) => document.querySelector(sel)?.scrollTop, screenSel);
  ok("scroll resets when the previewed step changes", resetTop === 0, `scrollTop=${resetTop}`);
} else {
  // No overflowing step in the fixture — the fade must then be HIDDEN…
  const fadeIdle = await page.evaluate(() => {
    const f = document.querySelector(".qz-builder-canvas .qz-devfade");
    return f ? getComputedStyle(f).opacity : null;
  });
  ok("fade hidden when nothing overflows", fadeIdle === "0", `opacity=${fadeIdle} (no overflow step found)`);
  // …then prove the affordance with SYNTHETIC overflow: grow the screen's
  // content (the frame's ResizeObserver re-evaluates), watch the fade appear,
  // scroll to the end → it disappears, and a step change resets the scroll.
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
  const fadeSyn = await page.evaluate(() => {
    const f = document.querySelector(".qz-builder-canvas .qz-devfade");
    return f ? getComputedStyle(f).opacity : null;
  });
  ok("fade appears when content overflows (synthetic)", fadeSyn === "1", `opacity=${fadeSyn}`);
  await page.screenshot({ path: `${SHOTS}/02-fade-visible.png` });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = el.scrollHeight;
  }, screenSel);
  await page.waitForTimeout(400);
  const fadeSynEnd = await page.evaluate(() => {
    const f = document.querySelector(".qz-builder-canvas .qz-devfade");
    return f ? getComputedStyle(f).opacity : null;
  });
  ok("fade disappears at the end of the scroll", fadeSynEnd === "0", `opacity=${fadeSynEnd}`);
  await page.screenshot({ path: `${SHOTS}/03-fade-gone-at-end.png` });
  // step change → scrollTop resets to 0 (click a DIFFERENT screen thumb)
  if (cardCount > 1) {
    await cards.nth(1).click();
    await page.waitForTimeout(500);
    const resetTop = await page.evaluate((sel) => document.querySelector(sel)?.scrollTop, screenSel);
    ok("scroll resets when the previewed step changes", resetTop === 0, `scrollTop=${resetTop}`);
  }
  await page.evaluate(() => document.getElementById("a19-filler")?.remove());
}

// ── 4a: Expand (mobile) ─────────────────────────────────────────────────────
const expandBtn = page.locator(".qz-s3-expandbtn", { hasText: "Expand" });
ok("Expand control in the top bar", (await expandBtn.count()) === 1);
await expandBtn.click();
await page.waitForSelector(".qz-s3-phscrim", { timeout: 5000 });
await page.waitForTimeout(500);
ok("Expand overlay opens", await page.locator(".qz-s3-phscrim").isVisible());
const exScale = await page.evaluate(() => {
  const fit = document.querySelector(".qz-builder-expandhost .qz-device-fit-mobile");
  const frame = fit?.querySelector(".qz-devframe");
  if (!frame) return null;
  const m = (frame.style.transform ?? "").match(/scale\(([\d.]+)\)/);
  return m ? parseFloat(m[1]) : null;
});
ok("Expand floors mobile at TRUE ≥1:1", exScale != null && exScale >= 1, `s=${exScale}`);
await page.screenshot({ path: `${SHOTS}/04-expand-mobile.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("Esc closes the Expand overlay", (await page.locator(".qz-s3-phscrim").count()) === 0);

// ── 4b + 5: desktop — Show-as intact, top-anchored width-fit, Expand ────────
await page.locator('button[aria-label="Desktop"]').click();
await page.waitForSelector(".qz-device-fit-desktop", { timeout: 5000 });
await page.waitForTimeout(500);
ok(
  "Show-as placement control present on desktop",
  (await page.locator('[aria-label="Show as"]').count()) === 1,
);
const deskAlign = await page.evaluate(() => {
  const fit = document.querySelector(".qz-device-fit-desktop");
  return fit ? getComputedStyle(fit).alignItems : null;
});
ok("desktop stage is top-anchored", deskAlign === "flex-start", deskAlign);
await page.screenshot({ path: `${SHOTS}/05-desktop.png` });

await expandBtn.click();
await page.waitForSelector(".qz-s3-phscrim", { timeout: 5000 });
await page.waitForTimeout(500);
const deskEx = await page.evaluate(() => {
  const host = document.querySelector(".qz-builder-expandhost");
  const fit = host?.querySelector(".qz-device-fit-desktop");
  const frame = fit?.querySelector(".qz-canvas-card");
  if (!host || !frame) return null;
  const m = (frame.style.transform ?? "").match(/scale\(([\d.]+)\)/);
  const s = m ? parseFloat(m[1]) : null;
  const fw = parseFloat(frame.style.width);
  return { s, fitsW: fw * (s ?? 0) <= host.clientWidth + 2, fitsH: 760 * (s ?? 0) <= host.clientHeight + 40 };
});
ok("desktop Expand fits the overlay host", !!deskEx && deskEx.s != null && deskEx.fitsW, JSON.stringify(deskEx));
await page.screenshot({ path: `${SHOTS}/06-expand-desktop.png` });
await page.locator(".qz-s3-phclose").click();
await page.waitForTimeout(300);
ok("✕ closes the Expand overlay", (await page.locator(".qz-s3-phscrim").count()) === 0);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" · "));

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
