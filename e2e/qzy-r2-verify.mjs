// QZY-R2 live-verify — the "misbuilt" inspector correction (build-tab v2.0
// §1/§2/§10) against a LOCAL production build (BASE, default localhost:3000).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (decider). READ-ONLY — selection +
// one rail navigation only; no doc commit fires.
//
// Asserts the decider Build inspector is DESIGN-ONLY: no Content/Design/Routing
// tab bar, no inline logic UI (role dropdown / Maps-to / mapping rows), no
// page-background control on the right, and a single one-line "Open Logic →"
// pointer — while the design surface (content, style, layout blocks, custom
// CSS) and the footer stay. Then proves logic authoring RELOCATED (not lost):
// the pointer lands in the Logic view's map. Independent of the question's
// type, so it does not depend on the fixture's Q1 being a choice question.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qzy-r2-shots";

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

// Select the first question screen.
const q1 = page.locator(".qz-screens-item", { hasText: "Q1" }).first();
await q1.locator(".qz-screens-thumb").click();
await page.waitForTimeout(700);

const insp = page.locator(".qz-builder-inspector");
ok("inspector present for the selected question", (await insp.count()) === 1);

// ── §1/§10 — NO tabs, NO logic, NO page background on the right ──────────────
ok("no Content/Design/Routing tab bar (§1)",
  (await insp.locator('.qz-segmented[aria-label="Panel tab"]').count()) === 0);
ok("no inline gold Logic section (§1 — removed)",
  (await insp.locator(".qz-insp-logic").count()) === 0);
ok("no role dropdown in the inspector (§1)",
  (await insp.locator(".qz-insp-logic-role").count()) === 0);
ok("no 'Maps to' result-mapping control (§1)",
  (await insp.getByText("Maps to", { exact: false }).count()) === 0);
ok("no page-background control on the right (§1 — lives in the left Background tab)",
  (await insp.getByText("Background", { exact: true }).count()) === 0);

// ── §1 — the ONE allowed logic affordance: a pointer, not UI ────────────────
const pointer = insp.locator("button", { hasText: "Open Logic" });
ok("exactly one 'Open Logic →' pointer (the only logic allowance)",
  (await pointer.count()) === 1);

// ── the design surface survives (selection-driven styling stays) ────────────
ok("design still editable — Primary color field present",
  (await insp.getByText("Primary", { exact: false }).count()) >= 1);
ok("Layout blocks reachable WITHOUT a Design tab (directly present)",
  (await insp.locator("summary", { hasText: "Layout blocks" }).count()) === 1);
ok("Custom CSS disclosure present",
  (await insp.locator("summary", { hasText: "Custom CSS" }).count()) === 1);
ok("footer Delete step present",
  (await insp.locator(".qz-insp-foot button", { hasText: "Delete step" }).count()) === 1);

await insp.screenshot({ path: `${SHOTS}/decider-inspector.png` }).catch(() => {});

// ── logic authoring RELOCATED, not lost: the pointer lands in the Logic map ──
await pointer.click();
await page.waitForTimeout(700);
ok("'Open Logic →' navigates to the Logic view (map + rules)",
  (await page.locator("text=/first match wins/i").count()) > 0 ||
    (await page.locator(".qz-builder-rail-item.is-active", { hasText: "Logic" }).count()) === 1);

ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
