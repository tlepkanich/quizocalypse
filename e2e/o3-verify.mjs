// O-3 live-verify — decider-native saved templates on the standalone deploy.
// 1. Front door → fresh DECIDER draft → 2 buckets → tier-1 AI → stage "types".
// 2. Guards at types: shape-manual 400 · weighted 400 · back-to-configuring 400
//    (NEW) · use-saved-template bogus id 400 (not-found).
// 3. LEGACY regression on the SAME draft: strip the stamp → use-saved-template
//    (real id) → stage lands "configuring" (battle card unchanged) → restore.
// 4. THE HEADLINE: real click on the saved-template pill on the decider Shape
//    page → stage templating (bucket ids neutralized, groups all enabled,
//    scoring direct, picked_type_id cleared) → question build completes →
//    Questions & Logic with a valid decider doc bound to the seeded buckets.
// 5. retry-gen backstop: park templating again → retry-gen re-kicks (was 400).
// 6. Graduate + legacy /q.json byte baseline.
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
const putDoc = (id, doc) =>
  ctx.request.put(builderData(id), { headers: { "content-type": "application/json" }, data: { doc } });

// ── 1. fresh decider draft → buckets → tier-1 ───────────────────────────────
let draftId = null;
for (let i = 0; i < 4 && !draftId; i++) {
  const resp = await ctx.request.get(`${BASE}/studio/onboarding`);
  const id = new URL(resp.url()).pathname.split("/").pop();
  const fd0 = await readFunnel(id).catch(() => null);
  if (fd0?.logicModel === "decider" && fd0?.stage === "grouping") { draftId = id; break; }
  console.log(`… graduating in-flight draft ${id} (stage ${fd0?.stage})`);
  const loaded = await readBuilder(id);
  await putDoc(id, { ...loaded.doc, build_session: { ...(loaded.doc.build_session ?? {}), stage: "done", built: true } });
}
ok("front door created a fresh decider draft", Boolean(draftId), draftId ?? "none");
if (!draftId) { await browser.close(); process.exit(1); }

const bLoaded = await readBuilder(draftId);
const products = (bLoaded.productIndex ?? []).map((p) => p.product_id).filter(Boolean);
const groupResp = await ctx.request.post(`${BASE}/api/categories/group`, {
  headers: { "content-type": "application/json" },
  data: {
    source: "manual",
    quizId: draftId,
    groups: [
      { name: "O3 Boards", productIds: products.slice(0, 4) },
      { name: "O3 Accessories", productIds: products.slice(4, 6) },
    ],
  },
});
const cats = (await groupResp.json().catch(() => ({}))).categories ?? [];
const catIds = new Set(cats.map((c) => c.id));
ok("2 buckets persisted", cats.length === 2, cats.map((c) => c.name).join(", "));
await postIntent(draftId, { intent: "continue-buckets" });

let fd = null;
for (let i = 0; i < 40; i++) {
  await sleep(5000);
  fd = await readFunnel(draftId);
  if (fd.stage === "types" || fd.genError) break;
}
ok("tier-1 done (stage types)", fd?.stage === "types", `stage=${fd?.stage} genError=${fd?.genError ?? ""}`);
if (fd?.stage !== "types") { await browser.close(); process.exit(1); }

// Self-seed a saved template through the REAL save-template intent (the shop
// lost the T9-era fixture; the probe must not be fixture-dependent). The
// recommended_bucket_ids are DELIBERATELY stale cuids — the exact condition
// the O-3 neutralization exists for (they match nothing on this draft).
const SEED_NAME = "O3 Probe Terrain Finder";
if (!(fd.savedTemplates ?? []).some((s) => s.name === SEED_NAME)) {
  const synthRich = {
    id: "o3-probe-template",
    experience_type: "product_match",
    title: SEED_NAME,
    angle: "Probe-seeded template exercising the decider saved-template path.",
    rationale: "",
    sample_questions: ["Where do you ride most?", "What matters most in a board?"],
    feature_notes: ["Probe-seeded"],
    dials: { imagery: "medium", graphics: "medium", word_forward: "medium", lines: "sharp" },
    rec_defaults: { max_products: 4, oos_behavior: "show_with_badge", fallback_collection_id: "" },
    recommended_bucket_ids: ["stale-cuid-1", "stale-cuid-2"],
    question_count: 5,
  };
  const synthPicked = {
    template_id: synthRich.id,
    quiz_name: SEED_NAME,
    design_dials: synthRich.dials,
    rec_defaults: synthRich.rec_defaults,
    recommended_groups: [],
    feature_notes: synthRich.feature_notes,
    question_count: 5,
    goal_line: "",
    saved_as_template: false,
  };
  const seedSnap = (await readBuilder(draftId)).doc;
  await putDoc(draftId, {
    ...seedSnap,
    build_session: { ...(seedSnap.build_session ?? {}), rich_templates: [synthRich], picked_template: synthPicked },
  });
  const saveResp = await postIntent(draftId, { intent: "save-template" });
  ok("probe seeded a saved template via the REAL save-template intent", saveResp.ok(), `${saveResp.status()}`);
  await putDoc(draftId, seedSnap); // restore the session (drop the synthetic bits)
  fd = await readFunnel(draftId);
}
const saved = fd.savedTemplates ?? [];
const st = saved.find((s) => s.name === SEED_NAME) ?? saved[0];
ok("saved template available", Boolean(st), st?.name ?? "NONE");
if (!st) { await browser.close(); process.exit(1); }

