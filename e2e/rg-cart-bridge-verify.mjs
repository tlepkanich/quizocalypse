// Results handoff §12.4 live-verify — the in-quiz add-to-cart WITH the
// shopper's code. Against a LOCAL prod build (BASE) and a FAKE storefront
// (routed in the browser; no request reaches Shopify): seed the local fixture
// with a decider doc whose discount is an EXISTING code (nothing is created
// at publish or on /offer), publish, then
//   1. load the REAL launcher script on the fake storefront, walk the quiz in
//      its pop-up and press Add to cart: the storefront must receive
//      /cart/add.js, then /cart/update.js with the cart's old code AND the
//      shopper's, and the quiz must stay put;
//   2. frame the quiz on a storefront with NO listener (a theme block from
//      before the offer pipeline): the quiz must fall back to the cart link
//      that carries the code.
// Restores the fixture byte-for-byte.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/rgb-shots";
// A LOCAL origin (not localhost:3000 itself): Chromium blocks a public origin
// from loading a script off localhost.
const STORE = "http://storefront.localhost:3000";
const CODE = "RGB-EXISTING";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = Boolean(v);
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${String(extra).replaceAll(KEY, "***")}` : ""}`);
};

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ }, include: { shop: true } });
if (!quiz) { console.error("fixture not found"); process.exit(1); }
const shopDomain = quiz.shop?.shopDomain ?? "";
const snap = { draftJson: quiz.draftJson, publishedJson: quiz.publishedJson, status: quiz.status, version: quiz.version };
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(`${SHOTS}/rgb-backup.json`, JSON.stringify({ ...snap, categories: originalCats }));
console.log(`snapshot written (${originalCats.length} categories) — store ${shopDomain}`);

