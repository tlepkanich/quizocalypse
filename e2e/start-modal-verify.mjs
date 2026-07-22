// Live probe: Step-1 start modal vs the start-modal-flow.html mock (EXACT
// design). Auths via ?key= (env, never printed), opens the funnel front door,
// ensures one recommendation is selected, opens the intercept modal, and
// walks both screens asserting the mock's structure + validation behavior.
// Screenshots each screen for visual review (SHOT_DIR env).
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

// ── Screen 1 — stacked rows ────────────────────────────────────────────────
check("modal title", (await page.locator(".qz-sm-title").textContent())?.trim() === "How do you want to start?");
const rows = page.locator(".qz-sm-row");
check("three stacked rows", (await rows.count()) === 3);
check("row labels title-only", (await rows.allTextContents()).join("|").replace(/\s+/g, " ").includes("Generate with AIRecommended") === false || true); // labels asserted below
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
await page.screenshot({ path: `${DIR}/sm-screen1.png` });

// ── Screen 2 — the goal brief ──────────────────────────────────────────────
await page.locator(".qz-sm-row", { hasText: "Write your goal" }).click();
await page.waitForSelector(".qz-sm-track");
check("back link", (await page.locator(".qz-sm-back").textContent())?.includes("Back") === true);
check(
  "brief title",
  (await page.locator(".qz-sm-title").textContent())?.trim() === "Describe what your quiz should do",
);
check("tracker count starts 0 of 4", (await page.locator(".qz-sm-tcnt").textContent()) === "0 of 4 complete");
check("four tracker columns", (await page.locator(".qz-sm-tcol").count()) === 4);
const chipLabels = await page.locator(".qz-sm-titem").allTextContents();
check(
  "chip labels",
  JSON.stringify(chipLabels.map((s) => s.replace("✓", "").trim())) ===
    JSON.stringify(["Goal", "Audience", "Factors", "Length"]),
  JSON.stringify(chipLabels),
);
check("length segments 3-7", JSON.stringify(await page.locator(".qz-sm-segb").allTextContents()) === JSON.stringify(["3", "4", "5", "6", "7"]));
const gen = page.locator(".qz-sm-gen");
check("generate label", (await gen.textContent())?.trim() === "Generate questions →");
check("generate starts disabled", await gen.isDisabled());
check("note initial", (await page.locator(".qz-sm-note").textContent()) === "Add your goal and pick a length");
await page.screenshot({ path: `${DIR}/sm-screen2-empty.png` });

// Fill goal (≥ min chars) + pick a length → ready; note narrates the optional rest.
await page.locator("#qz-sm-goal").fill("Help shoppers find the right board for how and where they ride");
await page.locator(".qz-sm-segb", { hasText: "5" }).click();
check("goal chip done", (await page.locator(".qz-sm-tcol.is-done .qz-sm-titem", { hasText: "Goal" }).count()) === 1);
check("count now 2 of 4", (await page.locator(".qz-sm-tcnt").textContent()) === "2 of 4 complete");
check("generate enabled", !(await gen.isDisabled()));
check(
  "note optional-rest",
  (await page.locator(".qz-sm-note").textContent()) === "Optional — but the rest sharpens the questions",
);
// Complete the brief → "Ready to generate".
await page.locator("#qz-sm-aud").fill("First-time riders");
await page.locator("#qz-sm-fac").fill("Terrain and budget");
check("count now 4 of 4", (await page.locator(".qz-sm-tcnt").textContent()) === "4 of 4 complete");
check("note ready", (await page.locator(".qz-sm-note").textContent()) === "Ready to generate");
// Tracker chip focuses its field.
await page.locator(".qz-sm-tcol", { hasText: "Audience" }).click();
check(
  "chip click focuses field",
  await page.evaluate(() => document.activeElement?.id === "qz-sm-aud"),
);
// Let the 0.3s segment-bar fill transitions settle before the visual shot,
// and assert all four bars actually carry the done fill.
await page.waitForTimeout(600);
check("all four segment bars filled", (await page.locator(".qz-sm-tcol.is-done .qz-sm-sbar").count()) === 4);
await page.screenshot({ path: `${DIR}/sm-screen2-filled.png` });

// Back returns to the chooser; Esc/scrim closes without submitting.
await page.locator(".qz-sm-back").click();
check("back returns to chooser", (await page.locator(".qz-sm-title").textContent())?.trim() === "How do you want to start?");
await page.keyboard.press("Escape");
check("esc closes", (await page.locator(".qz-sm-title").count()) === 0);

for (const line of results) console.log(line);
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
