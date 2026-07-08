// QZY-R5b live-verify — the answer-display corrections (build-tab v2.0 §3.1/§3.3)
// against a LOCAL production build (BASE, default localhost:3000).
//
// Fixture: draft cmr7khgd5… (decider, single_select Q1). NET-ZERO — it selects a
// layout mode and toggles "show media", then resets both so answer_display drops.
// Verifies the BUILDER controls; runtime byte-safety is by construction (new
// fields gated on presence; legacy docs never mount AnswerOptions) + the schema
// round-trip test + the runtime smoke.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qzy-r5b-shots";
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
await page.locator(".qz-screens-item", { hasText: "Q1" }).first().locator(".qz-screens-thumb").click();
await page.waitForTimeout(600);

const modes = page.locator(".qz-ads-modes button");
// §3.1 — Icon is retired as a layout mode → four structural modes.
ok("mode picker has FOUR structural modes (no 'Icon' mode)",
  (await modes.count()) === 4 &&
    (await page.locator(".qz-ads-modes button", { hasText: "Icon + text" }).count()) === 0);

// Enter an inline mode (pills) to reveal the media toggle + alignment.
await page.locator(".qz-ads-modes button", { hasText: "Compact pills" }).click();
await page.waitForTimeout(400);
ok("independent 'Show icon / image' toggle present (§3.1)",
  (await page.getByText("Show icon / image on each option").count()) >= 1);
ok("content-alignment control present (§3.1)",
  (await page.locator('[aria-label="Content alignment"] button').count()) === 3);

// Turn media on → the media controls appear (image size + icon position L/T/R).
await page.locator("label", { hasText: "Show icon / image on each option" }).locator("input[type=checkbox]").check();
await page.waitForTimeout(300);
ok("image-size control appears with media on (§3.3 — separate from label size)",
  (await page.locator(".qz-ads", { hasText: "Image size" }).count()) >= 1);
ok("icon position offers Left / Above / Right (§3.1)",
  (await page.locator('[aria-label="Icon position"] button').count()) === 3 &&
    (await page.locator('[aria-label="Icon position"] button', { hasText: "Right" }).count()) === 1);

await page.locator(".qz-ads").screenshot({ path: `${SHOTS}/answer-display.png` }).catch(() => {});

// ── net-zero: uncheck media, back to Text list → answer_display drops ────────
await page.locator("label", { hasText: "Show icon / image on each option" }).locator("input[type=checkbox]").uncheck();
await page.waitForTimeout(200);
await page.locator(".qz-ads-modes button", { hasText: "Text list" }).click();
await page.waitForTimeout(300);
ok("reset to Text list (net-zero — controls collapse)",
  (await page.locator('[aria-label="Content alignment"] button').count()) === 0);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
