// QZY-R7-3 live-verify — the Next/primary button gets its OWN size + radius
// (build-tab §7.2). LOCAL prod build. NET-ZERO (Reset clears both tokens back
// to undefined; waits past the 700ms autosave debounce before asserting).
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
if (!KEY) { console.error("no token"); process.exit(1); }
let failures = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).split("\n")[0]));
await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 20000 });
await page.waitForTimeout(1600);

// Open the Design rail — the BuilderDesignPanel with the shape/button controls.
await page.locator(".qz-builder-rail button", { hasText: "Design" }).click();
await page.waitForTimeout(500);

// §7.2 — the Next-button size + radius scrubbers exist alongside the shape row.
const sizeSlider = page.locator('input[aria-label="Next button size"]');
const radiusSlider = page.locator('input[aria-label="Next button radius"]');
ok("Design panel exposes a Next-button size scrubber (§7.2)", (await sizeSlider.count()) === 1);
ok("Design panel exposes a Next-button radius scrubber (§7.2)", (await radiusSlider.count()) === 1);

// Default reads "auto"/"theme" (tokens unset → byte-safe).
const beforeR = await page.locator("text=theme").first().count().catch(() => 0);
ok("radius starts at the theme default (token unset)", beforeR >= 1);

// Drag the radius to 24px + size to 1.20×.
await radiusSlider.fill("24");
await sizeSlider.fill("1.2");
await page.waitForTimeout(300);
ok("radius label reflects the scrub (24px)",
  (await page.locator("text=24px").count()) >= 1);
ok("size label reflects the scrub (1.20×)",
  (await page.locator("text=1.20×").count()) >= 1);

// Autosave the whole doc, then reload and re-open Design → the values persist.
await page.waitForTimeout(1100);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".qz-builder", { timeout: 20000 });
await page.waitForTimeout(1400);
await page.locator(".qz-builder-rail button", { hasText: "Design" }).click();
await page.waitForTimeout(500);
ok("button radius persisted across reload (24px)",
  (await page.locator("text=24px").count()) >= 1);
ok("button size persisted across reload (1.20×)",
  (await page.locator("text=1.20×").count()) >= 1);
ok("the persisted radius slider carries the value",
  (await page.locator('input[aria-label="Next button radius"]').inputValue()) === "24");

// The runtime honours it: the intro's primary button renders border-radius 24px.
await page.locator(".qz-screens-item").first().locator(".qz-screens-thumb").click().catch(() => {});
await page.waitForTimeout(700);
const btnRadii = await page.locator(".qz-builder-canvas button").evaluateAll((els) =>
  els.map((el) => getComputedStyle(el).borderTopLeftRadius));
ok("a canvas primary button renders 24px radius",
  btnRadii.includes("24px"), btnRadii.slice(0, 6).join(", "));

// ── net-zero — Reset clears both tokens (doc back to theme-only, byte-safe) ──
await page.locator(".qz-builder-rail button", { hasText: "Design" }).click();
await page.waitForTimeout(400);
await page.locator("button", { hasText: "Reset button size to theme" }).click();
await page.waitForTimeout(1100);
ok("net-zero: radius reset to theme",
  (await page.locator("text=theme").first().count()) >= 1 &&
    (await page.locator("text=24px").count()) === 0);
ok("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
