// Step-1 Recommendations spec live-verify (quiz-step1-recommendations-spec,
// design notes skipped — qz system retained) on the standalone deploy.
//   §1 copy: nav "Recommendations", rail "Your recommendations", NO merchant-
//      visible "bucket" on the page.
//   §2 layout: 70/30 split + sticky rail + rail-footer Preview/Continue
//      (disabled at 0).
//   §4 auto-apply: REAL "Use this" click → the concrete set persists as
//      Category rows → Applied banner + Undo → Undo restores empty.
//   §3 lock: first selection mutes other tabs; clicking one opens the
//      switch-confirm ("You have N X selected…" → Switch types clears).
//   §5 drawer: single-product focused screen; collection 3×2 grid ≤6 +
//      "+N more"; phone fits; "Looks good" closes.
//   Byte baseline re-probe at the end.
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

// ── fresh decider draft at grouping ──────────────────────────────────────────
let draftId = null;
for (let i = 0; i < 4 && !draftId; i++) {
  const resp = await ctx.request.get(`${BASE}/studio/onboarding`);
  const id = new URL(resp.url()).pathname.split("/").pop();
  const fd0 = await readFunnel(id).catch(() => null);
  if (fd0?.stage === "grouping") { draftId = id; break; }
  console.log(`… graduating in-flight draft ${id} (stage ${fd0?.stage})`);
  const loaded = await readBuilder(id);
  await ctx.request.put(builderData(id), {
    headers: { "content-type": "application/json" },
    data: { doc: { ...loaded.doc, build_session: { ...(loaded.doc.build_session ?? {}), stage: "done", built: true } } },
  });
}
ok("fresh draft at the Recommendations step", Boolean(draftId), draftId ?? "none");
if (!draftId) { await browser.close(); process.exit(1); }

let fd = await readFunnel(draftId);
ok("loader emits the §4 apply set", Boolean(fd.suggestion?.apply?.keys?.length), `${fd.suggestion?.apply?.type} × ${fd.suggestion?.apply?.keys?.length}`);
ok("loader emits the why-line with real counts", /catalog has \d+ products across/.test(fd.suggestion?.why ?? ""), fd.suggestion?.why);
ok("loader emits referencedKeys (empty on a fresh draft)", Array.isArray(fd.referencedKeys) && fd.referencedKeys.length === 0);

// ── §1 copy + §2 layout ──────────────────────────────────────────────────────
const url = `${BASE}/studio/onboarding/${draftId}`;
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
ok("H1 renders", await page.getByText("What can your quiz recommend?").first().isVisible().catch(() => false));
ok("head label says Recommendations (bucket-free)", await page.getByText("Step 1 of 5 · Recommendations", { exact: false }).first().isVisible().catch(() => false));
ok("rail title 'Your recommendations'", await page.getByText("Your recommendations", { exact: true }).first().isVisible().catch(() => false));
const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
ok("NO merchant-visible 'bucket' on the page", !/bucket/i.test(bodyText));
ok("70/30 split renders", (await page.locator(".qz-rb-split").count()) === 1);
ok("rail is sticky", await page.locator(".qz-rb-rail").evaluate((el) => getComputedStyle(el).position === "sticky").catch(() => false));
ok("Continue disabled at 0", await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().isDisabled().catch(() => false));
ok("Preview disabled at 0", await page.locator(".qz-rb-rail-foot .qz-btn-ghost").first().isDisabled().catch(() => false));
await page.screenshot({ path: "e2e/shots/rs-step1-layout.png" });

// ── §4 auto-apply: Use this → Applied+Undo → Undo ───────────────────────────
ok("AI banner shows Use this", await page.getByRole("button", { name: "Use this" }).first().isVisible().catch(() => false));
await page.getByRole("button", { name: "Use this" }).first().click();
await page.waitForTimeout(1800);
ok("Applied banner + Undo render", await page.getByRole("button", { name: "Undo" }).first().isVisible().catch(() => false));
fd = await readFunnel(draftId);
const applyN = fd.suggestion.apply.keys.length;
ok("the concrete set PERSISTED as selections", fd.buckets.length === applyN && fd.buckets.every((b) => b.type === fd.suggestion.apply.type), `${fd.buckets.length} × ${fd.buckets[0]?.type}`);
await page.screenshot({ path: "e2e/shots/rs-step1-applied.png" });
await page.getByRole("button", { name: "Undo" }).first().click();
await page.waitForTimeout(1800);
fd = await readFunnel(draftId);
ok("Undo restored the (empty) prior selection", fd.buckets.length === 0, `${fd.buckets.length}`);

