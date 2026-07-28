// Live probe: Step-1 start modal vs the start-modal-flow.html mock (screen 1)
// after FLOW-2 (funnel-reconfig Phase 3). The pop-up survives ONLY in the
// MANUAL flow and is single-screen now: the goal-brief second screen retired
// in favor of the /studio/goal page (Flow 1), which the "Write your goal" row
// links to. Auths via ?key= (env, never printed), opens the funnel front door,
// ensures one recommendation is selected, opens the intercept modal, asserts
// the mock's screen-1 structure + the new routing, and screenshots for visual
// review (SHOT_DIR env). Read-only beyond a possible bucket toggle: no row
// that mutates the draft is clicked.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const DIR = process.env.SHOT_DIR ?? ".";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}

const results = [];
const check = (name, ok, extra = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${BASE}/studio/onboarding?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});

// FLOW-2 precondition: the pop-up only exists on a MANUAL draft (neither
// goal-first nor template-first — those confirm straight through). The front
// door resumes/creates one; if this shop's in-flight draft is mid-another-flow
// the probe reports it honestly instead of false-failing the modal asserts.
const confirmLabel = await page
  .locator(".qz-rb-rail-foot .qz-btn-accent, .qz-rb-rail-foot .qz-btn[disabled]")
  .first()
  .textContent()
  .catch(() => "");
if ((confirmLabel ?? "").includes("Generate my quiz")) {
  console.log("SKIP — resumed draft is goal/template-first (no pop-up by design); graduate it and re-run");
  await browser.close();
  process.exit(0);
}

// Ensure at least one recommendation is selected so Continue opens the modal
// (truth = the Continue button's own disabled state, not a rail heuristic).
const cont = page.getByRole("button", { name: /^Continue/ }).last();
if (await cont.isDisabled()) {
  await page.locator('.qz-rb-card[aria-pressed="false"]').first().click();
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll("button")];
      const c = btns.filter((b) => /^Continue/.test(b.textContent ?? "")).pop();
      return c && !c.disabled;
    },
    { timeout: 8000 },
  );
}
await cont.click();
await page.waitForSelector(".qz-sm-title", { timeout: 5000 }).catch(() => {});

// ── The single screen — stacked rows ────────────────────────────────────────
check("modal title", (await page.locator(".qz-sm-title").textContent())?.trim() === "How do you want to start?");
const rows = page.locator(".qz-sm-row");
check("three stacked rows", (await rows.count()) === 3);
const labels = await page.locator(".qz-sm-row h3").allTextContents();
check(
  "exact row labels",
  JSON.stringify(labels) === JSON.stringify(["Generate with AI", "Write your goal", "Start from blank"]),
  JSON.stringify(labels),
);
check("AI row is primary", (await page.locator(".qz-sm-row.is-pri h3").textContent()) === "Generate with AI");
check("mono RECOMMENDED tag", (await page.locator(".qz-sm-rec").textContent()) === "Recommended");
check("no description blurbs", (await page.locator(".qz-sm-row .qz-dim").count()) === 0);
check("arrows on rows", (await page.locator(".qz-sm-arr").count()) === 3);
// FLOW-2 routing: the goal-brief screen is GONE from the modal; "Write your
// goal" is a plain link into the Flow-1 /studio/goal front door.
check("no in-modal goal-brief screen", (await page.locator(".qz-sm-track").count()) === 0 && (await page.locator(".qz-sm-back").count()) === 0);
check(
  "Write-your-goal row links /studio/goal",
  (await page.locator('a.qz-sm-row[href="/studio/goal"]').count()) === 1,
);
await page.screenshot({ path: `${DIR}/sm-screen1.png` });

// ── "Write your goal" navigates to the goal page (the reused Flow-1 form) ───
await page.locator('a.qz-sm-row[href="/studio/goal"]').click();
await page.waitForURL(/\/studio\/goal/, { timeout: 10000 });
await page.waitForSelector(".qz-goal-page", { timeout: 15000 });
check("write-goal lands on the goal page (brief tracker present)", (await page.locator(".qz-sm-track").count()) === 1);
check("goal page CTA gated like the old brief", await page.locator(".qz-sm-gen").isDisabled());
await page.screenshot({ path: `${DIR}/sm-goal-page.png` });

// ── Esc/scrim closes the modal without submitting ───────────────────────────
await page.goBack({ waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
const cont2 = page.getByRole("button", { name: /^Continue/ }).last();
await cont2.click();
await page.waitForSelector(".qz-sm-title", { timeout: 5000 }).catch(() => {});
await page.keyboard.press("Escape");
check("esc closes", (await page.locator(".qz-sm-title").count()) === 0);

for (const line of results) console.log(line);
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
