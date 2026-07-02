// L2-11 live-verify — config-time grounded AI why-copy on the deploy, driven
// through the REAL panel on the funnel-built decider fixture:
// ✦ AI generate (a real MODEL_FAST call) → grounded copy lands in the field +
// persists SPARSE with provenance → 🔒 lock disables regenerate → a mutated
// membership hash renders the STALE chip → publish strips why_copy_meta from
// the wire while whyCopy ships → full restore → byte baseline.
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const FIXTURE = "cmr3ku9kb0014qvl1ub8n5092"; // "Terrain-First Ride Finder" (funnel-built decider)
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
const baselineBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());

const builderData = `${BASE}/studio/${FIXTURE}?_data=routes%2Fstudio_.%24id`;
const readDoc = async () => (await (await ctx.request.get(builderData)).json()).doc;
const putDoc = (doc) =>
  ctx.request.put(builderData, { headers: { "content-type": "application/json" }, data: { doc } });

// ── setup: park the graduated fixture back at rec_page ──────────────────────
const original = await readDoc();
ok("fixture is a decider doc", original.logic_model === "decider");
await putDoc({ ...original, build_session: { ...(original.build_session ?? {}), stage: "rec_page" } });

const funnelUrl = `${BASE}/studio/onboarding/${FIXTURE}`;
await page.goto(funnelUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
ok("Step-4 panel renders", await page.getByText("Page copy", { exact: false }).first().isVisible().catch(() => false));

// ── ✦ AI generate (a REAL config-time AI call) ──────────────────────────────
const genBtn = page.getByRole("button", { name: "✦ AI generate" }).first();
ok("✦ AI generate renders in the why-copy block", await genBtn.isVisible().catch(() => false));
await genBtn.click();
// MODEL_FAST + 512 tokens — usually a few seconds; poll the field for copy.
let copy = "";
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1500);
  const d = await readDoc();
  copy = d.rec_page_settings?.global?.whyCopy ?? "";
  if (copy) break;
}
ok("grounded copy PERSISTED sparse into global.whyCopy", copy.length > 30, copy.slice(0, 110));
let doc = await readDoc();
const meta = doc.why_copy_meta?.__global__;
ok("provenance stored (why_copy_meta.__global__ {at, members})", Boolean(meta?.at && meta?.members), JSON.stringify(meta));
await page.screenshot({ path: "e2e/shots/l2-11-generated.png" });

// ── 🔒 lock disables regenerate ─────────────────────────────────────────────
await page.getByText("🔒 Lock this copy").first().click();
await page.waitForTimeout(1800);
doc = await readDoc();
ok("whyCopyLocked stored sparse (true)", doc.rec_page_settings?.global?.whyCopyLocked === true);
ok("✦ disabled while locked", !(await genBtn.isEnabled().catch(() => true)));
await page.getByText("🔒 Lock this copy").first().click();
await page.waitForTimeout(1800);
doc = await readDoc();
ok("unlock DROPS the key", !("whyCopyLocked" in (doc.rec_page_settings?.global ?? {})));

// ── stale chip on membership drift ──────────────────────────────────────────
await putDoc({
  ...doc,
  why_copy_meta: { ...(doc.why_copy_meta ?? {}), __global__: { ...meta, members: "00000000" } },
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
ok("STALE chip renders after a membership-hash drift", await page.getByText("stale", { exact: true }).first().isVisible().catch(() => false));

// ── the wire: publish strips why_copy_meta, whyCopy ships ───────────────────
doc = await readDoc();
const pub = await ctx.request.post(builderData, { form: { intent: "publish", doc: JSON.stringify(doc) } });
let pubJson = {};
try { pubJson = await pub.json(); } catch { /* html */ }
ok("publish with copy+meta succeeds", pub.ok() && pubJson.ok !== false, JSON.stringify(pubJson).slice(0, 100));
const wire = await (await ctx.request.get(`${BASE}/q/${FIXTURE}.json`)).json();
ok("why_copy_meta STRIPPED from the published wire", !("why_copy_meta" in wire));
ok("the approved whyCopy SHIPS in rec_page_settings", (wire.rec_page_settings?.global?.whyCopy ?? "") === copy);

// ── restore: original doc republished + graduated ───────────────────────────
await putDoc({ ...original, build_session: { ...(original.build_session ?? {}), stage: "done", built: true } });
const restorePub = await ctx.request.post(builderData, { form: { intent: "publish", doc: JSON.stringify(original) } });
ok("fixture restored + republished clean", restorePub.ok());
const restored = await readDoc();
ok("no residue (whyCopy/meta/lock gone)", !("why_copy_meta" in restored) && !(restored.rec_page_settings?.global?.whyCopy));

// ── baseline + errors ───────────────────────────────────────────────────────
const baselineAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy /q.json BYTE-IDENTICAL", baselineAfter === baselineBefore, baselineAfter);
ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
