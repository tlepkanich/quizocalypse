import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Walk a published quiz end-to-end (intro → questions → result) at mobile +
// desktop, screenshot each step, and assert the layout invariants that SSR
// can't see — most importantly that the progress trail's pills never balloon
// into tall ovals (the bug that shipped twice because SSR only renders the
// intro). Runs against the live deployment; no local server/DB.

const QUIZZES = (
  process.env.SMOKE_QUIZZES ||
  "a:cmq566eof0001qvky8ze2qcwn,b:cmq5bugkn0003qvkvgos5cdof"
)
  .split(",")
  .map((s) => {
    const [label, id] = s.split(":");
    return { label, id };
  });

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];

mkdirSync("e2e/shots", { recursive: true });

for (const q of QUIZZES) {
  for (const vp of VIEWPORTS) {
    test(`runtime ${q.label} @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/q/${q.id}`, { waitUntil: "networkidle", timeout: 30_000 });

      const shot = (name: string) =>
        page.screenshot({ path: `e2e/shots/${q.label}-${vp.name}-${name}.png`, fullPage: true });

      const checkSanity = async (step: string) => {
        // 1) Progress-trail pills must stay short — a tall pill is the oval bug.
        const trail = page.locator('[aria-label="Quiz progress"]');
        if (await trail.count()) {
          const pills = trail.locator("button, span");
          const n = await pills.count();
          for (let p = 0; p < n; p++) {
            const box = await pills.nth(p).boundingBox();
            if (box) {
              expect(
                box.height,
                `[${q.label}/${vp.name}/${step}] trail pill ${p} is ${Math.round(box.height)}px tall (oval)`,
              ).toBeLessThan(64);
            }
          }
        }
        // 2) No horizontal overflow.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(
          overflow,
          `[${q.label}/${vp.name}/${step}] horizontal overflow ${overflow}px`,
        ).toBeLessThanOrEqual(2);
        // 3) On desktop the content column must stack (not lay children in a row).
        if (vp.name === "desktop") {
          const dir = await page
            .locator(".qz-runtime-content")
            .first()
            .evaluate((el) => getComputedStyle(el).flexDirection);
          expect(dir, `[${q.label}/${vp.name}/${step}] content not a column`).toBe("column");
        }
      };

      await shot("1-intro");
      await checkSanity("intro");

      // Walk forward to the result, handling each input shape: single-select &
      // tiles advance on click; multi-select needs a tick then an enabled
      // "Next"; text / email / number inputs get filled so a gated submit opens.
      for (let i = 0; i < 12; i++) {
        if (await page.getByRole("button", { name: /start over/i }).count()) {
          await shot("9-result");
          await checkSanity("result");
          return;
        }
        // Fill any free-text inputs (text/email/number) to unblock a gated Next.
        const inputs = page.locator(
          '.qz-runtime-content input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"])',
        );
        for (let k = 0; k < (await inputs.count()); k++) {
          const type = await inputs.nth(k).getAttribute("type");
          await inputs
            .nth(k)
            .fill(type === "email" ? "a@b.co" : type === "number" ? "3" : "test")
            .catch(() => {});
        }
        // Multi-select / multi-choice: tick the first option to enable submit.
        const choice = page
          .locator(
            '.qz-runtime-content input[type="checkbox"], .qz-runtime-content input[type="radio"]',
          )
          .first();
        if (await choice.count()) await choice.click().catch(() => {});

        const action = page
          .locator(
            '.qz-runtime-content button:not([title="Jump back to this question"]):not([aria-label="More info"])',
          )
          .first();
        if (!(await action.count()) || !(await action.isEnabled().catch(() => false))) break;
        await action.click();
        await page.waitForTimeout(450);
        await shot(`${i + 2}-step`);
        await checkSanity(`step${i + 1}`);
      }
    });
  }
}

// Phase K2 — locale serving contract. Fixture "a" (the demo quiz) carries a
// French translation map; ?locale=fr must serve lang="fr" with non-empty copy,
// and an unknown locale must fall back to English (lang="en"). Structural
// only — no assertions on specific translated words (regeneration may rephrase).
test("locale: fr serves lang=fr, unknown falls back to en", async ({ page }) => {
  const demo = QUIZZES.find((q) => q.label === "a")!;
  await page.goto(`/q/${demo.id}?locale=fr`, { waitUntil: "networkidle" });
  await expect(page.locator('[lang="fr"]').first()).toBeAttached();
  expect((await page.locator("h1").first().textContent())?.trim().length).toBeGreaterThan(0);

  await page.goto(`/q/${demo.id}?locale=zz`, { waitUntil: "networkidle" });
  await expect(page.locator('[lang="en"]').first()).toBeAttached();
});
