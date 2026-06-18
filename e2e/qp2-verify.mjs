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

// Load the builder; pull the draft doc out of the Remix loader data.
await page.goto(`${BASE}/studio/${quizId}`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);
const doc = await page.evaluate(() => {
  const ld = window.__remixContext?.state?.loaderData ?? {};
  for (const k of Object.keys(ld)) {
    const v = ld[k];
    if (v && typeof v === "object") {
      if (Array.isArray(v.nodes)) return v;
      if (v.doc && Array.isArray(v.doc.nodes)) return v.doc;
      if (v.data?.doc && Array.isArray(v.data.doc.nodes)) return v.data.doc;
    }
  }
  return null;
});
if (!doc) {
  console.log("COULD NOT EXTRACT DOC from loaderData keys:", await page.evaluate(() => Object.keys(window.__remixContext?.state?.loaderData ?? {})));
  await browser.close();
  process.exit(1);
}
const origPad = doc.design_tokens?.page_padding ?? null;
console.log("DOC ok — nodes:", doc.nodes.length, "| original page_padding:", JSON.stringify(origPad));

// Set a distinctive page_padding and PUT it through the autosave contract.
const PP = { top: 96, right: 48, bottom: 48, left: 48 };
const patched = { ...doc, design_tokens: { ...(doc.design_tokens ?? {}), page_padding: PP } };
const put = await page.request.put(`${BASE}/studio/${quizId}`, {
  data: { doc: patched },
  headers: { "content-type": "application/json" },
});
console.log("PUT page_padding:", put.status());

// Reload and measure the live runtime page wrapper in the canvas.
await page.goto(`${BASE}/studio/${quizId}`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector(".qz-runtime-page", { timeout: 12000 }).catch(() => {});
await page.waitForTimeout(800);
const measured = await page.evaluate(() => {
  const el = document.querySelector(".qz-runtime-page");
  const root = document.querySelector(".qz-runtime-root, [class*='qz-bp-']") || el?.closest("[style*='--qz']");
  const cs = el ? getComputedStyle(el) : null;
  return {
    found: !!el,
    paddingTop: cs?.paddingTop,
    paddingLeft: cs?.paddingLeft,
    paddingRight: cs?.paddingRight,
    ppTopVar: root ? getComputedStyle(root).getPropertyValue("--qz-pp-top").trim() : "(no root)",
  };
});
console.log("MEASURED:", JSON.stringify(measured), "(expect paddingTop 96px, paddingLeft 48px)");

// Restore the original padding (clean the test quiz).
const restored = { ...doc, design_tokens: { ...(doc.design_tokens ?? {}) } };
if (origPad) restored.design_tokens.page_padding = origPad;
else delete restored.design_tokens.page_padding;
const back = await page.request.put(`${BASE}/studio/${quizId}`, {
  data: { doc: restored },
  headers: { "content-type": "application/json" },
});
console.log("RESTORE page_padding:", back.status());

await browser.close();
