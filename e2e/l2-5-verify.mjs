// L2-5 live-verify — decider-mode Step-3 UI shell on the standalone studio funnel.
// Flips a question_builder draft to logic_model="decider" via the REAL autosave
// JSON-PUT, drives the role-toggle + target-mapping affordances in a real browser,
// reads the draft back, then RESTORES the original doc. Temp probe — delete after.
import { chromium } from "playwright";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmqwd15f0001aqvl19onkpwm6"; // the proven QL question_builder draft
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

// ── auth ──
await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

const fetchLoader = async () => {
  const r = await ctx.request.get(DATA);
  return r.json();
};
const putDoc = async (doc) => {
  const r = await ctx.request.put(DATA, {
    headers: { "content-type": "application/json" },
    data: { doc },
  });
  return r.json();
};

// ── snapshot the original ──
const before = await fetchLoader();
const originalDoc = before.questionBuilder.doc;
ok("stage is question_builder", before.stage === "question_builder");
ok("original has NO logic_model", !("logic_model" in originalDoc) || originalDoc.logic_model == null);

try {
  // ── 0. LEGACY regression: the untouched draft renders the legacy tabs ──
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await page.waitForSelector(".qz-ql-tabs", { timeout: 20000 });
  const legacyTabs = await page.locator(".qz-ql-tabs button").allTextContents();
  ok("legacy tabs = Builder/Table/Flow", JSON.stringify(legacyTabs) === JSON.stringify(["Builder", "Table", "Flow"]));
  ok("legacy scoring swap button present", (await page.locator("button:has-text('Direct mapping'), button:has-text('Weighted scoring')").count()) > 0);
  ok("legacy has NO role toggles", (await page.locator(".qz-ql-roletoggle").count()) === 0);
  ok("legacy bucket selects present", (await page.locator(".qz-ql-bucket").count()) > 0);

  // ── 1. flip to decider via the REAL autosave PUT ──
  const flip = await putDoc({ ...originalDoc, logic_model: "decider" });
  ok("PUT flip ok", flip.ok === true);

  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await page.waitForSelector(".qz-ql-tabs", { timeout: 20000 });

  // ── 2. decider-mode shell ──
  const tabs = await page.locator(".qz-ql-tabs button").allTextContents();
  ok("decider tabs = Builder/Flow/Rules (Table unmounted)", JSON.stringify(tabs) === JSON.stringify(["Builder", "Flow", "Rules"]));
  ok("topbar ◆ Decider logic badge", (await page.locator(".qz-ql-modelbadge").count()) === 1);
  ok("scoring swap button GONE", (await page.locator("button:has-text('Direct mapping')").count()) === 0);
  const roleToggles = await page.locator(".qz-ql-roletoggle").count();
  ok("role toggle on every card", roleToggles > 0);
  ok("no decider yet → no gold card", (await page.locator(".qz-ql-card.is-decider").count()) === 0);
  ok("qualifier rows hide the bucket column", (await page.locator(".qz-ql-bucket").count()) === 0);
  ok("qualifier rows keep the skip dropdown", (await page.locator(".qz-ql-skip").count()) > 0);
  ok("coverage pills render neutral unused", (await page.locator(".qz-ql-cov-pill.is-unused").count()) >= 0);

  // Rules tab placeholder
  await page.locator(".qz-ql-tabs button", { hasText: "Rules" }).click();
  ok("Rules placeholder renders", (await page.locator(".qz-ql-rules-placeholder").count()) === 1);
  await page.locator(".qz-ql-tabs button", { hasText: "Builder" }).click();

  // ── 3. Continue with NO decider → no-decider guard ──
  await page.locator("button:has-text('Continue →')").click();
  await page.waitForSelector(".qz-ql-guard", { timeout: 5000 });
  const guardTitle1 = await page.locator(".qz-ql-guard-title").textContent();
  ok("no-decider guard fires", /No deciding question/i.test(guardTitle1 ?? ""));
  await page.locator(".qz-ql-guard button:has-text('Fix it')").click();

  // ── 4. promote Q1 to decider via the real affordance ──
  const firstCard = page.locator(".qz-ql-card").first();
  await firstCard.locator(".qz-ql-roletoggle").click();
  await page.waitForSelector(".qz-ql-card.is-decider", { timeout: 5000 });
  ok("gold decider card + banner", (await page.locator(".qz-ql-decider-banner").count()) === 1);
  ok("toggle reads ◆ Decides the result", /Decides the result/.test((await firstCard.locator(".qz-ql-roletoggle").textContent()) ?? ""));
  ok("Required pill LOCKED on decider", await firstCard.locator(".qz-ql-reqtoggle").isDisabled());
  ok("decider rows show the target dropdown", (await firstCard.locator(".qz-ql-target").count()) > 0);
  ok("header says Points to result", /Points to result/.test((await firstCard.locator(".qz-ql-ahead").textContent()) ?? ""));
  ok("left list gold ◆ marker", (await page.locator(".qz-ql-dot.is-decider").count()) === 1);

  // ── 5. Continue with unmapped decider answers → unmapped guard ──
  await page.locator("button:has-text('Continue →')").click();
  await page.waitForSelector(".qz-ql-guard", { timeout: 5000 });
  const guardTitle2 = await page.locator(".qz-ql-guard-title").textContent();
  ok("unmapped-answers guard fires", /point at a result/i.test(guardTitle2 ?? ""));
  await page.locator(".qz-ql-guard button:has-text('Fix it')").click();

  // ── 6. map the first deciding answer to a target ──
  const targetSel = firstCard.locator(".qz-ql-target").first();
  const optionVals = await targetSel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  ok("target dropdown offers categories", optionVals.length > 0);
  await targetSel.selectOption(optionVals[0]);
  // wait for the debounced autosave to land
  await page.waitForTimeout(2500);

  // ── 7. read the draft back — role/required/target persisted ──
  const after = await fetchLoader();
  const doc2 = after.questionBuilder.doc;
  const q1 = doc2.nodes.find((n) => n.type === "question" && n.data.role === "decides");
  ok("persisted: exactly one decides question", !!q1 && doc2.nodes.filter((n) => n.type === "question" && n.data.role === "decides").length === 1);
  ok("persisted: decider required=true", q1?.data.required === true);
  ok("persisted: first answer target_id", q1?.data.answers?.[0]?.target_id === optionVals[0]);
  ok("persisted: stage NOT rewound", after.stage === "question_builder");

  // ── 8. demote back to qualifier (exclusivity path) ──
  await firstCard.locator(".qz-ql-roletoggle").click();
  await page.waitForTimeout(2500);
  const after2 = await fetchLoader();
  ok("demote persisted (no decider)", !after2.questionBuilder.doc.nodes.some((n) => n.type === "question" && n.data.role === "decides"));
} finally {
  // ── restore the ORIGINAL doc, whatever happened ──
  const restore = await putDoc(originalDoc);
  ok("RESTORED original doc", restore.ok === true);
  const final = await fetchLoader();
  ok("restore verified: logic_model absent", !("logic_model" in final.questionBuilder.doc) || final.questionBuilder.doc.logic_model == null);
  ok("restore verified: no role keys", !final.questionBuilder.doc.nodes.some((n) => n.type === "question" && n.data.role != null));
}

ok("ZERO page errors (#418/#425/#423)", out.pageErrors.length === 0);
if (out.pageErrors.length) console.log("pageErrors:", out.pageErrors);

await browser.close();
const failed = Object.entries(out.checks).filter(([, v]) => !v);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} FAILED: ${failed.map(([k]) => k).join(" · ")}`);
process.exit(failed.length === 0 ? 0 : 1);
