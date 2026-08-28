// RETIRED (logic-step live-exact rebuild, 2026-08-28, commit b8cf66f): this
// probe asserts the two-card Rules/Questions table structure that the Live-
// pane workspace (rail + one-question detail panel) replaced. Kept per the
// conservative-deletion culture; the canonical suite is q3-questions-verify.
console.log("RETIRED probe — superseded by the logic-step Live rebuild (see e2e/q3-questions-verify.mjs). Exiting 0.");
process.exit(0);

// Logic tab P6 live-verify — the §7 explainer sheets + the §4.5 server-side
// impact line, against a LOCAL production build. Fixture:
// cmr7khgd50001vkhscvox8dgt. Read-only (the modal is cancelled, never created).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-tab-p6-shots";

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
await page.waitForTimeout(1200);
await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
const card = page.locator('[data-testid="logic-tab-card"]');

// ── explainers (§7) ─────────────────────────────────────────────────────────
// QRTZ-H3 — per-card labels (mock shared.mjs 357/375); the shared-label
// equal-width ruling is overruled by the owner's exact-match order.
ok("the two ✦ explain buttons carry the mock's per-card labels",
  (await card.locator(".qz-ltab-how").count()) === 2 &&
  /How rules work/.test(await card.locator(".qz-ltab-how").first().innerText()) &&
  /How questions work/.test(await card.locator(".qz-ltab-how").nth(1).innerText()));
await card.locator(".qz-ltab-how").first().click();
const sheet = page.locator(".qz-xpl");
ok("rules explainer opens", (await sheet.count()) === 1);
ok("four-step progress", (await sheet.locator(".qz-xpl-dot").count()) === 4);
ok("step 1: One sentence, three parts",
  /One sentence, three parts/.test(await sheet.locator("h3").innerText()));
await sheet.locator(".qz-xpl-ft-btns button", { hasText: "Next" }).click();
const step2 = await sheet.locator(".qz-xpl-body").innerText();
ok("step 2 teaches STRICT first-match-wins (corrected copy)",
  /first rule that matches applies/i.test(step2) && !/always apply/i.test(step2),
  step2.slice(0, 90));
ok("done step shows ✓", (await sheet.locator(".qz-xpl-dot.is-done").count()) === 1);
await page.screenshot({ path: `${SHOTS}/explainer-rules-step2.png` });
// Jump to the closing step and cross-link across.
await sheet.locator(".qz-xpl-dot").nth(3).click();
await sheet.locator(".qz-xpl-cross").click();
ok("cross-link swaps to the questions explainer at step 1",
  /How questions work/.test(await sheet.locator("h2").innerText()) &&
  /One question, three parts/.test(await sheet.locator("h3").innerText()));
await sheet.locator(".qz-xpl-dot").nth(3).click();
const bothTogether = await sheet.locator(".qz-xpl-body").innerText();
ok("'Both together' teaches Show-replaces-the-starting-set (corrected)",
  /replaces the starting\s*set/i.test(bothTogether.replace(/\n/g, " ")), bothTogether.slice(0, 120));
await sheet.locator(".qz-xpl-ft-btns button", { hasText: "Done" }).click();
ok("Done closes the sheet", (await sheet.count()) === 0);

// ── impact line (§4.5/G10) ──────────────────────────────────────────────────
await card.locator(".qz-ltab-create").click();
const modal = page.locator(".qz-crm");
await modal.locator(".qz-crm-qblock").first().locator(".qz-crm-chip").first().click();
await page.waitForTimeout(1600); // debounce + server round-trip
const impact = await modal.locator(".qz-crm-impact").innerText().catch(() => "");
ok("impact line renders a real path count",
  /Fires on \d+ of \d+ paths|% of shoppers \(sampled\)/.test(impact), impact);
await page.screenshot({ path: `${SHOTS}/impact-line.png` });
await modal.locator("footer button", { hasText: "Cancel" }).click();
ok("Cancel closes without creating", (await modal.count()) === 0);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
