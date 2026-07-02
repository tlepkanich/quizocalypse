// O-2 live-verify on the standalone studio deploy — the image-density
// renderer (owner-activated). Draft-only edits on the legacy harness quiz
// (published /q untouched — the byte pin proves it), full restore after.
//   1. density 15 + question image + intro hero → the builder canvas
//      (Step5Preview → the REAL QuizRuntime) hides BOTH decorative images.
//   2. explicit question_image_position:"top" at density 15 → the header
//      image RENDERS (the review's precedence fix, live).
//   3. density 50 → both images render (the default path above the threshold).
//   4. restore + byte baseline + inventory success-path CORS (the O-1 fix).
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const LEGACY = "cmqqcb0ao004mqvkwjug7t0ya";

const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
const pubTextBefore = await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text();
const legacyBefore = sha(pubTextBefore);
const pub = JSON.parse(pubTextBefore);
const IMG = (pub.product_index ?? []).map((p) => p.image_url).find((u) => u?.startsWith("https://"));
ok("found a stable https product image to plant", !!IMG, IMG?.slice(0, 60));

const dataUrl = `${BASE}/studio/${LEGACY}?_data=routes%2Fstudio_.%24id`;
const original = (await (await ctx.request.get(dataUrl)).json()).doc;
const backup = JSON.stringify(original);
const qNode = original.nodes.find(
  (n) => n.data && typeof n.data.text === "string" && Array.isArray(n.data.answers) && n.data.answers.length >= 2,
);
const intro = original.nodes.find((n) => n.type === "intro");
ok("draft has a question node + intro", !!qNode && !!intro, qNode?.data?.text?.slice(0, 40));

const put = async (doc) => {
  const r = await ctx.request.put(dataUrl, { headers: { "content-type": "application/json" }, data: { doc } });
  return r.ok();
};
const compose = ({ density, explicitPos }) => {
  const doc = JSON.parse(backup);
  doc.design_tokens = {
    ...(doc.design_tokens ?? {}),
    style_bar: { ...(doc.design_tokens?.style_bar ?? {}), image_density: density },
    ...(explicitPos ? { question_image_position: explicitPos } : {}),
  };
  if (explicitPos === undefined) delete doc.design_tokens.question_image_position;
  for (const n of doc.nodes) {
    if (n.id === qNode.id) n.data = { ...n.data, image_url: IMG };
    if (n.id === intro.id) n.data = { ...n.data, hero_image_url: IMG };
  }
  return doc;
};

const canvasImg = () => page.locator(`.qz-builder-canvas img[src="${IMG}"], [class*=canvas] img[src="${IMG}"]`);
const openBuilder = async () => {
  await page.goto(`${BASE}/studio/${LEGACY}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
};
const selectQuestion = async () => {
  await page.getByText(qNode.data.text.slice(0, 28)).first().click();
  await page.waitForTimeout(800);
};

// ── 1. density 15: BOTH decorative images hidden ────────────────────────────
ok("PUT density 15 + planted images", await put(compose({ density: 15 })));
await openBuilder();
ok("intro hero HIDDEN at density 15 (canvas)", (await canvasImg().count()) === 0);
await selectQuestion();
ok("question header image HIDDEN at density 15 (canvas)", (await canvasImg().count()) === 0);
await page.screenshot({ path: "e2e/shots/o2-density15-hidden.png" });

// ── 2. explicit position beats the gate (the review's precedence fix) ───────
ok("PUT density 15 + EXPLICIT position top", await put(compose({ density: 15, explicitPos: "top" })));
await openBuilder();
await selectQuestion();
ok("question header image RENDERS at density 15 when position is EXPLICIT", (await canvasImg().count()) > 0);
await page.screenshot({ path: "e2e/shots/o2-density15-explicit-top.png" });

// ── 3. density 50: default path shows everything ────────────────────────────
ok("PUT density 50 (no explicit position)", await put(compose({ density: 50 })));
await openBuilder();
ok("intro hero RENDERS at density 50", (await canvasImg().count()) > 0);
await selectQuestion();
ok("question header image RENDERS at density 50", (await canvasImg().count()) > 0);
await page.screenshot({ path: "e2e/shots/o2-density50-shown.png" });

// ── 4. restore + byte baseline + inventory success-path CORS ────────────────
ok("draft RESTORED byte-equal", (await put(JSON.parse(backup))) &&
  JSON.stringify((await (await ctx.request.get(dataUrl)).json()).doc) === backup);
const legacyAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("published /q.json byte-identical", legacyBefore === legacyAfter, `${legacyBefore} → ${legacyAfter}`);

const realPid = (pub.product_index ?? [])[0]?.product_id;
const inv = await ctx.request.post(`${BASE}/q/${LEGACY}/inventory`, {
  headers: { "content-type": "application/json" },
  data: { product_ids: [realPid] },
});
const invCors = inv.headers()["access-control-allow-origin"];
ok("inventory SUCCESS path carries CORS (the O-1 fix)", inv.ok() && invCors === "*",
  `status ${inv.status()} acao=${invCors} body=${(await inv.text()).slice(0, 60)}`);

ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
await browser.close();
const pass = Object.values(out.checks).every(Boolean);
console.log(pass ? "\nALL CHECKS PASS" : "\nFAILURES PRESENT");
process.exit(pass ? 0 : 1);