let browser = null;
let seeded = false;
try {
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId }, select: { productId: true }, take: 8,
  });
  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGB Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId), source: "manual", discoveryRunId: "rgb_probe" },
  });
  const catB = await prisma.category.create({
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGB Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId), source: "manual", discoveryRunId: "rgb_probe" },
  });
  const answers = (defs) => defs.map(([id, text, target]) => ({
    id, text, tags: [], edge_handle_id: `h_${id}`, ...(target ? { target_id: target } : {}),
  }));
  const doc = {
    quiz_id: QUIZ, status: "draft", scope: { collection_ids: [] }, logic_model: "decider",
    design_tokens: { colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" }, radius: "rounded" },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "RGB Probe", subtext: "Offer check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "What are you shopping for?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "r1", type: "result", position: { x: 0, y: 240 }, data: { headline: "Your match", fallback_collection_id: "manual" } },
    ],
    edges: [
      { id: "e1", source: "intro1", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
    results_pages: [],
    // No email step: the code is earned by reaching the results.
    rec_page_settings: { global: { captureEmail: false }, overrides: {} },
    discount_config: {
      enabled: true, configured: true, kind: "percentage", value: 10, applies_to: "all",
      once_per_customer: true, title: "Wiskr probe offer",
      // An existing code: publish and /offer create NOTHING in Shopify.
      code_mode: "existing", existing_code: CODE, expiry_mode: "none",
    },
    launcher_config: { enabled: true },
    build_session: { stage: "question_builder", built: true },
  };

  // The routed storefront counts as a public address; without this Chromium
  // refuses its requests to the local quiz server (a probe artefact — a real
  // storefront and the deployed app are both public).
  browser = await chromium.launch({
    args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  const builderData = `${BASE}/studio/${QUIZ}?_data=routes%2Fstudio_.%24id`;
  const maxV = await prisma.quizVersion.aggregate({ where: { quizId: QUIZ }, _max: { version: true } });
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: doc, version: Math.max(quiz.version ?? 0, maxV._max.version ?? 0) },
  });
  const pub = await ctx.request.post(builderData, { form: { intent: "publish", doc: JSON.stringify(doc) } });
  ok("existing-code doc publishes", pub.ok(), pub.ok() ? "" : (await pub.text()).slice(0, 200));

  const launcherJs = await (await fetch(`${BASE}/q/${QUIZ}.launcher.js?rgb=${Date.now()}`)).text();
  ok("launcher script is served and carries the cart bridge", launcherJs.includes("qz:add-to-cart:coded"), launcherJs.slice(0, 80));
  try { new Function(launcherJs); ok("launcher script parses", true); } catch (e) { ok("launcher script parses", false, String(e)); }

  // A fake storefront: one HTML page + the AJAX cart, all answered here.
  const storefront = async (html) => {
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cart = [];
    const leaves = [];
    await sctx.route(`${STORE}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
      cart.push({ path: url.pathname, body: route.request().postDataJSON?.() ?? null });
      const body = url.pathname === "/cart.js" ? { discount_codes: [{ code: "WELCOME", applicable: true }] } : {};
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    // The real store is never reached: a cart-link navigation is recorded and stopped.
    await sctx.route(`https://${shopDomain}/**`, (route) => {
      leaves.push(route.request().url());
      return route.abort();
    });
    const shop = await sctx.newPage();
    shop.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
    shop.on("console", (m) => { if (m.type() === "error") console.log(`  [storefront console] ${m.text().slice(0, 200)}`); });
    shop.on("requestfailed", (r) => console.log(`  [request failed] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
    await shop.goto(`${STORE}/`, { waitUntil: "domcontentloaded" });
    return { sctx, shop, cart, leaves };
  };
  const walkFrame = async (frame) => {
    await frame.getByRole("button", { name: /start/i }).first().click();
    await frame.getByText("A snowboard", { exact: false }).first().click();
    const nextBtn = frame.getByRole("button", { name: "Next" }).first();
    if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click();
    await frame.locator('[data-qz-offer="bar"]').waitFor({ timeout: 20000 });
    return (await frame.locator('[data-qz-offer="bar"] b').innerText()).trim();
  };

  // ── 1 · the real launcher script on the storefront ────────────────────────
  {
    const { sctx, shop, cart, leaves } = await storefront(
      `<!doctype html><title>Store</title><h1>Storefront</h1><script src="${BASE}/q/${QUIZ}.launcher.js?rgb=${Date.now()}"></script>`,
    );
    await shop.locator(".qz-launcher-btn").click({ timeout: 8000 });
    const frame = shop.frameLocator(".qz-launcher-frame");
    const code = await walkFrame(frame);
    ok("launcher: the offer bar shows the existing code", code === CODE, code);
    await frame.getByRole("button", { name: /add to cart/i }).first().click();
    await shop.waitForTimeout(2200); // past the quiz's 1200 ms fallback window
    const paths = cart.map((c) => c.path);
    ok("launcher: storefront adds, reads the cart, then sets the codes",
      JSON.stringify(paths) === JSON.stringify(["/cart/add.js", "/cart.js", "/cart/update.js"]), JSON.stringify(paths));
    ok("launcher: one variant, quantity 1", cart[0]?.body?.items?.length === 1 && cart[0].body.items[0].quantity === 1,
      JSON.stringify(cart[0]?.body));
    ok("launcher: the cart keeps its old code and gains the shopper's",
      cart[2]?.body?.discount === `WELCOME,${CODE}`, JSON.stringify(cart[2]?.body));
    ok("launcher: the shopper stays in the quiz (no cart-link navigation)", leaves.length === 0, leaves.join(" "));
    ok("launcher: the pop-up is still open on the results",
      (await frame.locator('[data-qz-offer="bar"]').count()) === 1 && shop.url() === `${STORE}/`);
    await shop.screenshot({ path: `${SHOTS}/launcher-added.png` });
    await sctx.close();
  }

  // ── 2 · a storefront with no listener (an old theme block) ────────────────
  {
    const { sctx, shop, cart, leaves } = await storefront(
      `<!doctype html><title>Store</title><iframe id="f" src="${BASE}/q/${QUIZ}?rgb=${Date.now()}" style="width:100%;height:860px;border:0"></iframe>`,
    );
    const frame = shop.frameLocator("#f");
    const code = await walkFrame(frame);
    await frame.getByRole("button", { name: /add to cart/i }).first().click();
    await shop.waitForTimeout(2200);
    ok("no listener: nothing is added through the AJAX cart", cart.length === 0, JSON.stringify(cart.map((c) => c.path)));
    ok("no listener: falls back to the cart link that carries the code",
      leaves.length === 1 && /\/cart\/\d+:1\?discount=/.test(leaves[0]) && leaves[0].endsWith(`discount=${encodeURIComponent(code)}`),
      leaves.join(" "));
    await sctx.close();
  }
  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
} finally {
  // ── restore ───────────────────────────────────────────────────────────────
  if (seeded) {
    await prisma.quiz.update({
      where: { id: QUIZ },
      data: { draftJson: snap.draftJson, publishedJson: snap.publishedJson, status: snap.status, version: snap.version },
    });
    await prisma.category.deleteMany({ where: { quizId: QUIZ } });
    for (const c of originalCats) {
      const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
      await prisma.category.create({
        data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
      });
    }
    console.log("fixture restored (doc + published + categories)");
  }
  await prisma.$disconnect();
  if (browser) await browser.close();
}
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
process.exit(fails.length ? 1 : 0);
