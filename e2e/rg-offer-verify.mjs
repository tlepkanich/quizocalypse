// Results handoff §12 live-verify — the per-shopper offer on /q, against the
// REAL Shopify dev store. Against a LOCAL prod build (BASE): seed the local
// fixture with a decider doc whose discount_config is a configured 10%
// per-shopper discount, publish via the real intent, walk /q TWICE and assert:
// the offer bar shows the terms and a code, the code rides the cart link, the
// code is absent from the public quiz file, two shoppers get two codes under
// ONE Shopify discount (create, then bulk add), and Shopify reports that
// discount ACTIVE with our tags and end time. Restores the fixture
// byte-for-byte. LEAVES the discount in the store (tag `wiskr-quiz`) and its
// local QuizOffer* rows, so the owner can inspect it.
//
// CREATES A REAL DISCOUNT — run only with the owner's approval.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/rgo-shots";
const API_VERSION = "2026-04";
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
const admin = await prisma.session.findFirst({ where: { shop: shopDomain, isOnline: false } });
if (!admin?.accessToken) { console.error(`no offline Shopify session for ${shopDomain}`); process.exit(1); }
const snap = { draftJson: quiz.draftJson, publishedJson: quiz.publishedJson, status: quiz.status, version: quiz.version };
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(`${SHOTS}/rgo-backup.json`, JSON.stringify({ ...snap, categories: originalCats }));
console.log(`snapshot written (${originalCats.length} categories) — store ${shopDomain}`);

const shopifyRead = async (query, variables) => {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": admin.accessToken },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
};

