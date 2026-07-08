// QZY-R4 live-verify — the ONE shared MediaPicker + real (base64) image upload
// (build-tab v2.0 §8) against a LOCAL production build (BASE, default
// localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). NET-ZERO — sets the
// screen background to "Image" to surface the shared picker, then clears to
// None. Verifies the picker's sources (Upload + URL), the base64 file input,
// and the large-file guidance. (The SAME MediaPicker is wired into per-option
// media in the inspector; that path is exercised by builderv3-verify once the
// fixture's choice Q1 is restored.)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qzy-r4-shots";

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
await page.waitForSelector(".qz-builder", { timeout: 20000 });
await page.waitForTimeout(1600);

// Select a screen, open the left Background panel, choose the Image type.
const q1 = page.locator(".qz-screens-item", { hasText: "Q1" }).first();
await q1.locator(".qz-screens-thumb").click();
await page.waitForTimeout(500);
await page.locator('[aria-label="Build panel"] button', { hasText: "Background" }).click();
await page.waitForTimeout(400);
await page.locator('[aria-label="Background type"] button', { hasText: "Image" }).click();
await page.waitForTimeout(400);

// ── §8 — the shared picker with Upload + URL sources ────────────────────────
const picker = page.locator('[aria-label="Media source"]');
ok("shared MediaPicker present with a source switcher (§8)", (await picker.count()) === 1);
ok("Upload source present (real base64 upload)",
  (await picker.locator("button", { hasText: "Upload" }).count()) === 1);
ok("URL source present",
  (await picker.locator("button", { hasText: "URL" }).count()) === 1);

// Upload tab is the default → a real file input scoped to images.
const fileInput = page.locator('.qz-builder-panel input[type="file"]');
ok("Upload exposes a real <input type=file> accepting images",
  (await fileInput.count()) === 1 &&
    /image|\.png|\.jpg/.test((await fileInput.first().getAttribute("accept")) ?? ""));
ok("doc-bloat guidance shown (keep images small / 2 MB cap)",
  (await page.locator(".qz-builder-panel", { hasText: "Max 2 MB" }).count()) >= 1);

// URL source still accepts a pasted https asset.
await picker.locator("button", { hasText: "URL" }).click();
await page.waitForTimeout(250);
ok("URL source offers a paste field",
  (await page.locator('.qz-builder-panel input[placeholder="https://…"]').count()) >= 1);

await page.locator(".qz-builder-panel").screenshot({ path: `${SHOTS}/media-picker.png` }).catch(() => {});

// ── net-zero cleanup ────────────────────────────────────────────────────────
await page.locator('[aria-label="Background type"] button', { hasText: "None" }).click();
await page.waitForTimeout(400);
ok("cleared back to None (net-zero)",
  (await page.locator('[aria-label="Background type"] button[aria-pressed=true]', { hasText: "None" }).count()) === 1);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
