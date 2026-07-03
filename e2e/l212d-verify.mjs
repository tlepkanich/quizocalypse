// LOGIC v2 L2-12d live-verify — the merchant kill-switch toggle for the runtime
// rec-copy feature (Shop.aiRecCopyEnabled), on the standalone deploy. This is
// ALSO the deferred kill-switch FALSE-path proof (L2-12a/b):
//   • the toggle card renders on /studio/integrations (default ON).
//   • toggle OFF → the /q loader flips aiCopyEnabled:false AND the rec-copy
//     endpoint returns {ok:false, code:"disabled"} immediately (before cache).
//   • toggle ON → the /q loader flips true AND rec-copy generates again.
//   • restored ON (the default). Legacy /q.json byte-identical.
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const DECIDER = "cmr3ku9kb0014qvl1ub8n5092";
const LEGACY = "cmqqcb0ao004mqvkwjug7t0ya";

const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const rid = (n) => `kill${n}${"x".repeat(20)}`.slice(0, 24);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

const integrationsData = `${BASE}/studio/integrations?_data=routes%2Fstudio.integrations`;
const qLoader = (id) => `${BASE}/q/${id}?_data=routes%2Fq.%24id`;
const toggle = (enabled) =>
  ctx.request.post(integrationsData, { form: { intent: "toggle-rec-copy", enabled: String(enabled) } });
const recCopy = (id, sessionId, answerIds) =>
  ctx.request.post(`${BASE}/q/${id}/rec-copy`, {
    headers: { "content-type": "application/json" },
    data: { sessionId, answerIds },
  });
const readAiCopyEnabled = async (id) => {
  const j = await (await ctx.request.get(qLoader(id))).json();
  return j.aiCopyEnabled;
};

const legacyBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());

// discover a mapped deciding answer (for the generate path)
const pub = await (await ctx.request.get(`${BASE}/q/${DECIDER}.json`)).json();
const doc = pub.doc ?? pub;
const deciderQ = (doc.nodes ?? []).find((n) => n.type === "question" && n.data?.role === "decides");
const mapped = (deciderQ?.data?.answers ?? []).find((a) => a.target_id);
ok("found a mapped deciding answer", Boolean(mapped), mapped?.id);

// ── the toggle card renders (default ON) ─────────────────────────────────────
await page.goto(`${BASE}/studio/integrations`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
ok("toggle card renders", await page.getByText("Personalized recommendation copy").first().isVisible().catch(() => false));
const box = page.locator('input[type="checkbox"]').first();
ok("toggle checkbox present + checked by default", await box.isChecked().catch(() => false));

const before = await readAiCopyEnabled(DECIDER);
ok("loader aiCopyEnabled starts true (default)", before === true, String(before));

// ── toggle OFF → kill-switch FALSE path ──────────────────────────────────────
const off = await toggle(false);
const offJson = await off.json().catch(() => ({}));
ok("toggle OFF persists {ok:true, aiRecCopyEnabled:false}", off.status() === 200 && offJson.ok === true && offJson.aiRecCopyEnabled === false);
ok("loader aiCopyEnabled flips FALSE (live, no republish)", (await readAiCopyEnabled(DECIDER)) === false);
const rcOff = await recCopy(DECIDER, rid("A"), [mapped.id]);
const rcOffJson = await rcOff.json().catch(() => ({}));
ok("rec-copy endpoint returns {ok:false, code:disabled}", rcOffJson.ok === false && rcOffJson.code === "disabled", `${rcOff.status()} · ${rcOffJson.code}`);

// ── toggle ON → generates again ──────────────────────────────────────────────
const on = await toggle(true);
const onJson = await on.json().catch(() => ({}));
ok("toggle ON persists {ok:true, aiRecCopyEnabled:true}", on.status() === 200 && onJson.aiRecCopyEnabled === true);
ok("loader aiCopyEnabled flips back TRUE", (await readAiCopyEnabled(DECIDER)) === true);
const rcOn = await recCopy(DECIDER, rid("B"), [mapped.id]);
const rcOnJson = await rcOn.json().catch(() => ({}));
ok("rec-copy GENERATES again once enabled", rcOn.status() === 200 && rcOnJson.ok === true && typeof rcOnJson.copy === "string", `${rcOn.status()} · ${(rcOnJson.copy ?? rcOnJson.code ?? "").slice(0, 50)}`);

// ── UI round-trip: click the checkbox OFF then ON, confirm persistence ───────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
await page.locator('input[type="checkbox"]').first().click();
await page.waitForTimeout(1200);
ok("UI click OFF persisted", (await readAiCopyEnabled(DECIDER)) === false);
await page.locator('input[type="checkbox"]').first().click();
await page.waitForTimeout(1200);
ok("UI click ON restored (default)", (await readAiCopyEnabled(DECIDER)) === true);

// ── byte baseline ────────────────────────────────────────────────────────────
const legacyAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy /q.json BYTE-IDENTICAL", legacyAfter === legacyBefore, `sha ${legacyAfter}`);
ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