// ── 2. guards at types ───────────────────────────────────────────────────────
ok("shape-manual → 400", (await postIntent(draftId, { intent: "shape-manual" })).status() === 400);
ok("shape-continue weighted → 400", (await postIntent(draftId, { intent: "shape-continue", typeId: fd.quizTypes?.[0]?.id ?? "x", scoring: "weighted" })).status() === 400);
ok("back-to-configuring → 400 (NEW O-3 guard)", (await postIntent(draftId, { intent: "back-to-configuring" })).status() === 400);
ok("use-saved-template bogus id → 400 (not-found)", (await postIntent(draftId, { intent: "use-saved-template", templateId: "bogus" })).status() === 400);

// ── 3. LEGACY regression on the same draft (strip → use → configuring → restore)
const snapshot = (await readBuilder(draftId)).doc;
const { logic_model: _lm, ...legacyDoc } = snapshot;
await putDoc(draftId, legacyDoc);
const legacyUse = await postIntent(draftId, { intent: "use-saved-template", templateId: st.id });
ok("LEGACY use-saved-template accepted", legacyUse.ok());
const legacyFd = await readFunnel(draftId);
ok("LEGACY lands on the battle card (stage configuring — unchanged)", legacyFd.stage === "configuring", `stage=${legacyFd.stage}`);
await putDoc(draftId, snapshot); // restore stamp + stage "types"
ok("restored to decider @ types", (await readFunnel(draftId)).stage === "types" && (await readBuilder(draftId)).doc.logic_model === "decider");

// ── 4. THE HEADLINE — real click on the pill, decider path ──────────────────
const funnelUrl = `${BASE}/studio/onboarding/${draftId}`;
await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
ok("saved-templates row VISIBLE on the decider Shape page", await page.getByText("Or reuse a saved template").first().isVisible().catch(() => false));
ok("decider copy renders (straight to Questions & Logic)", await page.getByText("take you straight to Questions", { exact: false }).first().isVisible().catch(() => false));
await page.screenshot({ path: "e2e/shots/o3-shape-row.png" });
await page.getByRole("button", { name: st.name, exact: false }).first().click();
await page.waitForTimeout(2500);

fd = await readFunnel(draftId);
ok("pill click → stage templating (build kicked)", fd.stage === "templating", `stage=${fd.stage}`);
const midSession = (await readBuilder(draftId)).doc.build_session ?? {};
const midDoc = (await readBuilder(draftId)).doc;
ok("rich seeded with recommended_bucket_ids NEUTRALIZED", (midSession.rich_templates?.[0]?.recommended_bucket_ids ?? ["x"]).length === 0);
ok("ALL confirmed groups enabled in the working copy", (midSession.picked_template?.recommended_groups ?? []).length === 2 && midSession.picked_template.recommended_groups.every((g) => g.enabled === true), JSON.stringify(midSession.picked_template?.recommended_groups?.map((g) => ({ id: g.group_id, on: g.enabled }))));
ok("scoring_model direct on the doc", midDoc.scoring_model === "direct");
ok("picked_type_id CLEARED (retry-gen takes the template fallback)", !("picked_type_id" in midSession) || midSession.picked_type_id === undefined);

for (let i = 0; i < 60; i++) {
  await sleep(6000);
  fd = await readFunnel(draftId);
  if (fd.stage === "question_builder" || fd.genError) break;
}
ok("question build completed → Questions & Logic", fd?.stage === "question_builder", `stage=${fd?.stage} genError=${fd?.genError ?? ""}`);
if (fd?.stage !== "question_builder") { await browser.close(); process.exit(1); }

const built = (await readBuilder(draftId)).doc;
const qNodes = built.nodes.filter((n) => n.type === "question");
const deciders = qNodes.filter((n) => n.data.role === "decides");
const resultNodes = built.nodes.filter((n) => n.type === "result");
ok("built doc is a decider doc", built.logic_model === "decider");
ok("EXACTLY ONE deciding question", deciders.length === 1, `${deciders.length} of ${qNodes.length}`);
ok("every deciding answer targets a SEEDED bucket (preResolvedBuckets honored)", (deciders[0]?.data.answers ?? []).every((a) => catIds.has(a.target_id)), `${deciders[0]?.data.answers?.length ?? 0} answers → {${[...catIds].join(",")}}`);
ok("ONE result node w/ fallback_collection_id", resultNodes.length === 1 && Boolean(resultNodes[0]?.data.fallback_collection_id));
ok("NO email gate", built.nodes.filter((n) => n.type === "email_gate").length === 0);
ok("rec_page_settings seeded (emptyFallbackCol)", Boolean(built.rec_page_settings?.global?.emptyFallbackCol));
const pickedName = ((await readBuilder(draftId)).doc.build_session?.picked_template?.quiz_name) ?? "";
ok("working copy auto-named from the template title", pickedName.includes((st.template?.title ?? st.name).split(" ")[0]), pickedName);
await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
ok("Step-3 decider UI renders (◆ badge)", await page.getByText("Decider logic", { exact: false }).first().isVisible().catch(() => false));
await page.screenshot({ path: "e2e/shots/o3-questions-logic.png" });

// ── 5. retry-gen backstop (deterministic: park templating, re-kick) ─────────
const parked = (await readBuilder(draftId)).doc;
await putDoc(draftId, { ...parked, build_session: { ...(parked.build_session ?? {}), stage: "templating", built: false } });
const retryResp = await postIntent(draftId, { intent: "retry-gen" });
ok("retry-gen re-kicks the saved-template build (was 400 pre-O-3)", retryResp.ok(), `${retryResp.status()}`);
for (let i = 0; i < 60; i++) {
  await sleep(6000);
  fd = await readFunnel(draftId);
  if (fd.stage === "question_builder" || fd.genError) break;
}
ok("retry build completed", fd?.stage === "question_builder", `stage=${fd?.stage} genError=${fd?.genError ?? ""}`);

// ── 6. graduate + baseline ───────────────────────────────────────────────────
await postIntent(draftId, { intent: "generate-build" }).catch(() => {});
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
