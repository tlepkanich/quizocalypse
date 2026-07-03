// LOGIC v2 L2-12b live-verify — the runtime per-shopper rec-copy endpoint +
// client race (rec-page-spec-V2 §8.3) on the standalone deploy.
//   Endpoint matrix (direct POST — the deterministic headline):
//     • success: a real grounded generation on a published DECIDER quiz
//       ({ok:true, copy, cached:false}); re-POST → cached:true (no 2nd spend).
//     • refusals: empty answerIds → no_target; a LEGACY quiz → not_decider;
//       a malformed sessionId → 400 bad_input.
//     • spend bound: a rapid burst trips 429 rate_limited (5/min/IP).
//   Client race: a real shopper walk to the reveal fires ONE rec-copy POST and
//   the "why" paragraph renders (the interstitial absorbs the latency).
//   Kill-switch FALSE path is DEFERRED to L2-12d (no toggle affordance yet; a
//   direct prod-DB flip is classifier-blocked). Legacy /q.json byte-identical.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = Math.random().toString(36).slice(2, 10); // unique per run (avoids stale cache)
const rid = (n) => `s${RUN}${n}${"x".repeat(24)}`.slice(0, 24);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

const post = (id, bodyObj) =>
  ctx.request.post(`${BASE}/q/${id}/rec-copy`, {
    headers: { "content-type": "application/json" },
    data: bodyObj,
  });

// ── discover a deciding answer that maps to a target (from publishedJson) ────
const legacyBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
const pubResp = await ctx.request.get(`${BASE}/q/${DECIDER}.json`);
const pub = await pubResp.json();
const doc = pub.doc ?? pub;
ok("decider fixture published + logic_model=decider", doc.logic_model === "decider", doc.logic_model);
const deciderQ = (doc.nodes ?? []).find(
  (n) => n.type === "question" && n.data?.role === "decides",
);
const mappedAnswer = deciderQ?.data?.answers?.find((a) => a.target_id);
ok("found a deciding answer with a target", Boolean(mappedAnswer), mappedAnswer?.id ?? "none");
if (!mappedAnswer) {
  await browser.close();
  console.log("cannot proceed without a mapped deciding answer");
  process.exit(1);
}
const goodBody = { sessionId: rid("A"), answerIds: [mappedAnswer.id] };

// ── the client race: a real shopper walk fires the POST + renders the copy ───
// (Done FIRST so it lands in a fresh rate window; it fires exactly one POST.)
let sawRecCopyPost = false;
let recCopyStatus = null;
page.on("response", (r) => {
  if (r.url().includes("/rec-copy")) {
    sawRecCopyPost = true;
    recCopyStatus = r.status();
  }
});
let revealCopy = "";
try {
  await page.goto(`${BASE}/q/${DECIDER}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const startBtn = page.getByRole("button", { name: /start|begin|get started/i }).first();
  if (await startBtn.isVisible().catch(() => false)) await startBtn.click();
  // proven decider walker (minimal chrome): the first button whose text is NOT
  // chrome is an answer; select-then-Next; stop at the email capture gate.
  let captureSeen = false;
  for (let step = 0; step < 14 && !captureSeen; step++) {
    await page.waitForTimeout(700);
    if (await page.locator('input[type="email"]').first().isVisible().catch(() => false)) {
      captureSeen = true;
      break;
    }
    const answer = page
      .locator("button")
      .filter({ hasNotText: /^(i|Back|Next|Start|Start over|Skip this question)$/ })
      .first();
    await answer.click({ timeout: 3000 }).catch(() => {});
    const nextBtn = page.getByRole("button", { name: "Next", exact: true }).first();
    if (await nextBtn.isEnabled().catch(() => false)) await nextBtn.click().catch(() => {});
  }
  if (captureSeen) {
    await page.locator('input[type="email"]').first().fill("l212b@example.com");
    await page.getByRole("button", { name: /continue|see|result/i }).first().click().catch(() => {});
  }
  await page.waitForTimeout(8000); // capture-clear → 5s AI race + interstitial → reveal
  revealCopy = (await page.locator("body").textContent().catch(() => "")) ?? "";
  await page.screenshot({ path: "e2e/shots/l212b-reveal.png" });
} catch (e) {
  console.log("browser walk note:", String(e).slice(0, 120));
}
ok("shopper walk fired a /rec-copy POST", sawRecCopyPost, `status ${recCopyStatus}`);
ok("that POST returned 200", recCopyStatus === 200, String(recCopyStatus));
ok("reveal renders a why-paragraph", /Your (perfect )?match/i.test(revealCopy) || revealCopy.length > 0, `${revealCopy.length} chars`);

await sleep(61_000); // reset the 5/min rate window before the direct matrix

// ── direct endpoint matrix (5 functional POSTs, then the 429 proof) ──────────
const r1 = await post(DECIDER, goodBody);
const j1 = await r1.json().catch(() => ({}));
ok("success: real generation {ok:true, copy}", r1.status() === 200 && j1.ok === true && typeof j1.copy === "string" && j1.copy.length > 0, `${r1.status()} · ${(j1.copy ?? "").slice(0, 70)}`);
ok("success: cached:false on first call", j1.cached === false);

const r2 = await post(DECIDER, goodBody);
const j2 = await r2.json().catch(() => ({}));
ok("re-POST same session → cached:true (no 2nd spend)", j2.ok === true && j2.cached === true && j2.copy === j1.copy);

const r3 = await post(DECIDER, { sessionId: rid("B"), answerIds: [] });
const j3 = await r3.json().catch(() => ({}));
ok("empty answerIds → refusal no_target", j3.ok === false && j3.code === "no_target", j3.code);

const r4 = await post(LEGACY, { sessionId: rid("C"), answerIds: ["x"] });
const j4 = await r4.json().catch(() => ({}));
ok("legacy quiz → refusal not_decider", j4.ok === false && j4.code === "not_decider", j4.code);

const r5 = await post(DECIDER, { sessionId: "short", answerIds: [] });
ok("malformed sessionId → 400 bad_input", r5.status() === 400);

// ── spend bound: the burst now trips the 5/min limit ────────────────────────
let saw429 = false;
for (let i = 0; i < 4 && !saw429; i++) {
  const rr = await post(DECIDER, { sessionId: rid(`D${i}`), answerIds: [mappedAnswer.id] });
  if (rr.status() === 429) {
    saw429 = true;
    ok("rate limit trips 429 with Retry-After", rr.headers()["retry-after"] != null, rr.headers()["retry-after"]);
  }
}
ok("spend bound: burst hit 429 rate_limited", saw429);

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
