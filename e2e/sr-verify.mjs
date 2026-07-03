// Start-routing spec live-verify (quiz-start-routing-design-system-spec, Polaris
// design skipped — qz system retained) on the standalone deploy.
//   §1 intercept modal: decider Recommendations "Continue" opens the modal (does
//      NOT submit continue-buckets); three routes present; Esc dismisses; the
//      "Build from a blank quiz" tertiary → manual-build.
//   §1.2 manual-build: no AI → a valid decider skeleton (ONE result node w/ a
//      non-empty fallback, built:true, scoring_model direct) at question_builder;
//      quiz_types cleared (§3 marker).
//   §2 DeciderShapeStage (seeded to stage=types + 2 quiz_types, AI-free): the
//      provenance banner with REAL counts, exactly two live template cards, the
//      escape links, and the tappable TemplatePreviewDrawer (Q1→Q2→result).
//   §3 guards + back-routing: a built manual draft reaches Rec Page/Design/
//      Generate WITHOUT a picked_template; Back-from-Questions routes to
//      Recommendations (grouping) because Shape was skipped.
//   Legacy byte baseline re-probe at the end.
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
const legacyBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());

const funnelData = (id) => `${BASE}/studio/onboarding/${id}?_data=routes%2Fstudio.onboarding_.%24quizId`;
const builderData = (id) => `${BASE}/studio/${id}?_data=routes%2Fstudio_.%24id`;
const readFunnel = async (id) => (await ctx.request.get(funnelData(id))).json();
const readBuilder = async (id) => (await ctx.request.get(builderData(id))).json();
const postIntent = (id, form) => ctx.request.post(funnelData(id), { form });
const putDoc = async (id, mutate) => {
  const loaded = await readBuilder(id);
  const doc = mutate(loaded.doc);
  await ctx.request.put(builderData(id), {
    headers: { "content-type": "application/json" },
    data: { doc },
  });
};
const graduate = (id) =>
  putDoc(id, (d) => ({ ...d, build_session: { ...(d.build_session ?? {}), stage: "done", built: true } }));

// ── fresh decider draft at grouping ──────────────────────────────────────────
let draftId = null;
for (let i = 0; i < 5 && !draftId; i++) {
  const resp = await ctx.request.get(`${BASE}/studio/onboarding`);
  const id = new URL(resp.url()).pathname.split("/").pop();
  const fd0 = await readFunnel(id).catch(() => null);
  if (fd0?.stage === "grouping" && fd0?.logicModel === "decider") { draftId = id; break; }
  console.log(`… graduating in-flight draft ${id} (stage ${fd0?.stage})`);
  await graduate(id);
}
ok("fresh DECIDER draft at Recommendations", Boolean(draftId), draftId ?? "none");
if (!draftId) { await browser.close(); process.exit(1); }

let fd = await readFunnel(draftId);
ok("loader emits logicModel=decider", fd.logicModel === "decider");
const applyKeys = fd.suggestion?.apply?.keys ?? [];
ok("loader emits an apply set to seed selections", applyKeys.length > 0, `${fd.suggestion?.apply?.type} × ${applyKeys.length}`);

// seed selections (so Continue is enabled + manual-build has cats)
await postIntent(draftId, { intent: "set-buckets", type: fd.suggestion.apply.type, keys: applyKeys.join(",") });
fd = await readFunnel(draftId);
ok("selections persisted", fd.buckets.length === applyKeys.length, `${fd.buckets.length}`);

// ── §1 intercept modal ───────────────────────────────────────────────────────
const url = `${BASE}/studio/onboarding/${draftId}`;
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().click();
await page.waitForTimeout(500);
ok("Continue opens the intercept modal (no navigation)", await page.getByText("How do you want to start?").first().isVisible().catch(() => false));
ok("route (a) Generate AI templates present", await page.getByText("Generate AI templates").first().isVisible().catch(() => false));
ok("route (b) Write your goal present", await page.getByText("Write your goal").first().isVisible().catch(() => false));
ok("route (c) blank-quiz tertiary present", await page.getByText("Build from a blank quiz instead", { exact: false }).first().isVisible().catch(() => false));
await page.screenshot({ path: "e2e/shots/sr-intercept-modal.png" });
// still at grouping (modal is client-state only)
fd = await readFunnel(draftId);
ok("modal dismissal is side-effect-free (stage still grouping)", fd.stage === "grouping", fd.stage);
// Esc closes
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("Esc closes the modal", !(await page.getByText("How do you want to start?").first().isVisible().catch(() => false)));

// ── §1.2 manual-build (no AI) ────────────────────────────────────────────────
await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().click();
await page.waitForTimeout(400);
await page.getByText("Build from a blank quiz instead", { exact: false }).first().click();
await page.waitForTimeout(1600);
fd = await readFunnel(draftId);
const mb = await readBuilder(draftId);
// `built` lives on build_session (the loader surfaces `stage`, not `built`); the
// guard relaxations below independently prove built===true is persisted.
ok(
  "manual-build → stage question_builder + built",
  fd.stage === "question_builder" && mb.doc.build_session?.built === true,
  `${fd.stage} · built=${mb.doc.build_session?.built}`,
);
const results = mb.doc.nodes.filter((n) => n.type === "result");
ok("skeleton has EXACTLY one result node", results.length === 1);
ok("result node carries a non-empty fallback_collection_id", Boolean(results[0]?.data?.fallback_collection_id), results[0]?.data?.fallback_collection_id);
ok("doc stamped logic_model=decider", mb.doc.logic_model === "decider");
ok("scoring_model=direct", mb.doc.scoring_model === "direct");
ok("quiz_types cleared (§3 marker)", (mb.doc.build_session?.quiz_types ?? []).length === 0);

