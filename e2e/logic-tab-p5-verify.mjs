// Logic tab P5 live-verify — the create-a-rule modal (§4) end-to-end against
// a LOCAL production build + local DB. Fixture: cmr7khgd50001vkhscvox8dgt.
//
// Exercises the REAL create path including /api/categories/ensure-targets
// (a picked tag materializes a quiz-scoped Category row — idempotent, reused
// on re-runs). The created RULE is deleted at the end (doc restored); the
// materialized category row stays (harmless, additive, local DB).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-tab-p5-shots";

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

const openLogic = async () => {
  await page.waitForSelector(".qz-builder", { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
  await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
};

await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await openLogic();
const card = page.locator('[data-testid="logic-tab-card"]');
const rulesBefore = await card.locator(".qz-ltab-rrow").count();

// ── open the modal ──────────────────────────────────────────────────────────
await card.locator(".qz-ltab-create").click();
const modal = page.locator(".qz-crm");
ok("modal opens (three columns)", (await modal.locator(".qz-crm-col").count()) === 3);
ok("Create disabled until conditions + targets",
  (await modal.locator("header button:disabled", { hasText: "Create rule" }).count()) === 1);
ok("Exclude is the blank-draft default (§4.2)",
  (await modal.locator(".qz-crm-verb.is-on", { hasText: "Exclude" }).count()) === 1);
ok("every question is listed, Asked-only included (§4.1)",
  (await modal.locator(".qz-crm-qblock").count()) >= 2);

// ── conditions: single-select replace semantics (DECISIONS G3) ──────────────
const q1chips = modal.locator(".qz-crm-qblock").first().locator(".qz-crm-chip");
await q1chips.nth(0).click();
ok("picked count 1", /1 picked/.test(await modal.locator(".qz-crm-count").first().innerText()));
await q1chips.nth(1).click();
ok("second chip on a single-select REPLACES (still 1 picked)",
  /1 picked/.test(await modal.locator(".qz-crm-count").first().innerText()));
ok("used block is highlighted", (await modal.locator(".qz-crm-qblock.is-used").count()) === 1);

// ── verb: Show ──────────────────────────────────────────────────────────────
await modal.locator(".qz-crm-verb", { hasText: "Show" }).click();
ok("Show selected", (await modal.locator(".qz-crm-verb.is-on", { hasText: "Show" }).count()) === 1);

// ── target: pick a TAG (exercises ensure-targets) ───────────────────────────
ok("nothing typed + All → 'This quiz already recommends' (§4.3)",
  (await modal.locator(".qz-ltab-menu-group", { hasText: "already recommends" }).count()) === 1);
await modal.locator(".qz-ltab-menu-chip", { hasText: "Tags" }).click();
const firstTag = modal.locator(".qz-crm-res").first();
const tagName = (await firstTag.locator(".qz-crm-resname").innerText()).trim();
await firstTag.click();
ok("tray appears with the picked tag ✕-chip",
  (await modal.locator(".qz-crm-traychip").count()) === 1);
ok("live-target tray notes catalogue tracking (§4.4)",
  /updates as the catalogue changes/.test(await modal.locator(".qz-crm-traymeta").innerText()));
const sentence = await modal.locator(".qz-crm-sentence").innerText();
ok("footer sentence is live (§4.5)", /When a shopper picks .+ show/.test(sentence.replace(/\n/g, " ")), sentence.slice(0, 90));

// ── §4.5: scrim must NOT discard; Esc closes ────────────────────────────────
await page.mouse.click(10, 10);
ok("scrim click does NOT discard the draft", (await modal.count()) === 1);
await page.screenshot({ path: `${SHOTS}/create-rule-modal.png` });

// ── create ──────────────────────────────────────────────────────────────────
await modal.locator("header button", { hasText: "Create rule" }).click();
await page.waitForTimeout(1200); // ensure-targets POST + commit + debounce
ok("modal closes on create", (await modal.count()) === 0);
const rowsAfter = await card.locator(".qz-ltab-rrow").count();
ok("a rule row appeared", rowsAfter === rulesBefore + 1, `${rulesBefore} → ${rowsAfter}`);
const newRow = card.locator(".qz-ltab-rrow").last();
const rowText = (await newRow.innerText()).replace(/\n/g, " ");
ok("row is the §3.3 sentence with the tag target",
  /When they pick/.test(rowText) && rowText.toLowerCase().includes(tagName.toLowerCase().slice(0, 8)),
  rowText.slice(0, 100));
ok("verb wired per G4: UI Show → replace sentence verb 'show'", / show /.test(rowText));
await page.screenshot({ path: `${SHOTS}/rule-created.png` });

// ── persistence + restore (delete via ✕, P4) ────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await openLogic();
ok("rule persisted through autosave", (await card.locator(".qz-ltab-rrow").count()) === rulesBefore + 1);
const delRow = card.locator(".qz-ltab-rrow").last();
await delRow.hover();
// QRTZ-H3 — delete is the mock's hover-revealed × icon button.
await delRow.locator(".qz-ltab-ricon").click();
await page.waitForTimeout(1000);
ok("✕ deletes the rule", (await card.locator(".qz-ltab-rrow").count()) === rulesBefore ||
  (rulesBefore === 0 && (await card.locator(".qz-ltab-empty").count()) === 1));
await page.reload({ waitUntil: "domcontentloaded" });
await openLogic();
ok("deletion persisted (doc restored)",
  (await card.locator(".qz-ltab-rrow").count()) === rulesBefore ||
  (rulesBefore === 0 && (await card.locator(".qz-ltab-empty").count()) === 1));

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
