// QZY-R3 live-verify — the master/override model + Custom badge + toast
// (build-tab v2.0 §5.3/§9) against a LOCAL production build (BASE, default
// localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). NET-ZERO — it sets a
// screen background to raise the Custom badge + apply-all affordance, then
// clears it back to None. The apply-all RESOLUTION is unit-tested
// (applyBackgroundToAll, screenBackground.test.ts); this probe verifies the
// UI wiring: scope control, Custom badge, toast provider, master surface.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qzy-r3-shots";

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

// Select a question screen, then open the left Background panel tab.
const q1 = page.locator(".qz-screens-item", { hasText: "Q1" }).first();
await q1.locator(".qz-screens-thumb").click();
await page.waitForTimeout(500);
await page.locator('[aria-label="Build panel"] button', { hasText: "Background" }).click();
await page.waitForTimeout(400);

// ── §5.3 — the scope control exists ─────────────────────────────────────────
const scope = page.locator('[aria-label="Background applies to"]');
ok("scope control 'This screen / All screens' present (§5.3)",
  (await scope.count()) === 1 &&
    (await scope.locator("button", { hasText: "This screen" }).count()) === 1 &&
    (await scope.locator("button", { hasText: "All screens" }).count()) === 1);

// ── set a background on THIS screen → Custom badge + apply-all appear ────────
await page.locator('[aria-label="Background type"] button', { hasText: "Color" }).click();
await page.waitForTimeout(500);
ok("setting a background raises the carousel Custom badge (§5.3)",
  (await page.locator('.qz-screens-item.is-active [aria-label="Custom background"]').count()) === 1);
ok("'Apply to all screens…' affordance appears with a background set",
  (await page.locator(".qz-builder-panel button", { hasText: "Apply to all screens" }).count()) === 1);

// ── switch to All-screens with a custom screen → toast + master surface ─────
await scope.locator("button", { hasText: "All screens" }).click();
await page.waitForTimeout(400);
ok("toast provider is wired (a toast renders on the scope switch)",
  (await page.locator(".qz-toast").count()) >= 1);
ok("All-screens scope surfaces the quiz-wide default + the 'won't change' count",
  (await page.locator(".qz-builder-panel [role=note]").count()) >= 1);

// ── net-zero cleanup: back to This screen, clear to None ────────────────────
await scope.locator("button", { hasText: "This screen" }).click();
await page.waitForTimeout(300);
await page.locator('[aria-label="Background type"] button', { hasText: "None" }).click();
await page.waitForTimeout(500);
ok("clearing to None removes the Custom badge (net-zero)",
  (await page.locator('.qz-screens-item.is-active [aria-label="Custom background"]').count()) === 0);

await page.locator(".qz-builder-panel").screenshot({ path: `${SHOTS}/background-scope.png` }).catch(() => {});
ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
