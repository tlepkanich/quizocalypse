// LOGIC v2 L2-12c live-verify — the ADVISORY AI path-quality review
// (rec-page-spec-V2 §7 Tier-2) on the standalone deploy.
//   • endpoint success: a REAL AI review on a published DECIDER fixture
//     ({ok:true, review rows w/ verdict looks_right|review + note + a hash});
//     every row's outcome_id is a real decider answer/rule id (server-derived,
//     hallucination-filtered).
//   • refusals: a LEGACY (non-decider) quiz → 400; a missing quizId → 400.
//   • DRAFT-only + STRIPPED at publish: PUT path_report_ai onto the draft →
//     present on read-back → publish → /q.json omits it (byte-stable strip).
//   • legacy /q.json byte baseline held.
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const DECIDER = "cmr3ku9kb0014qvl1ub8n5092"; // funnel-built published decider fixture
const LEGACY = "cmqqcb0ao004mqvkwjug7t0ya";

const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

const builderData = (id) => `${BASE}/studio/${id}?_data=routes%2Fstudio_.%24id`;
const readBuilder = async (id) => (await ctx.request.get(builderData(id))).json();
const putDoc = (id, doc) =>
  ctx.request.put(builderData(id), { headers: { "content-type": "application/json" }, data: { doc } });
const postPathQuality = (body) =>
  ctx.request.post(`${BASE}/api/path-quality`, {
    headers: { "content-type": "application/json" },
    data: body,
  });

const legacyBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());

// ── discover the decider outcome ids (from the draft) ────────────────────────
const loaded = await readBuilder(DECIDER);
const doc = loaded.doc;
ok("decider fixture draft is a decider doc", doc?.logic_model === "decider", doc?.logic_model);
const deciderQ = (doc.nodes ?? []).find((n) => n.type === "question" && n.data?.role === "decides");
const answerIds = new Set((deciderQ?.data?.answers ?? []).map((a) => a.id));
const ruleIds = new Set((doc.decision_rules ?? []).map((r) => r.id));
ok("decider question has mapped answers", (deciderQ?.data?.answers ?? []).some((a) => a.target_id));

// ── endpoint success: a REAL AI review ───────────────────────────────────────
const r1 = await postPathQuality({ quizId: DECIDER });
const j1 = await r1.json().catch(() => ({}));
ok("path-quality success {ok:true, review, meta.hash}", r1.status() === 200 && j1.ok === true && Array.isArray(j1.review) && typeof j1.meta?.hash === "string", `${r1.status()} · ${j1.review?.length ?? 0} rows`);
ok("review has ≥1 advisory row", (j1.review?.length ?? 0) >= 1);
const validVerdicts = (j1.review ?? []).every((r) => r.verdict === "looks_right" || r.verdict === "review");
ok("every row has a valid verdict + a note", validVerdicts && (j1.review ?? []).every((r) => typeof r.note === "string" && r.note.length > 0));
const allAnchored = (j1.review ?? []).every((r) => answerIds.has(r.outcome_id) || ruleIds.has(r.outcome_id));
ok("every row's outcome_id is a REAL decider answer/rule id (hallucination-filtered)", allAnchored, (j1.review ?? []).map((r) => `${r.outcome_id}:${r.verdict}`).slice(0, 4).join(" · "));
console.log("  sample:", (j1.review ?? []).slice(0, 2).map((r) => `[${r.verdict}] ${r.note.slice(0, 60)}`).join(" || "));

// ── refusals ─────────────────────────────────────────────────────────────────
const r2 = await postPathQuality({ quizId: LEGACY });
const j2 = await r2.json().catch(() => ({}));
ok("legacy quiz → 400 decider-only refusal", r2.status() === 400 && j2.ok === false, `${r2.status()}`);
const r3 = await postPathQuality({});
ok("missing quizId → 400", r3.status() === 400);

// ── DRAFT-only + STRIPPED at publish ─────────────────────────────────────────
const withReport = {
  ...doc,
  path_report_ai: {
    at: new Date().toISOString(),
    hash: j1.meta?.hash ?? "deadbeef",
    rows: (j1.review ?? []).slice(0, 3),
  },
};
await putDoc(DECIDER, withReport);
const reread = await readBuilder(DECIDER);
ok("path_report_ai persists on the DRAFT (read-back)", Boolean(reread.doc?.path_report_ai?.rows), `${reread.doc?.path_report_ai?.rows?.length ?? 0} rows`);

// publish → the served /q.json must NOT contain path_report_ai
const pub = await ctx.request.post(builderData(DECIDER), { form: { intent: "publish", doc: JSON.stringify(withReport) } });
let pubJson = {};
try { pubJson = await pub.json(); } catch { /* html redirect */ }
ok("publish succeeds", pub.ok() && pubJson.ok !== false, JSON.stringify(pubJson).slice(0, 100));
const publishedText = await (await ctx.request.get(`${BASE}/q/${DECIDER}.json`)).text();
ok("published /q.json OMITS path_report_ai (stripped)", !publishedText.includes("path_report_ai"));

// restore the draft (drop the scratch field)
await putDoc(DECIDER, doc);

// ── byte baseline ────────────────────────────────────────────────────────────
const legacyAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy /q.json BYTE-IDENTICAL", legacyAfter === legacyBefore, `sha ${legacyAfter}`);

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