// ── §3 lock + switch-confirm (via a manual product pick) ────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.getByRole("tab", { name: /Individual Products/ }).click();
await page.waitForTimeout(600);
await page.locator(".qz-rb-grid .qz-rb-card").first().click();
await page.waitForTimeout(1400);
ok("first selection mutes the other tabs", (await page.locator(".qz-rb-tab.is-muted").count()) >= 1);
ok("rail shows the row + type chip", await page.locator(".qz-rb-rail-row").first().isVisible().catch(() => false));

// ── §5 drawer — single-product layout ────────────────────────────────────────
await page.locator(".qz-rb-rail-foot .qz-btn-ghost").first().click();
await page.waitForTimeout(800);
ok("preview drawer opens", await page.getByText("Results page preview").first().isVisible().catch(() => false));
ok("single-product layout (Add to cart, no grid)", (await page.locator(".qz-rb-pv-single").count()) === 1 && (await page.locator(".qz-rb-pvgrid").count()) === 0);
ok("ghost AI line renders", await page.getByText("AI personalizes at quiz time").first().isVisible().catch(() => false));
ok("footer descriptor: single-product", await page.getByText("Single-product layout", { exact: false }).first().isVisible().catch(() => false));
const phoneFits = await page.locator(".qz-rb-phone-screen").evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.height <= 512 && r.bottom <= window.innerHeight && el.scrollHeight <= el.clientHeight + 24;
}).catch(() => false);
ok("phone fits the viewport, content clipped", phoneFits);
await page.screenshot({ path: "e2e/shots/rs-step1-drawer-single.png" });
await page.getByRole("button", { name: "Looks good" }).click();
await page.waitForTimeout(400);

// switch to Collections via the confirm modal
await page.getByRole("tab", { name: /Collections/ }).click();
await page.waitForTimeout(400);
ok("switch-confirm modal opens with the §3 copy", await page.getByText(/You have 1 product selected/, { exact: false }).first().isVisible().catch(() => false));
await page.getByRole("button", { name: "Switch types" }).click();
await page.waitForTimeout(1400);
fd = await readFunnel(draftId);
ok("switch cleared the selection + landed on Collections", fd.buckets.length === 0 && fd.activeTab === "collection", `${fd.buckets.length} · ${fd.activeTab}`);

// select 2 collections → grid layout in the drawer
const colCards = page.locator(".qz-rb-grid .qz-rb-card");
await colCards.nth(0).click();
await page.waitForTimeout(900);
await colCards.nth(1).click();
await page.waitForTimeout(1400);
await page.locator(".qz-rb-rail-foot .qz-btn-ghost").first().click();
await page.waitForTimeout(800);
ok("drawer tabs render per selection", (await page.locator(".qz-rb-pvtab").count()) === 2);
ok("grid layout, ≤6 tiles, no hero", (await page.locator(".qz-rb-pvgrid").count()) === 1 && (await page.locator(".qz-rb-pvtile").count()) <= 6 && (await page.locator(".qz-rb-pv-heroimg").count()) === 0);
ok("count title renders", await page.getByText(/\d+ products? in /).first().isVisible().catch(() => false));
ok("footer descriptor: multi-product", await page.getByText("Multi-product layout", { exact: false }).first().isVisible().catch(() => false));
await page.screenshot({ path: "e2e/shots/rs-step1-drawer-grid.png" });
await page.getByRole("button", { name: "Looks good" }).click();
await page.waitForTimeout(300);
ok("Continue enabled with selections", await page.locator(".qz-rb-rail-foot .qz-btn-accent").first().isEnabled().catch(() => false));

// ── cleanup + baseline ───────────────────────────────────────────────────────
await postIntent(draftId, { intent: "set-buckets", type: "collection", keys: "" });
const loaded = await readBuilder(draftId);
await ctx.request.put(builderData(draftId), {
  headers: { "content-type": "application/json" },
  data: { doc: { ...loaded.doc, build_session: { ...(loaded.doc.build_session ?? {}), stage: "done", built: true } } },
});
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
