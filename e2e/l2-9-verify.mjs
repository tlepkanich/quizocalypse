// L2-9 live-verify — RUNTIME CUTOVER on the standalone studio deploy.
// 1. Pins the legacy /q.json byte-baseline (dual-model invariant).
// 2. Seeds a FRESH funnel draft via the real front door (the app graduates any
//    finished probe drafts itself — its designed self-heal), creates two
//    quiz-scoped targets via the manual grouping API, publishes a minimal
//    decider doc through the REAL publish intent (bake + V-gates included),
//    then WALKS /q end-to-end: intro → decider answer → §7.1 capture (email
//    mandatory, no skip) → §7 loading interstitial → reveal (hero badge +
//    grid + defaults headline), sniffing /captures + /sessions + /events.
// 3. Re-diffs the legacy /q.json byte-baseline after the walk.
// The published smoke quiz REMAINS on the deploy as the program's live decider
// fixture (named "L2-9 decider smoke") — deliberate, for L2-10..12 verification.
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const LEGACY = "cmqqcb0ao004mqvkwjug7t0ya"; // the byte-pinned published legacy quiz

const out = { checks: {}, pageErrors: [], net: { captures: [], sessions: [], events: [] } };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));

// ── auth ─────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

// ── 1. legacy byte-baseline ─────────────────────────────────────────────────
const legacyBefore = await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text();
const shaBefore = sha(legacyBefore);
console.log(`legacy /q.json sha (before walk): ${shaBefore} (${legacyBefore.length} bytes)`);

// ── 2. fresh funnel draft via the real front door ───────────────────────────
const resp = await ctx.request.get(`${BASE}/studio/onboarding`, { maxRedirects: 5 });
const landedUrl = resp.url();
const quizId = (landedUrl.match(/onboarding\/([a-z0-9]+)/) ?? [])[1];
console.log(`front door landed: ${landedUrl} → quiz ${quizId}`);

const funnelData = `${BASE}/studio/onboarding/${quizId}?_data=routes%2Fstudio.onboarding_.%24quizId`;
const funnelJson = await (await ctx.request.get(funnelData)).json();
const isFresh = funnelJson.name === "New quiz" && funnelJson.stage === "grouping";
ok("fresh grouping draft seeded (not a hijacked in-flight draft)", isFresh, `name=${funnelJson.name} stage=${funnelJson.stage}`);
if (!isFresh) {
  console.log("ABORT: front door resumed an existing mid-funnel draft — refusing to hijack it.");
  await browser.close();
  process.exit(1);
}

// product ids for targets — from the grouping stage's catalog payload.
const products = (funnelJson.catalog?.products ?? []).map((p) => p.productId ?? p.id).filter(Boolean);
ok("catalog has products for targets", products.length >= 6, `${products.length} products`);

// ── 3. quiz-scoped targets via the manual grouping API ─────────────────────
const groupResp = await ctx.request.post(`${BASE}/api/categories/group`, {
  headers: { "content-type": "application/json" },
  data: {
    source: "manual",
    quizId,
    groups: [
      { name: "L2-9 Boards", productIds: products.slice(0, 4) },
      { name: "L2-9 Accessories", productIds: products.slice(4, 6) },
    ],
  },
});
const groupJson = await groupResp.json();
const cats = groupJson.categories ?? groupJson.rows ?? [];
ok("manual grouping created 2 quiz-scoped targets", groupResp.ok() && cats.length === 2, JSON.stringify(cats.map((c) => c.id)));
const [catA, catB] = cats;

// ── 4. publish a minimal decider doc through the REAL publish intent ───────
const doc = {
  quiz_id: quizId,
  status: "draft",
  scope: { collection_ids: [] },
  logic_model: "decider",
  nodes: [
    {
      id: "intro1",
      type: "intro",
      position: { x: 0, y: 0 },
      data: { headline: "Find your setup", subtext: "Two quick taps.", cta_label: "Start" },
    },
    {
      id: "q1",
      type: "question",
      position: { x: 0, y: 120 },
      data: {
        text: "What are you shopping for?",
        question_type: "single_select",
        role: "decides",
        required: true,
        answers: [
          { id: "a_boards", text: "A snowboard", tags: [], edge_handle_id: "h_boards", target_id: catA.id },
          { id: "a_acc", text: "Accessories", tags: [], edge_handle_id: "h_acc", target_id: catB.id },
        ],
      },
    },
    {
      id: "r1",
      type: "result",
      position: { x: 0, y: 240 },
      data: { headline: "Your match" },
    },
  ],
  edges: [
    { id: "e1", source: "intro1", target: "q1" },
    { id: "e2", source: "q1", target: "r1" },
  ],
  results_pages: [],
  // Sparse settings → read-time defaults: captureEmail ON, gridMax 3,
  // headline "Your perfect match", heroLogic collection_order.
  rec_page_settings: { global: {}, overrides: {} },
  // Mark the funnel session finished so the front door graduates (never
  // resumes) this smoke quiz on the owner's next visit.
  build_session: { stage: "done", built: true },
};

