// L2-10d live-verify — the FUNNEL FLIP end-to-end on the standalone deploy.
// 1. Front door creates a FRESH DECIDER draft (graduating any stuck pre-flip
//    draft first — the flagged cmr3… "typing" strandee gets healed en route).
// 2. Buckets (headless grouping API) → continue-buckets → detached tier-1 AI.
// 3. Shape stage renders the decider UI: 3 cards (Manual hidden), no scoring
//    radios, fixed "Direct mapping" descriptor, Continue enabled immediately.
// 4. Server guards: shape-manual → 400 · shape-continue scoring=weighted → 400.
// 5. LEGACY regression: strip logic_model (builder verbatim PUT) → the SAME
//    stage renders the 4-card Shape with radios → restore the stamp.
// 6. shape-continue (real AI build) → question_builder with a DECIDER doc
//    (one ◆ decides question, every deciding answer mapped, ONE result, no
//    email gate, sparse rec_page_settings) + the Step-3 decider UI.
// 7. to-rec-page → the v2 panel's Contact-capture toggles (the L2-10b walk
//    that was data-gated) — click Phone → stored sparse → click off.
// 8. Publish → /q shopper walk: questions → capture → loading → reveal.
// 9. Legacy /q.json byte baseline re-probe.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
const legacyBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());

const funnelData = (id) => `${BASE}/studio/onboarding/${id}?_data=routes%2Fstudio.onboarding_.%24quizId`;
const builderData = (id) => `${BASE}/studio/${id}?_data=routes%2Fstudio_.%24id`;
const readFunnel = async (id) => (await ctx.request.get(funnelData(id))).json();
const readBuilder = async (id) => (await ctx.request.get(builderData(id))).json();
const postIntent = (id, form) => ctx.request.post(funnelData(id), { form });

// ── 1. front door → a FRESH decider draft (graduate strandees) ──────────────
let draftId = null;
for (let i = 0; i < 4 && !draftId; i++) {
  const resp = await ctx.request.get(`${BASE}/studio/onboarding`);
  const id = new URL(resp.url()).pathname.split("/").pop();
  const fd = await readFunnel(id).catch(() => null);
  if (fd?.logicModel === "decider" && fd?.stage === "grouping") { draftId = id; break; }
  // A pre-flip legacy strandee (the flagged cmr3… class) — graduate it via the
  // builder's verbatim PUT so the front door seeds fresh next round.
  console.log(`… graduating in-flight draft ${id} (stage ${fd?.stage}, logicModel ${fd?.logicModel ?? "null"})`);
  const loaded = await readBuilder(id);
  await ctx.request.put(builderData(id), {
    headers: { "content-type": "application/json" },
    data: { doc: { ...loaded.doc, build_session: { ...(loaded.doc.build_session ?? {}), stage: "done", built: true } } },
  });
}
ok("front door created a FRESH DECIDER draft (stamp at creation)", Boolean(draftId), draftId ?? "none after 4 rounds");
if (!draftId) { await browser.close(); process.exit(1); }

// ── 2. buckets + continue-buckets → detached tier-1 AI ──────────────────────
const bLoaded = await readBuilder(draftId);
const products = (bLoaded.productIndex ?? []).map((p) => p.product_id).filter(Boolean);
ok("catalog has products for buckets", products.length >= 6, `${products.length}`);
const groupResp = await ctx.request.post(`${BASE}/api/categories/group`, {
  headers: { "content-type": "application/json" },
  data: {
    source: "manual",
    quizId: draftId,
    groups: [
      { name: "L2-10d Boards", productIds: products.slice(0, 4) },
      { name: "L2-10d Accessories", productIds: products.slice(4, 6) },
    ],
  },
});
const cats = (await groupResp.json().catch(() => ({}))).categories ?? [];
ok("2 buckets persisted", cats.length === 2, `${cats.length}`);

const cbResp = await postIntent(draftId, { intent: "continue-buckets" });
ok("continue-buckets accepted (goal auto-suggested, typing kicked)", cbResp.ok());

let fd = null;
for (let i = 0; i < 40; i++) {
  await sleep(5000);
  fd = await readFunnel(draftId);
  if (fd.stage === "types" || fd.genError) break;
}
ok("tier-1 types generated (typing → types)", fd?.stage === "types", `stage=${fd?.stage} genError=${fd?.genError ?? ""}`);
if (fd?.stage !== "types") { await browser.close(); process.exit(1); }
const typeId = fd.quizTypes?.[0]?.id;
ok("have an AI type to pick", Boolean(typeId), fd.quizTypes?.[0]?.name);

