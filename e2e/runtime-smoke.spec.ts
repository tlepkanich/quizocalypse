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

// BIC-2 D1 — screenshot regression, opt-in via SMOKE_SHOTS=1. Baselines are
// platform-suffixed by Playwright (…-darwin.png committed; linux not yet
// blessed), so this MUST stay off in CI until linux baselines exist — a naive
// always-on assert would fail on font rendering and trigger a false rollback.
// Bless/re-bless: `npm run e2e:bless-shots` (see e2e/README.md).
const SHOTS_ON = process.env.SMOKE_SHOTS === "1";

mkdirSync("e2e/shots", { recursive: true });

for (const q of QUIZZES) {
  for (const vp of VIEWPORTS) {
    test(`runtime ${q.label} @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Hydration-error guard: a React #425/#418 means SSR↔client divergence (e.g.
      // an unescaped " in a <style> comment — the D4c regression that shipped past
      // gates + screenshots because it's an inert comment). Collect from BEFORE
      // navigation so errors thrown during initial hydration are caught.
      const hydrationErrors: string[] = [];
      page.on("pageerror", (e) => {
        if (/#4[12][0-9]|Minified React error/.test(String(e))) hydrationErrors.push(String(e));
      });
      await page.goto(`/q/${q.id}`, { waitUntil: "networkidle", timeout: 30_000 });

      const shot = async (name: string) => {
        await page.screenshot({
          path: `e2e/shots/${q.label}-${vp.name}-${name}.png`,
          fullPage: true,
        });
        // Regression compare against the committed baseline (same shot, per
        // step × viewport). toHaveScreenshot retries until two consecutive
        // frames match, which also rides out late-loading imagery.
        if (SHOTS_ON) {
          await expect(page).toHaveScreenshot(`${q.label}-${vp.name}-${name}.png`, {
            fullPage: true,
          });
        }
      };

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

        // Dropdown question: a <select> isn't a checkbox/radio, so pick its
        // first real <option> to enable the Continue button — without this the
        // walker hits the disabled Continue and breaks (zero dropdown coverage).
        const dropdown = page.locator(".qz-runtime-content select").first();
        if (await dropdown.count()) {
          const opts = await dropdown
            .locator("option")
            .evaluateAll((os) => os.map((o) => o.getAttribute("value") || "").filter(Boolean));
          const [firstOpt] = opts;
          if (firstOpt) await dropdown.selectOption(firstOpt).catch(() => {});
        }

        // Exclude the minimal-chrome "Back" pill: on a multi-select step the
        // answers are checkboxes, so the only content buttons are Back + Next
        // (Back first in the DOM). Without this filter `.first()` clicks Back and
        // the walker oscillates, never completing any multi-select quiz.
        const action = page
          .locator(
            '.qz-runtime-content button:not([title="Jump back to this question"]):not([aria-label="More info"])',
          )
          .filter({ hasNotText: /^\s*back\s*$/i })
          .first();
        if (!(await action.count()) || !(await action.isEnabled().catch(() => false))) break;
        const headlineSel = ".qz-runtime-content h1, .qz-runtime-content h2";
        // Short timeout: a step may legitimately have no h1/h2 (e.g. an empty
        // intro headline) — without it, textContent() blocks the whole action
        // timeout waiting for an element that never appears.
        const readHeadline = () =>
          page.locator(headlineSel).first().textContent({ timeout: 800 }).catch(() => null);
        const before = await readHeadline();
        await action.click();
        await page.waitForTimeout(300);
        // MQ minimal chrome: single-select is select-then-Next — clicking an
        // answer only marks a pending pick. If the step didn't change, commit it
        // with the explicit Next pill. (Classic auto-advances, so the headline
        // already changed and this is skipped.)
        const after = await readHeadline();
        if (after === before) {
          const next = page.getByRole("button", { name: /^next$/i }).first();
          if ((await next.count()) && (await next.isEnabled().catch(() => false))) {
            await next.click();
          }
        }
        await page.waitForTimeout(450);
        await shot(`${i + 2}-step`);
        await checkSanity(`step${i + 1}`);
      }
      // The SSR'd runtime must hydrate cleanly — a silent #425/#418 cascades and
      // ships otherwise (the D4c <style>-comment bug was invisible to the gates,
      // unit tests, and these very screenshots; only a console probe catches it).
      expect(
        hydrationErrors,
        `[${q.label}/${vp.name}] React hydration error(s) on /q: ${hydrationErrors[0] ?? ""}`,
      ).toHaveLength(0);
    });
  }
}

// Phase K2 — locale serving contract. Fixture "a" (the demo quiz) carries a
// French translation map; ?locale=fr must serve lang="fr" with non-empty copy,
// and an unknown locale must fall back to English (lang="en"). Structural
// only — no assertions on specific translated words (regeneration may rephrase).
test("locale: fr serves lang=fr, unknown falls back to en", async ({ page }) => {
  const demo = QUIZZES.find((q) => q.label === "a")!;
  // domcontentloaded, not networkidle: these only assert the SSR lang attr + h1
  // (both in the initial HTML). The runtime keeps firing analytics events so the
  // page never truly idles — networkidle here flaked with net::ERR_TIMED_OUT,
  // even though /q?locale=fr serves 200 in ~560ms (verified directly).
  await page.goto(`/q/${demo.id}?locale=fr`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[lang="fr"]').first()).toBeAttached();
  expect((await page.locator("h1").first().textContent())?.trim().length).toBeGreaterThan(0);

  await page.goto(`/q/${demo.id}?locale=zz`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[lang="en"]').first()).toBeAttached();
});

// PP4 — product-performance leaderboard regression lock. Fire a viewed→clicked→
// add-to-cart sequence (a FIXED session, so re-runs dedupe to 1) for a known studio
// quiz, then read the analytics loader and assert the product's row aggregated:
// impressions/clicks/ATC ≥ 1 and CTR in (0,1]. Guards the whole
// events → productPerformance → loader → leaderboard chain — a dropped product_id
// from any payload empties the row and reds the gate. Needs the studio cookie
// (STUDIO_ACCESS_TOKEN, sourced by ship.sh); skips locally without it.
test("product analytics: events aggregate into the Top-products leaderboard", async ({ page }) => {
  const token = process.env.STUDIO_ACCESS_TOKEN;
  test.skip(!token, "STUDIO_ACCESS_TOKEN not set");
  const quizId = process.env.SMOKE_PP_QUIZ || "cmqwbjef4001gqvl1gpr2hrzx";
  const pid = "pp-smoke-prod";
  const session = "pp-smoke-sess";

  await page.goto(`/studio?key=${token}`, { waitUntil: "domcontentloaded" });

  const status = await page.evaluate(
    async ([quiz, sess, p]) => {
      const r = await fetch("/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: [
            { quiz_id: quiz, session_id: sess, event_type: "recommendation_viewed", payload: { product_ids: [p] } },
            { quiz_id: quiz, session_id: sess, event_type: "recommendation_clicked", payload: { product_id: p } },
            { quiz_id: quiz, session_id: sess, event_type: "add_to_cart", payload: { product_id: p } },
          ],
        }),
      });
      return r.status;
    },
    [quizId, session, pid],
  );
  expect(status).toBe(202);

  await page.waitForTimeout(1000); // let the writes land

  const row = (await page.evaluate(async ([quiz, p]) => {
    const u = `/studio/${quiz}/analytics?_data=routes%2Fstudio.%24id_.analytics`;
    const d = await (await fetch(u, { headers: { accept: "application/json" } })).json();
    return (d.topProducts ?? []).find((x: { productId: string }) => x.productId === p) ?? null;
  }, [quizId, pid])) as {
    impressions: number;
    clicks: number;
    addToCart: number;
    ctr: number;
  } | null;

  expect(row).not.toBeNull();
  expect(row!.impressions).toBeGreaterThanOrEqual(1);
  expect(row!.clicks).toBeGreaterThanOrEqual(1);
  expect(row!.addToCart).toBeGreaterThanOrEqual(1);
  expect(row!.ctr).toBeGreaterThan(0);
  expect(row!.ctr).toBeLessThanOrEqual(1);
});
