// Group-wizard criterion peek live-verify — /studio/groups against a LOCAL
// production build + local DB. Read-only: the wizard is client-side state;
// the probe never presses "Create group", so nothing persists.
//
//   set -a; source .env; set +a
//   BASE=http://localhost:3000 node e2e/group-peek-verify.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/group-peek-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
const mask = (s) => String(s).replaceAll(KEY, "***");

let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${mask(detail)}` : ""}`);
  if (!cond) failures++;
};

let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));

  await page.goto(`${BASE}/studio/groups?key=${KEY}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New group" }).first().click();
  await page.waitForSelector(".qz-modal", { timeout: 5000 });
  ok("wizard opens", await page.locator(".qz-modal").isVisible());
  await page.screenshot({ path: `${SHOTS}/1-wizard.png` });

  // Pick the first collection chip inside the Collections source section.
  const colSection = page.locator(".qz-wsrc", { hasText: "Collections" });
  const chip = colSection.locator(".qz-wsrc-chip").first();
  const chipLabel = (await chip.textContent())?.trim() ?? "";
  ok("collection chip present", chipLabel.length > 0, chipLabel);

  // Click 1 — selects.
  await chip.click();
  ok("first click selects", (await chip.getAttribute("aria-pressed")) === "true");
  const countAfterSelect = (await page.locator(".qz-wpreview").textContent()) ?? "";

  // Click 2 — expands the modal into the criterion's product list.
  await chip.click();
  await page.waitForSelector(".qz-rb-product-list", { timeout: 5000 });
  ok("peek expands in place", await page.locator(".qz-modal .qz-rb-product-list").isVisible());
  const meta = (await page.locator(".qz-rb-modal-meta").textContent()) ?? "";
  ok("peek meta line", /\d+ products? in this collection/.test(meta), meta);
  const rows = await page.locator(".qz-rb-product-row").count();
  ok("peek lists product rows", rows > 0, `${rows} rows`);
  const firstPrice = (await page.locator(".qz-rb-product-row .qz-dim").first().textContent()) ?? "";
  ok("row shows a price line", firstPrice.trim().length > 0, firstPrice.trim());
  ok("footer has Add", await page.locator(".qz-modal-footer button", { hasText: "Add" }).first().isVisible());
  ok("footer has Back", await page.locator(".qz-modal-footer button", { hasText: "Back" }).first().isVisible());
  ok("Done button gone", (await page.locator(".qz-modal-footer button", { hasText: "Done" }).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/2-peek.png` });

  // Back — returns to Define with the criterion NOT selected (second click
  // deselected, Back keeps it out — same net effect as today's double click).
  await page.locator(".qz-modal-footer button", { hasText: "Back" }).first().click();
  await page.waitForSelector(".qz-wsteps", { timeout: 5000 });
  ok("Back returns to Define", await page.locator(".qz-wsteps").isVisible());
  ok("Back leaves it deselected", (await chip.getAttribute("aria-pressed")) === "false");
  await page.screenshot({ path: `${SHOTS}/3-after-back.png` });

  // Click twice again, then Add — returns selected.
  await chip.click();
  await chip.click();
  await page.waitForSelector(".qz-rb-product-list", { timeout: 5000 });
  await page.locator(".qz-modal-footer button", { hasText: "Add" }).first().click();
  await page.waitForSelector(".qz-wsteps", { timeout: 5000 });
  ok("Add returns selected", (await chip.getAttribute("aria-pressed")) === "true");
  const countAfterAdd = (await page.locator(".qz-wpreview").textContent()) ?? "";
  ok("group preview count restored", countAfterAdd === countAfterSelect, countAfterAdd.slice(0, 40));
  await page.screenshot({ path: `${SHOTS}/4-after-add.png` });

  // Manual products keep the plain toggle (no peek).
  const manSection = page.locator(".qz-wsrc", { hasText: "Manual products" });
  const manChip = manSection.locator(".qz-wsrc-chip").first();
  if ((await manChip.count()) > 0 && !(await manChip.textContent())?.includes("more")) {
    await manChip.click();
    await manChip.click();
    ok("manual chip: no peek on second click", (await page.locator(".qz-rb-product-list").count()) === 0);
    ok("manual chip toggled back off", (await manChip.getAttribute("aria-pressed")) === "false");
  }

  // Escape / X while peeking exits the peek, not the wizard.
  const tagSection = page.locator(".qz-wsrc", { hasText: "Tags" });
  const tagChip = tagSection.locator(".qz-wsrc-chip").first();
  await tagChip.click();
  await tagChip.click();
  await page.waitForSelector(".qz-rb-product-list", { timeout: 5000 });
  const tagMeta = (await page.locator(".qz-rb-modal-meta").textContent()) ?? "";
  ok("tag peek meta line", /in this tag/.test(tagMeta), tagMeta);
  await page.screenshot({ path: `${SHOTS}/5-tag-peek.png` });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".qz-wsteps", { timeout: 5000 });
  ok("Escape exits peek, wizard stays open", await page.locator(".qz-wsteps").isVisible());

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  console.error("✗ probe crashed —", mask(e?.message ?? e));
  failures++;
} finally {
  await browser?.close();
}
process.exit(failures ? 1 : 0);