// ── 3. Shape stage — decider UI ──────────────────────────────────────────────
const funnelUrl = `${BASE}/studio/onboarding/${draftId}`;
await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
ok("Shape heading renders", await page.getByText("Shape your quiz").first().isVisible().catch(() => false));
ok("Manual card HIDDEN for decider", !(await page.getByText("Manual create").first().isVisible().catch(() => false)));
ok("saved-templates row HIDDEN for decider", !(await page.getByText("saved template", { exact: false }).first().isVisible().catch(() => false)));
ok("Write-your-goal card kept", await page.getByText("Write your goal", { exact: false }).first().isVisible().catch(() => false));
await page.getByRole("button", { name: "Use this type →" }).first().click();
await page.waitForTimeout(400);
ok("fixed 'Direct mapping' descriptor (no scoring picker)", await page.getByText("One question decides the result", { exact: false }).first().isVisible().catch(() => false));
ok("zero scoring radios in the expanded card", (await page.locator('input[type="radio"]').count()) === 0);
const continueBtn = page.getByRole("button", { name: "Continue →" }).first();
ok("Continue enabled WITHOUT picking a scoring model", await continueBtn.isEnabled().catch(() => false));
await page.screenshot({ path: "e2e/shots/l2-10d-shape-decider.png" });

// ── 4. server guards (defense-in-depth 400s) ────────────────────────────────
const manResp = await postIntent(draftId, { intent: "shape-manual" });
ok("shape-manual → 400 for decider", manResp.status() === 400, `${manResp.status()}`);
const wResp = await postIntent(draftId, { intent: "shape-continue", typeId, scoring: "weighted" });
ok("shape-continue scoring=weighted → 400 for decider", wResp.status() === 400, `${wResp.status()}`);
const stResp = await postIntent(draftId, { intent: "use-saved-template", templateId: "anything" });
ok("use-saved-template → 400 for decider", stResp.status() === 400, `${stResp.status()}`);

// ── 5. LEGACY regression — strip the stamp, same stage renders 4 cards ──────
const preStrip = (await readBuilder(draftId)).doc;
const { logic_model: _lm, ...legacyDoc } = preStrip;
await ctx.request.put(builderData(draftId), {
  headers: { "content-type": "application/json" },
  data: { doc: legacyDoc },
});
await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
ok("LEGACY: Manual card renders (4-card Shape)", await page.getByText("Manual create").first().isVisible().catch(() => false));
await page.getByRole("button", { name: "Use this type →" }).first().click();
await page.waitForTimeout(400);
ok("LEGACY: scoring radios render", (await page.locator('input[type="radio"]').count()) === 2);
// restore the stamp
await ctx.request.put(builderData(draftId), {
  headers: { "content-type": "application/json" },
  data: { doc: preStrip },
});
const restored = (await readBuilder(draftId)).doc;
ok("stamp restored", restored.logic_model === "decider");

// ── 6. shape-continue → real decider question build ─────────────────────────
const scResp = await postIntent(draftId, { intent: "shape-continue", typeId, scoring: "direct" });
ok("shape-continue (direct) accepted", scResp.ok());
for (let i = 0; i < 60; i++) {
  await sleep(6000);
  fd = await readFunnel(draftId);
  if (fd.stage === "question_builder" || fd.genError) break;
}
ok("question build completed (templating → question_builder)", fd?.stage === "question_builder", `stage=${fd?.stage} genError=${fd?.genError ?? ""}`);
if (fd?.stage !== "question_builder") { await browser.close(); process.exit(1); }

const built = (await readBuilder(draftId)).doc;
const qNodes = built.nodes.filter((n) => n.type === "question");
const deciders = qNodes.filter((n) => n.data.role === "decides");
const resultNodes = built.nodes.filter((n) => n.type === "result");
const gates = built.nodes.filter((n) => n.type === "email_gate");
ok("built doc is a decider doc", built.logic_model === "decider");
ok("EXACTLY ONE deciding question", deciders.length === 1, `${deciders.length} of ${qNodes.length} questions`);
ok("decider is required", deciders[0]?.data.required === true);
ok("every deciding answer has a target (V4 by construction)", (deciders[0]?.data.answers ?? []).every((a) => Boolean(a.target_id)), `${deciders[0]?.data.answers?.length ?? 0} answers`);
ok("ONE result node (the reveal terminus)", resultNodes.length === 1);
ok("result seeds fallback_collection_id (schema-required)", Boolean(resultNodes[0]?.data.fallback_collection_id));
ok("NO email gate (§7 capture owns contact)", gates.length === 0);
ok("rec_page_settings seeded", Boolean(built.rec_page_settings?.global?.emptyFallbackCol));

