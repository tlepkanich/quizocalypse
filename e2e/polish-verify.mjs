import { chromium } from "playwright";
const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "networkidle", timeout: 30000 });
await page.goto(`${BASE}/studio/quizzes`, { waitUntil: "networkidle", timeout: 30000 });
const ids = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href^="/studio/"]')).map((a) => a.getAttribute("href"))
    .filter((h) => h && /^\/studio\/c[a-z0-9]{20,}$/i.test(h)).map((h) => h.split("/")[2]));
const quizId = Array.from(new Set(ids))[0];
await page.goto(`${BASE}/studio/${quizId}`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1200);

const tips = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".qz-tip[data-tip]")).map((el) => el.getAttribute("data-tip")));
console.log("TOOLTIP CONTROLS:", tips.length, "→", JSON.stringify(tips));

// Hover the zoom-out button and confirm the ::after tooltip becomes visible.
const zoomOut = page.getByRole("button", { name: "Zoom out" });
await zoomOut.hover();
await page.waitForTimeout(350);
const tipState = await zoomOut.evaluate((el) => {
  const a = getComputedStyle(el, "::after");
  return { content: a.content, opacity: a.opacity, bg: a.backgroundColor };
});
console.log("ZOOM-OUT ::after on hover:", JSON.stringify(tipState), "(expect opacity 1, content 'Zoom out')");

// Screenshot the top-bar region with the tooltip showing.
await page.screenshot({ path: "/tmp/polish-tooltip.png", clip: { x: 560, y: 0, width: 520, height: 130 } });
console.log("WROTE /tmp/polish-tooltip.png");
await browser.close();