let browser = null;
let seeded = false;
try {
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId }, select: { productId: true }, take: 8,
  });
  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGO Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId), source: "manual", discoveryRunId: "rgo_probe" },
  });
  const catB = await prisma.category.create({
    data: { shopId: quiz.shopId, quizId: QUIZ, name: "RGO Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId), source: "manual", discoveryRunId: "rgo_probe" },
  });
  const answers = (defs) => defs.map(([id, text, target]) => ({
    id, text, tags: [], edge_handle_id: `h_${id}`, ...(target ? { target_id: target } : {}),
  }));
  const grantsBefore = await prisma.quizOfferGrant.count({ where: { quizId: QUIZ } });
  const doc = {
    quiz_id: QUIZ, status: "draft", scope: { collection_ids: [] }, logic_model: "decider",
    design_tokens: { colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" }, radius: "rounded" },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "RGO Probe", subtext: "Offer check.", button_label: "Start" } },
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
      code_mode: "dynamic", code_prefix: "RGO-", expiry_mode: "hours", expiry_hours: 24,
    },
    build_session: { stage: "question_builder", built: true },
  };

  browser = await chromium.launch();
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
  ok("offer doc publishes", pub.ok(), pub.ok() ? "" : (await pub.text()).slice(0, 200));

  // A fresh browser context per shopper = a fresh quiz session.
  const walk = async (label) => {
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const shopper = await sctx.newPage();
    shopper.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
    const offerCalls = [];
    shopper.on("response", async (r) => {
      if (r.url().endsWith("/offer") && r.request().method() === "POST") {
        offerCalls.push({ status: r.status(), body: await r.json().catch(() => null) });
      }
    });
    await shopper.goto(`${BASE}/q/${QUIZ}?rgo=${Math.random().toString(36).slice(2)}`, { waitUntil: "domcontentloaded" });
    await shopper.getByRole("button", { name: /start/i }).first().click();
    await shopper.getByText("A snowboard", { exact: false }).first().click();
    const nextBtn = shopper.getByRole("button", { name: "Next" }).first();
    if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click();
    // The first shopper waits on a real discount create; the second on a bulk add.
    const bar = shopper.locator('[data-qz-offer="bar"]');
    await bar.waitFor({ timeout: 30000 }).catch(() => {});
    const shown = (await bar.count()) > 0;
    const text = shown ? await bar.innerText() : "";
    const code = shown ? (await bar.locator("b").innerText()).trim() : "";
    await shopper.screenshot({ path: `${SHOTS}/offer-${label}.png`, fullPage: true });
    // "Add to cart" navigates to the store's cart permalink. Catch the URL and
    // stop the request: the probe never touches the storefront.
    let cartUrl = "";
    await shopper.route(`https://${shopDomain}/**`, (route) => {
      cartUrl = route.request().url();
      return route.abort();
    });
    await shopper.getByRole("button", { name: /add to cart/i }).first().click().catch(() => {});
    await shopper.waitForTimeout(800);
    await sctx.close();
    return { shown, text, code, cartUrl, offerCalls };
  };

  const first = await walk("first");
  ok("shopper 1: offer bar shows", first.shown, JSON.stringify(first.offerCalls).slice(0, 300));
  ok("shopper 1: bar states the terms", /10% off your order/.test(first.text) && /expires in 24h/.test(first.text), first.text);
  // A rerun inside the same hour reuses pooled codes from the earlier run.
  ok("shopper 1: code has the merchant's prefix", /^RGO-?[A-Z0-9]{8}$/.test(first.code), first.code);
  ok("shopper 1: /offer answered 200 with an end time",
    first.offerCalls.some((c) => c.status === 200 && c.body?.offer?.code === first.code && Boolean(c.body.offer.ends_at)));
  ok("shopper 1: Add to cart goes to the cart link with the code",
    /\/cart\/\d+:1\?discount=/.test(first.cartUrl) && first.cartUrl.endsWith(`discount=${encodeURIComponent(first.code)}`),
    first.cartUrl);

  const second = await walk("second");
  ok("shopper 2: offer bar shows", second.shown, JSON.stringify(second.offerCalls).slice(0, 300));
  ok("shopper 2: a different code", second.shown && second.code !== first.code, `${first.code} vs ${second.code}`);

  // ── the public file never carries a code ──────────────────────────────────
  const pubJson = await (await fetch(`${BASE}/q/${QUIZ}.json?rgo=${Date.now()}`)).text();
  ok("public quiz file carries no issued code", !pubJson.includes(first.code) && !(second.code && pubJson.includes(second.code)));

  // ── our records ───────────────────────────────────────────────────────────
  const discounts = await prisma.quizOfferDiscount.findMany({ where: { quizId: QUIZ }, include: { codes: true } });
  const grants = await prisma.quizOfferGrant.findMany({ where: { quizId: QUIZ }, include: { code: true } });
  ok("ONE Shopify discount for both shoppers", discounts.length === 1 && Boolean(discounts[0].shopifyDiscountId), `${discounts.length} discounts`);
  ok("two new grants, every grant a distinct code",
    grants.length === grantsBefore + 2 && new Set(grants.map((g) => g.codeId)).size === grants.length);
  const pool = discounts[0]?.codes ?? [];
  ok("pool: one assigned code per grant, the rest available",
    pool.filter((c) => c.status === "assigned").length === grants.length &&
      pool.filter((c) => c.status === "available").length === pool.length - grants.length,
    `${pool.length} codes`);

  // ── what Shopify says ─────────────────────────────────────────────────────
  const lookup = async (code) =>
    shopifyRead(
      `query($code: String!) { codeDiscountNodeByCode(code: $code) { id codeDiscount { __typename
         ... on DiscountCodeBasic { title status endsAt appliesOncePerCustomer usageLimit codesCount { count }
           customerGets { value { ... on DiscountPercentage { percentage } } items { __typename } } } } } }`,
      { code },
    );
  const s1 = (await lookup(first.code))?.data?.codeDiscountNodeByCode;
  const s2 = second.code ? (await lookup(second.code))?.data?.codeDiscountNodeByCode : null;
  const d = s1?.codeDiscount;
  ok("Shopify: code 1 resolves to our discount", s1?.id === discounts[0]?.shopifyDiscountId, s1?.id);
  ok("Shopify: code 2 resolves to the SAME discount", Boolean(s2?.id) && s2.id === s1?.id);
  ok("Shopify: discount is ACTIVE", d?.status === "ACTIVE", d?.status);
  ok("Shopify: 10% off the whole order", d?.customerGets?.value?.percentage === 0.1 && d?.customerGets?.items?.__typename === "AllDiscountItems",
    JSON.stringify(d?.customerGets));
  ok("Shopify: end time matches the bucket",
    Boolean(d?.endsAt) && new Date(d.endsAt).getTime() === discounts[0]?.endsAt?.getTime(), d?.endsAt);
  ok("Shopify: code count matches our pool", d?.codesCount?.count === pool.length, `${d?.codesCount?.count} vs ${pool.length}`);
  ok("Shopify: no shared usage cap on the discount", d?.usageLimit == null, String(d?.usageLimit));
  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
  console.log(`\nleft in the store: discount ${s1?.id ?? "?"} "${d?.title ?? "?"}" (tag wiskr-quiz), ${pool.length} codes`);
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
    console.log("fixture restored (doc + published + categories); offer rows kept");
  }
  await prisma.$disconnect();
  if (browser) await browser.close();
}
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
process.exit(fails.length ? 1 : 0);
