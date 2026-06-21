import { chromium } from "playwright";

// RB-P2 live verification — the Recommendation Buckets page. Lands a funnel draft
// on the grouping stage (resetting via back-to-grouping so it can't sit past it),
// then exercises: tabs render, a product → a shelf bucket, bidirectional deselect,
// Continue gating. Screenshots light + dark.
const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
if (!KEY) throw new Error("STUDIO_ACCESS_TOKEN not set");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();

// 1 — auth (sets the studio cookie), then enter the funnel.
await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "networkidle", timeout: 30000 });
await page.goto(`${BASE}/studio/onboarding`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);
const draftUrl = page.url();
const quizId = draftUrl.split("/").pop()?.split("?")[0] ?? "";
console.log("FUNNEL draft:", draftUrl, "| quizId:", quizId);

// 2 — force the grouping stage (idempotent if already there) so we see the RB page.
await ctx.request.post(draftUrl, {
  form: { intent: "back-to-grouping" },
  headers: { "content-type": "application/x-www-form-urlencoded" },
});
await page.goto(draftUrl, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);

const has = async (sel) => (await page.locator(sel).count()) > 0;
const text = await page.evaluate(() => document.body.innerText);

console.log("— page markers —");
console.log("RB stage present (.qz-rb):", await has(".qz-rb"));
console.log("header 'Recommendation Buckets':", /Recommendation Buckets/i.test(text));
console.log("tabs (.qz-rb-tab):", await page.locator(".qz-rb-tab").count());
console.log("AI banner (.qz-rb-banner):", await has(".qz-rb-banner"));
console.log("grid cards (.qz-rb-card):", await page.locator(".qz-rb-card").count());
const tabLine = text.split("\n").map((l) => l.trim()).find((l) => /Individual Products/i.test(l));
console.log("tab labels line:", tabLine ?? "(none)");

await page.screenshot({ path: "/tmp/rb-light.png", fullPage: true });

if (await has(".qz-rb-card")) {
  const shelfBefore = await page.locator(".qz-rb-chip").count();
  await page.locator(".qz-rb-card").first().click();
  await page.waitForTimeout(1500);
  const shelfAfterAdd = await page.locator(".qz-rb-chip").count();
  console.log(`SELECT a product → shelf chips ${shelfBefore} → ${shelfAfterAdd}`);

  // Bidirectional deselect: remove via the shelf chip's × and confirm it drops.
  if (await has(".qz-rb-chip-x")) {
    await page.locator(".qz-rb-chip-x").first().click();
    await page.waitForTimeout(1500);
    const shelfAfterRemove = await page.locator(".qz-rb-chip").count();
    console.log(`REMOVE via shelf × → shelf chips ${shelfAfterAdd} → ${shelfAfterRemove}`);
  }

  // Re-add one so we can prove Continue enables, then screenshot the selected state.
  await page.locator(".qz-rb-card").first().click();
  await page.waitForTimeout(1500);
  const continueBtn = page.getByRole("button", { name: /Continue/ });
  console.log("Continue button present:", (await continueBtn.count()) > 0);
  console.log("Continue disabled (should be false w/ ≥1 bucket):", await continueBtn.first().isDisabled());
  await page.screenshot({ path: "/tmp/rb-selected.png", fullPage: true });

  // Tab switch — click the Tags tab if enabled.
  const tagTab = page.locator(".qz-rb-tab", { hasText: "Tags" });
  if ((await tagTab.count()) && !(await tagTab.first().isDisabled())) {
    await tagTab.first().click();
    await page.waitForTimeout(800);
    console.log("switched to Tags tab — grid cards now:", await page.locator(".qz-rb-card").count());
  }
}

// Reset the draft selections (leave it clean) — clear via toggling off any remaining.
await page.goto(`${BASE}/studio/onboarding/${quizId}`, { waitUntil: "networkidle" });

// 3 — dark mode screenshot.
await ctx.addCookies([{ name: "qz-theme", value: "dark", domain: "quizocalypse-studio.fly.dev", path: "/" }]);
await page.goto(draftUrl, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);
console.log("dark mode html[data-theme]:", await page.evaluate(() => document.documentElement.getAttribute("data-theme")));
await page.screenshot({ path: "/tmp/rb-dark.png", fullPage: true });

console.log("WROTE /tmp/rb-light.png + /tmp/rb-selected.png + /tmp/rb-dark.png");
await browser.close();
