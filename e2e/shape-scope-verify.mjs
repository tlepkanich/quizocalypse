// Shape-scope live-verify — the funnel's AI now grounds generation in the CHOSEN
// recommendation buckets, not the whole catalog (commit 65c55a5).
//
// This change scopes the catalog SUMMARY fed to the AI at BOTH generation layers
// (Shape-stage types/templates in step2Build + the question-flow build in
// onboardingBuild). The scope logic is deterministically unit-tested
// (scopeCatalogToChosen, 4 tests); the SEMANTIC effect on generated question
// content is real but non-deterministic, so it can't be cleanly asserted headless.
//
// HARD deterministic gates here:
//   1. The shared build orchestrator (onboardingBuild — where the deeper scope +
//      the extra prisma.category.findMany live) still produces a VALID decider
//      quiz through a real funnel build. This is the regression my change could
//      introduce.
//   2. legacy /q.json BYTE-IDENTICAL (this is a draft-generation-time change;
//      published quizzes must be untouched).
// DIAGNOSTIC (reported, not gated): the catalog composition + the generated
// question/answer text, so a human can eyeball that content is on-domain.
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

// ── 1. fresh decider draft ──────────────────────────────────────────────────
let draftId = null;
for (let i = 0; i < 5 && !draftId; i++) {
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

// ── 2. inspect catalog + build 2 buckets from a subset (the "chosen" products) ─
const bLoaded = await readBuilder(draftId);
const idx = bLoaded.productIndex ?? [];
const products = idx.map((p) => p.product_id).filter(Boolean);
ok("catalog has products to bucket", products.length >= 2, `${products.length} products`);
if (products.length < 2) { await browser.close(); process.exit(1); }

// DIAGNOSTIC: report catalog domain composition (snowboard vs skincare keyword
// hits over titles+tags), so the "excluded domain absent from content" signal
// below is interpretable rather than trivially true.
const SNOW = /snowboard|board|ride|rider|wax|binding|boot|powder|park|terrain|mountain|slope|carve|deck|flex/i;
const SKIN = /\bskin|serum|moistur|cream|spf|cleanser|hydrat|complexion|acne|wrinkle|pore|lotion|toner|exfoli|facial/i;
const textOf = (p) => `${p.title ?? ""} ${(p.tags ?? []).join(" ")}`;
const snowN = idx.filter((p) => SNOW.test(textOf(p))).length;
const skinN = idx.filter((p) => SKIN.test(textOf(p))).length;
console.log(`  catalog composition: ${snowN} snowboard-ish · ${skinN} skincare-ish · ${idx.length} total`);

// Build buckets from a SINGLE domain when the catalog is hybrid — that is the
// clean, owner-facing demonstration: "I chose snowboards, so the quiz is about
// snowboards, not my whole (skincare-heavy) catalog." Pick the domain with the
// fewer products (more distinctive), so a leak of the OTHER, larger domain would
// be conspicuous. Fall back to a plain slice for a single-domain catalog.
const snowIds = idx.filter((p) => SNOW.test(textOf(p)) && !SKIN.test(textOf(p))).map((p) => p.product_id);
const skinIds = idx.filter((p) => SKIN.test(textOf(p)) && !SNOW.test(textOf(p))).map((p) => p.product_id);
const hybrid = snowN > 0 && skinN > 0;
// chosen domain = snowboards when hybrid (the minority, distinctive set); the
// EXCLUDED domain is then skincare, whose terms should NOT surface in content.
const chosenDomain = hybrid ? "snowboard" : "n/a";
const excludedRe = hybrid ? SKIN : null;
const pool = hybrid ? (snowIds.length >= 2 ? snowIds : skinIds) : products;
const chosenIds = pool.slice(0, Math.min(6, Math.max(2, Math.floor(pool.length / 2) + 1)));
console.log(`  chosen domain: ${chosenDomain} — ${chosenIds.length} products into 2 buckets`);
const groupResp = await ctx.request.post(`${BASE}/api/categories/group`, {
  headers: { "content-type": "application/json" },
  data: {
    source: "manual",
    quizId: draftId,
    groups: [
      { name: "Scope Bucket A", productIds: chosenIds.slice(0, Math.ceil(chosenIds.length / 2)) },
      { name: "Scope Bucket B", productIds: chosenIds.slice(Math.ceil(chosenIds.length / 2)) },
    ].filter((g) => g.productIds.length > 0),
  },
});
const cats = (await groupResp.json().catch(() => ({}))).categories ?? [];
const catIds = new Set(cats.map((c) => c.id));
ok("confirmed buckets persisted", cats.length >= 1, cats.map((c) => c.name).join(", "));
await postIntent(draftId, { intent: "continue-buckets" });

// ── 3. tier-1 → types ───────────────────────────────────────────────────────
let fd = null;
for (let i = 0; i < 40; i++) {
  await sleep(5000);
  fd = await readFunnel(draftId);
  if (fd.stage === "types" || fd.genError) break;
}
ok("tier-1 done (stage types)", fd?.stage === "types", `stage=${fd?.stage} genError=${fd?.genError ?? ""}`);
if (fd?.stage !== "types") { await browser.close(); process.exit(1); }

// ── 4. shape-continue (direct) → REAL question build via onboardingBuild ─────
const typeId = fd.quizTypes?.[0]?.id ?? "x";
const scResp = await postIntent(draftId, { intent: "shape-continue", typeId, scoring: "direct" });
ok("shape-continue (direct) accepted", scResp.ok(), `${scResp.status()}`);
for (let i = 0; i < 60; i++) {
  await sleep(6000);
  fd = await readFunnel(draftId);
  if (fd.stage === "question_builder" || fd.genError) break;
}
ok("question build completed (→ question_builder)", fd?.stage === "question_builder", `stage=${fd?.stage} genError=${fd?.genError ?? ""}`);
if (fd?.stage !== "question_builder") { await browser.close(); process.exit(1); }

// ── 5. HARD: the built doc is a valid decider quiz (orchestrator regression) ──
const built = (await readBuilder(draftId)).doc;
const qNodes = built.nodes.filter((n) => n.type === "question");
const deciders = qNodes.filter((n) => n.data.role === "decides");
const resultNodes = built.nodes.filter((n) => n.type === "result");
ok("built doc is a decider doc", built.logic_model === "decider");
ok("EXACTLY ONE deciding question", deciders.length === 1, `${deciders.length} of ${qNodes.length}`);
ok("every deciding answer targets a confirmed bucket", (deciders[0]?.data.answers ?? []).length > 0 && (deciders[0]?.data.answers ?? []).every((a) => catIds.has(a.target_id)), `${deciders[0]?.data.answers?.length ?? 0} answers`);
ok("ONE result node w/ fallback_collection_id", resultNodes.length === 1 && Boolean(resultNodes[0]?.data.fallback_collection_id));
ok("NO email gate (decider §7 capture owns contact)", built.nodes.filter((n) => n.type === "email_gate").length === 0);
ok("rec_page_settings seeded", Boolean(built.rec_page_settings?.global?.emptyFallbackCol));

// ── 6. DIAGNOSTIC: dump generated content + cross-domain leak signal ──────────
const content = qNodes
  .flatMap((n) => [n.data.text ?? "", ...(n.data.answers ?? []).map((a) => a.text ?? "")])
  .join(" · ");
console.log(`\n  generated questions/answers:\n  ${content.slice(0, 900)}\n`);
// The clean owner-facing signal: with SNOWBOARD-only buckets on a hybrid catalog,
// the scoped summary omits every skincare product, so the generated content should
// be snowboard-domain with the EXCLUDED (skincare) domain absent. Reported as a
// strong diagnostic — not hard-gated, since the AI is non-deterministic and rarely
// surfaces tags verbatim (the deterministic proofs are the valid build + byte
// baseline + the scopeCatalogToChosen unit tests).
if (hybrid && excludedRe) {
  const chosenHits = (content.match(SNOW) ?? []).length;
  const excludedHits = (content.match(excludedRe) ?? []).length;
  const clean = excludedHits === 0;
  // Diagnostic only (NOT gated): a stray skincare term could legitimately come
  // from the brand-identity summary (which describes the hybrid brand and is fed
  // to generation identity-wide, correctly unscoped) rather than a catalog-scope
  // failure. So report it for a human to eyeball; the deterministic gates stand.
  console.log(`  DIAGNOSTIC (${chosenDomain}-only buckets on a hybrid catalog): chosen-domain hits=${chosenHits} · EXCLUDED(skincare) hits=${excludedHits} ${clean ? "— clean: excluded domain ABSENT (scope engaged)" : "— skincare terms present; check whether from catalog vs the hybrid brand summary"}`);
} else {
  console.log(`  DIAGNOSTIC: catalog is single-domain (snow=${snowN}/skin=${skinN}) — cross-domain leak test N/A; relying on the valid-build + byte gates + unit tests.`);
}

// ── 7. byte baseline + page errors ───────────────────────────────────────────
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