const builderData = `${BASE}/studio/${quizId}?_data=routes%2Fstudio_.%24id`;
const renameResp = await ctx.request.post(builderData, { form: { intent: "rename", name: "L2-9 decider smoke" } });
ok("renamed to 'L2-9 decider smoke'", renameResp.ok());

const pubResp = await ctx.request.post(builderData, {
  form: { intent: "publish", doc: JSON.stringify(doc) },
});
let pubJson = {};
try { pubJson = await pubResp.json(); } catch { /* html error page */ }
ok("publish succeeded (bake + V1–V6 gates)", pubResp.ok() && pubJson.ok !== false, JSON.stringify(pubJson).slice(0, 160));

// confirm the decider model landed on the public wire (the target map itself
// is loader-internal — the runtime walk below is its proof).
const pubWireText = await (await ctx.request.get(`${BASE}/q/${quizId}.json`)).text();
ok("published wire carries logic_model=decider", pubWireText.includes('"logic_model":"decider"'));

// ── 5. walk /q: intro → decider → capture → loading → reveal ────────────────
page.on("request", (r) => {
  const u = r.url();
  if (r.method() !== "POST") return;
  if (u.endsWith("/captures")) out.net.captures.push(r.postData()?.slice(0, 300));
  if (u.endsWith("/sessions")) out.net.sessions.push(r.postData()?.slice(0, 400));
  if (u.endsWith("/events")) out.net.events.push(r.postData()?.slice(0, 600));
});

await page.goto(`${BASE}/q/${quizId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
ok("intro renders", await page.getByText("Find your setup").isVisible());
// Minimal chrome may relabel the intro CTA — click the named button if
// present, else the first visible button on the intro.
const startBtn = page.getByRole("button", { name: /start/i }).first();
if (await startBtn.isVisible().catch(() => false)) await startBtn.click();
else await page.locator("button:visible").first().click();
await page.waitForTimeout(400);

ok("decider question renders", await page.getByText("What are you shopping for?").isVisible());
await page.getByText("A snowboard", { exact: false }).first().click();
// minimal chrome = select-then-Next; classic auto-advances. Handle both.
const nextBtn = page.getByRole("button", { name: "Next" });
if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click();
await page.waitForTimeout(600);

// §7.1 capture — email mandatory, NO skip affordance
const captureHead = await page.getByText("Your results are ready").isVisible().catch(() => false);
ok("capture screen renders (capture_headline)", captureHead);
ok("capture has NO skip link (email mandatory)", !(await page.getByText("Skip", { exact: true }).isVisible().catch(() => false)));
const emailInput = page.locator('input[type="email"]');
ok("email input present", await emailInput.isVisible().catch(() => false));
// Continue disabled until a valid email
const contBtn = page.getByRole("button", { name: "Continue" });
ok("Continue disabled before email", await contBtn.isDisabled().catch(() => false));
await emailInput.fill("l2-9-smoke@example.com");
await contBtn.click();

// §7 loading interstitial (~1.6s, role=status spinner)
const loading = await page.getByRole("status").isVisible().catch(() => false);
ok("loading interstitial renders (role=status)", loading);
await page.waitForTimeout(2200);

// reveal — defaults headline + hero badge + product cards
ok("reveal headline (spec default 'Your perfect match')", await page.getByText("Your perfect match").isVisible().catch(() => false));
ok("hero badge renders", await page.getByText("Our top pick for you", { exact: false }).isVisible().catch(() => false));
const cardImgsOrTitles = await page.locator("img[loading='lazy'], a:has-text('Shop now'), button:has-text('Add to cart')").count();
ok("product card(s) render", cardImgsOrTitles > 0, `${cardImgsOrTitles} card affordances`);
await page.screenshot({ path: "e2e/shots/l2-9-reveal.png", fullPage: true });

// give beacons a moment, then check the network sniffs
await page.waitForTimeout(1500);
ok("capture POSTed to /captures", out.net.captures.length > 0, out.net.captures[0] ?? "");
ok("session POSTed to /sessions", out.net.sessions.length > 0, out.net.sessions[0] ?? "");
const eventsBlob = out.net.events.join(" ");
ok("recommendation_viewed carries resolved_target_id", eventsBlob.includes("resolved_target_id"), "");
ok("zero page errors (#418/#425/#423)", out.pageErrors.length === 0, out.pageErrors.join(" | "));

// ── 6. legacy byte-diff after the walk ──────────────────────────────────────
const legacyAfter = await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text();
ok("legacy /q.json BYTE-IDENTICAL", sha(legacyAfter) === shaBefore, `sha ${sha(legacyAfter)}`);

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
