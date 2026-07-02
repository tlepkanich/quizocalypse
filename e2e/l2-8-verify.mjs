// L2-8 live-verify — Step-4 v2 rec-page builder on the standalone studio.
// Seeds a decider doc, walks the funnel to the rec_page stage via the REAL
// Continue intent, drives the target selector + global edits + a per-target
// override + validate-discount, reads persistence back, then restores the doc
// AND the funnel stage. Temp probe.
import { chromium } from "playwright";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmqwd15f0001aqvl19onkpwm6";
const ROUTE = `${BASE}/studio/onboarding/${QUIZ}`;
const DATA = `${ROUTE}?_data=routes%2Fstudio.onboarding_.%24quizId`;

const out = { checks: {}, pageErrors: [] };
const ok = (name, v) => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
const fetchLoader = async () => (await ctx.request.get(DATA)).json();
const putDoc = async (doc) =>
  (await ctx.request.put(DATA, { headers: { "content-type": "application/json" }, data: { doc } })).json();
const postIntent = async (intent) =>
  ctx.request.post(DATA, { form: { intent } });

const before = await fetchLoader();
const originalDoc = before.questionBuilder.doc;
const buckets = before.questionBuilder.categories;
ok("baseline: question_builder + no logic_model", before.stage === "question_builder" && originalDoc.logic_model == null);

try {
  // ── seed a decider doc (roles + targets all mapped) ──
  const q1 = originalDoc.nodes.filter((n) => n.type === "question")[0];
  const seeded = {
    ...originalDoc,
    logic_model: "decider",
    nodes: originalDoc.nodes.map((n) =>
      n.id === q1.id
        ? {
            ...n,
            data: {
              ...n.data,
              role: "decides",
              required: true,
              answers: n.data.answers.map((a, i) => ({ ...a, target_id: buckets[i % buckets.length].id })),
            },
          }
        : n,
    ),
  };
  ok("seed PUT ok", (await putDoc(seeded)).ok === true);

  // ── advance to the rec_page stage via the REAL intent ──
  await postIntent("to-rec-page");
  const atRec = await fetchLoader();
  ok("advanced to rec_page stage", atRec.stage === "rec_page");

  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await page.waitForSelector(".qz-rp2", { timeout: 20000 });

  // ── the v2 surface renders (NOT the legacy per-node panel) ──
  ok("v2 panel renders (Editing selector)", (await page.locator(".qz-rp2-editing select").count()) === 1);
  const options = await page.locator(".qz-rp2-editing option").allTextContents();
  ok("selector = All results + one per target", options.length === buckets.length + 1 && /All results/.test(options[0]));
  ok("v2 preview renders with a hero card", (await page.locator(".qz-rp2p-card.is-hero").count()) === 1);
  ok("preview headline shows the DEFAULT", /Your perfect match/.test((await page.locator(".qz-rp2p-headline").textContent()) ?? ""));

  // ── global edit: headline + heroLogic → preview updates + persists ──
  await page.locator(".qz-rp2-field input").first().fill("Probe headline");
  await page.waitForTimeout(300);
  ok("preview follows the headline edit live", /Probe headline/.test((await page.locator(".qz-rp2p-headline").textContent()) ?? ""));
  await page.locator(".qz-rp2-field select").first().selectOption("newest");
  await page.waitForTimeout(2500); // debounced autosave
  const mid = await fetchLoader();
  const rp1 = mid.questionBuilder?.doc?.rec_page_settings ?? mid.recPage?.doc?.rec_page_settings;
  ok("persisted: SPARSE global {headline, heroLogic} only", rp1?.global?.headline === "Probe headline" && rp1?.global?.heroLogic === "newest" && Object.keys(rp1?.global ?? {}).length === 2);

  // ── per-target override: pick target 1 → breakout → override headline ──
  await page.locator(".qz-rp2-editing select").selectOption(buckets[0].id);
  await page.waitForSelector(".qz-rp2-breakout", { timeout: 5000 });
  await page.locator(".qz-rp2-breakout input").check();
  await page.waitForSelector(".qz-rp2-inherit", { timeout: 5000 });
  ok("override editor shows 'inherits global' hints", (await page.locator(".qz-rp2-inherit").count()) > 0);
  await page.locator(".qz-rp2-field input").first().fill("Override headline");
  await page.waitForTimeout(2500);
  const mid2 = await fetchLoader();
  const rp2 = mid2.questionBuilder?.doc?.rec_page_settings ?? mid2.recPage?.doc?.rec_page_settings;
  ok("persisted: sparse override {headline} for the target", rp2?.overrides?.[buckets[0].id]?.headline === "Override headline" && Object.keys(rp2?.overrides?.[buckets[0].id] ?? {}).length === 1);
  ok("selector flags the stored override ●", ((await page.locator(".qz-rp2-editing option").allTextContents()).some((t) => t.startsWith("● "))));
  ok("preview shows the OVERRIDE headline for this target", /Override headline/.test((await page.locator(".qz-rp2p-headline").textContent()) ?? ""));
  ok("global-only sections hidden in override mode", (await page.locator(".qz-rp2-field:has-text('Grid size')").count()) === 0);

  // ── validate-discount: standalone shop degrades to the info note ──
  await page.locator(".qz-rp2-editing select").selectOption("");
  await page.locator(".qz-rp2-check input").nth(3).check().catch(() => {});
  const incentiveToggle = page.locator(".qz-rp2-check").filter({ hasText: "discount incentive" }).locator("input");
  if (!(await incentiveToggle.isChecked())) await incentiveToggle.check();
  const codeInput = page.locator(".qz-rp2-field").filter({ hasText: "discount code" }).locator("input");
  await codeInput.fill("PROBE10");
  await codeInput.blur();
  await page.waitForTimeout(2000);
  const note = (await page.locator(".qz-rp2").textContent()) ?? "";
  ok("validate-discount degrades gracefully on standalone", /Connect your Shopify store|Can't validate/.test(note));

  // ── remove the override (toggle OFF) → inherits again ──
  await page.locator(".qz-rp2-editing select").selectOption(buckets[0].id);
  await page.locator(".qz-rp2-breakout input").uncheck();
  await page.waitForTimeout(2500);
  const mid3 = await fetchLoader();
  const rp3 = mid3.questionBuilder?.doc?.rec_page_settings ?? mid3.recPage?.doc?.rec_page_settings;
  ok("toggle OFF removed the override", !rp3?.overrides || !rp3.overrides[buckets[0].id]);
} finally {
  // restore the funnel stage FIRST (back to question_builder), then the doc
  await postIntent("to-question-builder");
  const restore = await putDoc(originalDoc);
  ok("RESTORED original doc", restore.ok === true);
  const final = await fetchLoader();
  ok("restore verified: stage question_builder + no logic_model + no rec_page_settings",
    final.stage === "question_builder" &&
    final.questionBuilder.doc.logic_model == null &&
    final.questionBuilder.doc.rec_page_settings == null);
}

ok("ZERO page errors", out.pageErrors.length === 0);
if (out.pageErrors.length) console.log("pageErrors:", out.pageErrors);

await browser.close();
const failed = Object.entries(out.checks).filter(([, v]) => !v);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} FAILED: ${failed.map(([k]) => k).join(" · ")}`);
process.exit(failed.length === 0 ? 0 : 1);
