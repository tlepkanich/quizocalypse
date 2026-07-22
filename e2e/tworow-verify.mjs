// Live probe: step1 handoff §1 two-row funnel chrome. Auths via ?key= (env,
// never printed), opens the funnel front door, asserts the two-row bar DOM,
// and screenshots the top of the page for visual review.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const OUT = process.env.SHOT_OUT ?? "tworow.png";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Auth (sets the studio cookie) then land on the funnel front door.
await page.goto(`${BASE}/studio/onboarding?key=${KEY}`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});

const url = page.url();
const results = [];
const check = (name, ok, extra = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);

const bar = page.locator(".qz-topbar--tworow");
check("two-row topbar present", (await bar.count()) === 1, `url=${url.replace(KEY, "***")}`);

// Row 1: wordmark left, actions right, NO center zone, no zone dividers.
check("row1 present", (await page.locator(".qz-topbar--tworow .qz-topbar-row").count()) === 1);
check("center zone gone", (await page.locator(".qz-topbar--tworow .qz-topbar-center").count()) === 0);
const leftBorder = await page
  .locator(".qz-topbar--tworow .qz-topbar-left")
  .evaluate((el) => getComputedStyle(el).borderRightStyle);
check("row1 left divider removed", leftBorder === "none", `borderRightStyle=${leftBorder}`);

// Row 2: the stepper lives in the nav row, below row 1, with a top hairline.
const navRow = page.locator(".qz-topbar--tworow .qz-topbar-nav");
check("nav row present", (await navRow.count()) === 1);
check("stepper inside nav row", (await page.locator(".qz-topbar-nav .qz-stepnav").count()) === 1);
if ((await navRow.count()) === 1) {
  const geom = await page.evaluate(() => {
    const row = document.querySelector(".qz-topbar--tworow .qz-topbar-row").getBoundingClientRect();
    const nav = document.querySelector(".qz-topbar--tworow .qz-topbar-nav").getBoundingClientRect();
    const border = getComputedStyle(document.querySelector(".qz-topbar-nav")).borderTopWidth;
    return { rowBottom: row.bottom, navTop: nav.top, navHeight: nav.height, border };
  });
  check("nav row sits BELOW row1", geom.navTop >= geom.rowBottom - 1, JSON.stringify(geom));
  check("nav row hairline", geom.border === "1px");
}

// Sticky bar still pins.
const position = await page
  .locator(".qz-topbar--tworow")
  .evaluate((el) => getComputedStyle(el).position);
check("bar still sticky", position === "sticky", `position=${position}`);

await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1440, height: 420 } });

for (const line of results) console.log(line);
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
