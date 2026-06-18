import { chromium } from "playwright";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
if (!KEY) throw new Error("STUDIO_ACCESS_TOKEN not set");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "networkidle", timeout: 30000 });
await page.goto(`${BASE}/studio/quizzes`, { waitUntil: "networkidle", timeout: 30000 });
const ids = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href^="/studio/"]'))
    .map((a) => a.getAttribute("href"))
    .filter((h) => h && /^\/studio\/c[a-z0-9]{20,}$/i.test(h))
    .map((h) => h.split("/")[2]),
);
const quizId = Array.from(new Set(ids))[0];
console.log("QUIZ:", quizId);

await page.goto(`${BASE}/studio/${quizId}`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1200);

// Ensure Editor tool + Settings sub-tab are active so Page Settings is visible.
await page.getByRole("button", { name: /^Settings$/ }).first().click().catch(() => {});
await page.waitForSelector(".qz-page-settings", { timeout: 8000 }).catch(() => {});

const struct = await page.evaluate(() => {
  const ps = document.querySelector(".qz-page-settings");
  return {
    panel: !!ps,
    padInputs: document.querySelectorAll(".qz-ps-pad-input").length,
    colorInput: !!document.querySelector('.qz-ps-color input[type="color"]'),
    hexInput: !!document.querySelector("#qz-ps-bg"),
    title: document.querySelector(".qz-ps-title")?.textContent,
    pagePadTopBefore: (() => {
      const el = document.querySelector(".qz-runtime-page");
      return el ? getComputedStyle(el).paddingTop : null;
    })(),
  };
});
console.log("STRUCTURE:", JSON.stringify(struct));

const psEl = await page.$(".qz-page-settings");
if (psEl) await psEl.screenshot({ path: "/tmp/qp2-panel.png" });

// Functional: set the TOP padding to 80 and confirm the live preview's
// .qz-runtime-page paddingTop follows (input → commit → --qz-page-pad → runtime).
const topInput = await page.$(".qz-ps-pad-top");
if (topInput) {
  await topInput.fill("80");
  await topInput.dispatchEvent("change");
  await page.waitForTimeout(900);
}
const after = await page.evaluate(() => {
  const el = document.querySelector(".qz-runtime-page");
  return el ? getComputedStyle(el).paddingTop : null;
});
console.log("PAGE-PAD paddingTop AFTER set-top-80:", after, "(expect 80px)");

await page.screenshot({ path: "/tmp/qp2-builder.png" });
console.log("WROTE /tmp/qp2-panel.png + /tmp/qp2-builder.png");
await browser.close();