// ── §3 guard relaxations (built manual draft has no picked_template) ─────────
let r = await postIntent(draftId, { intent: "to-rec-page" });
ok("to-rec-page accepts a built manual draft (200)", r.status() === 200, `${r.status()}`);
r = await postIntent(draftId, { intent: "to-design" });
ok("to-design accepts a built manual draft (200)", r.status() === 200, `${r.status()}`);
// generate-build graduates → redirect to builder (302/204). Verify it does NOT 400.
r = await postIntent(draftId, { intent: "generate-build" });
ok("generate-build finalizes a built manual draft (not 400)", r.status() !== 400, `${r.status()}`);

// ── §3 back-routing: Shape skipped → Back lands on Recommendations ──────────
// reset the manual draft back to question_builder (generate-build graduated it)
await putDoc(draftId, (d) => ({
  ...d,
  buildState: "step1",
  build_session: { ...(d.build_session ?? {}), stage: "question_builder", built: true, quiz_types: [] },
}));
r = await postIntent(draftId, { intent: "back-to-types" });
fd = await readFunnel(draftId);
ok("Back-from-Questions (Shape skipped) → Recommendations", fd.stage === "grouping", fd.stage);

// ── §2 DeciderShapeStage (seed stage=types + 2 quiz_types, AI-free) ──────────
const QT = (id, xtype, name) => ({
  id, experience_type: xtype, name,
  achieves: `Helps shoppers find the right ${name.toLowerCase()}.`,
  question_range: { min: 4, max: 6 },
  best_practice_note: "", rationale: "", web_research_excerpt: "",
});
await putDoc(draftId, (d) => ({
  ...d,
  build_session: {
    ...(d.build_session ?? {}),
    stage: "types",
    built: false,
    quiz_types: [
      QT("t-match", "product_match", "Product Matcher"),
      QT("t-personality", "personality", "Style Personality"),
    ],
  },
}));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
fd = await readFunnel(draftId);
ok("draft at Shape (types) with 2 quiz_types", fd.stage === "types" && fd.quizTypes?.length === 2, `${fd.stage} · ${fd.quizTypes?.length}`);
ok("provenance banner shows real counts", await page.getByText(/Generated from your catalog — based on \d+ products/).first().isVisible().catch(() => false));
ok("exactly two template cards render", (await page.locator(".qz-shape-card").count()) === 2);
ok("cards carry a live mini-thumbnail", (await page.locator(".qz-shape-thumb").count()) === 2);
ok("escape link 'Write a goal' present", await page.getByText("Write a goal", { exact: true }).first().isVisible().catch(() => false));
ok("escape link 'Build manually' present", await page.getByText("Build manually", { exact: true }).first().isVisible().catch(() => false));
ok("Regenerate + Back footer present",
  (await page.getByRole("button", { name: /Regenerate/ }).first().isVisible().catch(() => false)) &&
  (await page.getByRole("button", { name: /Back to recommendations/ }).first().isVisible().catch(() => false)));
await page.screenshot({ path: "e2e/shots/sr-decider-shape.png" });

// ── §2.2 preview drawer ──────────────────────────────────────────────────────
await page.locator(".qz-shape-card").first().click();
await page.waitForTimeout(700);
ok("preview drawer opens on card click", (await page.locator(".qz-rb-pvdrawer").count()) === 1);
ok("drawer starts on Q1 (screen 1 of 3)", await page.getByText("Screen 1 of 3", { exact: false }).first().isVisible().catch(() => false));
ok("drawer 'Use this template' CTA present", await page.getByRole("button", { name: /Use this template/ }).first().isVisible().catch(() => false));
// advance Q1 → Q2 (pick first chip then Next)
await page.locator(".qz-tpl-chip").first().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Next", exact: true }).first().click();
await page.waitForTimeout(400);
ok("drawer advances to Q2 (screen 2 of 3)", await page.getByText("Screen 2 of 3", { exact: false }).first().isVisible().catch(() => false));
await page.locator(".qz-tpl-chip").first().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Next", exact: true }).first().click();
await page.waitForTimeout(400);
ok("drawer reaches the result (screen 3 of 3 + Add to cart)",
  (await page.getByText("Screen 3 of 3", { exact: false }).first().isVisible().catch(() => false)) &&
  (await page.getByText("Add to cart", { exact: false }).first().isVisible().catch(() => false)));
await page.screenshot({ path: "e2e/shots/sr-preview-drawer-result.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("Esc closes the drawer (deselects)", (await page.locator(".qz-rb-pvdrawer").count()) === 0);

// ── cleanup + byte baseline ──────────────────────────────────────────────────
await graduate(draftId);
const legacyAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy /q.json BYTE-IDENTICAL", legacyAfter === legacyBefore, `sha ${legacyAfter}`);
ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\nprobe draft: ${draftId}`);
console.log(`${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
