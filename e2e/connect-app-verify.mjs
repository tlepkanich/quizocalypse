import { chromium } from "playwright";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
if (!KEY) throw new Error("STUDIO_ACCESS_TOKEN not set");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "networkidle", timeout: 30000 });
await page.goto(`${BASE}/studio/products`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1000);

// If a prior test left it connected, disconnect so the connect form shows.
const disconnect = page.getByRole("button", { name: /^Disconnect$/ });
if (await disconnect.count()) {
  console.log("(already connected — disconnecting to reset)");
  await disconnect.click();
  await page.waitForTimeout(2000);
}

const useApp = page.getByRole("button", { name: /Use my installed app/i });
const tokenExpander = page.locator("summary", { hasText: /Admin API token/i });
console.log("UI — 'Use my installed app' button:", (await useApp.count()) > 0);
console.log("UI — token fallback expander:", (await tokenExpander.count()) > 0);
await page.screenshot({ path: "/tmp/connect-app.png", fullPage: true });

if (await useApp.count()) {
  await page.locator('input[name="domain"]').first().fill("quizocalypse.myshopify.com");
  await useApp.click();
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => document.body.innerText);
  const connected = /Shopify connected/i.test(text);
  const line =
    text.split("\n").map((l) => l.trim()).find((l) =>
      /(installed app|isn’t usable|isn't usable|No installed|syncing|Connected to|Couldn|valid \.myshopify)/i.test(l),
    ) || "(no status line captured)";
  console.log("AFTER click — connected state:", connected);
  console.log("AFTER click — message:", line.slice(0, 220));
  await page.screenshot({ path: "/tmp/connect-app-result.png", fullPage: true });
  // Reset so we don't leave a half-connection on the dev shop.
  const dc = page.getByRole("button", { name: /^Disconnect$/ });
  if (await dc.count()) {
    await dc.click();
    await page.waitForTimeout(1500);
    console.log("(reset: disconnected)");
  }
}

console.log("WROTE /tmp/connect-app.png + /tmp/connect-app-result.png");
await browser.close();
