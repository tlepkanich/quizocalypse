// QB-1 temp verification — screenshot the standalone builder in each tool state.
// Run: STUDIO_TOKEN=... node e2e/qb1-shot.mjs   (deleted after QB-1 verify)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "https://quizocalypse-studio.fly.dev";
const TOKEN = process.env.STUDIO_TOKEN;
const QUIZ = process.env.QUIZ || "cmqgpx1zp000dqvkwljne1tji";
const OUT = "e2e/shots";
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/qb1-${name}.png`, fullPage: false });
  console.log(`  shot: qb1-${name}.png`);
};

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // 1) Establish the studio session (?key= → cookie → redirect).
  await page.goto(`${BASE}/studio?key=${TOKEN}`, { waitUntil: "networkidle" });
  // 2) Open the builder.
  await page.goto(`${BASE}/studio/${QUIZ}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".qz-builder", { timeout: 15000 });

  // Report structural facts the screenshots confirm.
  const facts = await page.evaluate(() => ({
    hasBuilder: !!document.querySelector(".qz-builder"),
    hasBody: !!document.querySelector(".qz-builder-body"),
    hasPanel: !!document.querySelector(".qz-builder-panel"),
    hasStage: !!document.querySelector(".qz-builder-stage"),
    hasFilmstrip: !!document.querySelector(".qz-builder-filmstrip"),
    // The app sidebar must NOT be present (full-screen builder).
    hasAppSidebar: !!document.querySelector(".qz-sidebar"),
    railItems: [...document.querySelectorAll(".qz-builder-rail-item span")].map((s) => s.textContent),
  }));
  console.log("STRUCT:", JSON.stringify(facts));

  await shot(page, "1-editor");

  // Click each rail tool and screenshot the swapped panel.
  for (const [label, name] of [["AI", "2-ai"], ["Theme", "3-theme"], ["Code", "4-code"], ["Settings", "5-settings"], ["Editor", "6-editor-again"]]) {
    const btn = page.locator(".qz-builder-rail-item", { hasText: new RegExp(`^${label}$`) });
    await btn.click();
    await page.waitForTimeout(600);
    if (label === "Settings") {
      const tabs = await page.evaluate(() =>
        [...document.querySelectorAll(".qz-settings-tab")].map((t) => t.textContent),
      );
      console.log("SETTINGS_TABS:", JSON.stringify(tabs));
    }
    if (label === "Theme") {
      const theme = await page.evaluate(() => ({
        hasGallery: !!document.querySelector(".qz-builder-panel button"),
        text: document.querySelector(".qz-builder-panel")?.textContent?.slice(0, 120) ?? "",
      }));
      console.log("THEME_PANEL:", JSON.stringify(theme));
    }
    await shot(page, name);
  }

  // Dark mode (set the qz-theme cookie + reload).
  await ctx.addCookies([{ name: "qz-theme", value: "dark", url: BASE }]);
  await page.goto(`${BASE}/studio/${QUIZ}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".qz-builder", { timeout: 15000 });
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("DARK data-theme:", theme);
  await shot(page, "7-dark-editor");

  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