await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
ok("Step-3 decider badge renders", await page.getByText("Decider logic", { exact: false }).first().isVisible().catch(() => false));
ok("Rules tab renders (decider tabs)", await page.getByRole("button", { name: "Rules" }).first().isVisible().catch(() => false));
await page.screenshot({ path: "e2e/shots/l2-10d-step3-decider.png" });

// ── 7. Step-4 capture toggles (the L2-10b data-gated panel walk) ────────────
const rpResp = await postIntent(draftId, { intent: "to-rec-page" });
ok("to-rec-page accepted", rpResp.ok());
await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
ok("Contact capture section renders", await page.getByText("Contact capture", { exact: false }).first().isVisible().catch(() => false));
const phoneLabel = page.getByText("Phone", { exact: true }).first();
const phoneVisible = await phoneLabel.isVisible().catch(() => false);
ok("Phone toggle renders", phoneVisible);
if (phoneVisible) {
  await phoneLabel.click();
  await page.waitForTimeout(1600); // autosave debounce
  const g1 = (await readBuilder(draftId)).doc.rec_page_settings?.global ?? {};
  ok("Phone toggle stored SPARSE via a REAL click", g1.capturePhone === true && !("captureEmail" in g1), JSON.stringify(g1));
  await phoneLabel.click();
  await page.waitForTimeout(1600);
  const g2 = (await readBuilder(draftId)).doc.rec_page_settings?.global ?? {};
  ok("Phone toggle OFF drops the key", !("capturePhone" in g2), JSON.stringify(g2));
}
await page.screenshot({ path: "e2e/shots/l2-10d-step4-capture.png" });

// ── 8. publish + shopper walk (capture → loading → reveal) ──────────────────
const finalDoc = (await readBuilder(draftId)).doc;
const pubResp = await ctx.request.post(builderData(draftId), {
  form: { intent: "publish", doc: JSON.stringify(finalDoc) },
});
let pubJson = {};
try { pubJson = await pubResp.json(); } catch { /* html */ }
ok("publish succeeds (V-gates + target bake)", pubResp.ok() && pubJson.ok !== false, JSON.stringify(pubJson).slice(0, 140));

const shopper = await ctx.newPage();
shopper.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
await shopper.goto(`${BASE}/q/${draftId}`, { waitUntil: "domcontentloaded" });
await shopper.waitForTimeout(800);
const startBtn = shopper.getByRole("button", { name: /start|begin|get started/i }).first();
if (await startBtn.isVisible().catch(() => false)) await startBtn.click();
// generic walker: click the first answer + Next until capture appears
let captureSeen = false;
for (let step = 0; step < 12; step++) {
  await shopper.waitForTimeout(700);
  if (await shopper.locator('input[type="email"]').first().isVisible().catch(() => false)) { captureSeen = true; break; }
  const answer = shopper.locator('[class*="answer"], .qz-answer, button.qz-chip').first();
  const target = (await answer.count()) ? answer : shopper.getByRole("button").nth(1);
  await target.click({ timeout: 3000 }).catch(() => {});
  const nextBtn = shopper.getByRole("button", { name: "Next" }).first();
  if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click().catch(() => {});
}
ok("live walk reaches the CAPTURE screen", captureSeen);
if (captureSeen) {
  await shopper.locator('input[type="email"]').first().fill("l2-10d@example.com");
  await shopper.getByRole("button", { name: "Continue" }).first().click();
  await shopper.waitForTimeout(3200); // loading interstitial
  const revealText = (await shopper.locator("body").textContent().catch(() => "")) ?? "";
  ok("REVEAL renders (headline + hero badge)", /Your (perfect )?match/i.test(revealText) && /top pick for you/i.test(revealText));
  await shopper.screenshot({ path: "e2e/shots/l2-10d-reveal.png" });
}
await shopper.close();

// graduate the fixture out of the funnel so the front door starts fresh
await postIntent(draftId, { intent: "generate-build" }).catch(() => {});

// ── 9. legacy byte baseline + page errors ───────────────────────────────────
const legacyAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy /q.json BYTE-IDENTICAL", legacyAfter === legacyBefore, `sha ${legacyAfter}`);
ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\nfixture quiz: ${draftId}`);
console.log(`${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
