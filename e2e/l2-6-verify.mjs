// L2-6 live-verify — Rules surfaces on the standalone studio funnel.
// Seeds a decider doc via the REAL autosave PUT (L2-5's probe already
// click-verified role promotion), then drives the NEW rules affordances in a
// real browser: add rule → add condition → retarget → reorder → §9 delete
// confirm → inline accordion → read-back → restore. Temp probe.
import { chromium } from "playwright";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmqwd15f0001aqvl19onkpwm6";
const ROUTE = `${BASE}/studio/onboarding/${QUIZ}`;
const DATA = `${ROUTE}?_data=routes%2Fstudio.onboarding_.%24quizId`;

const out = { checks: {}, pageErrors: [], dialogs: [] };
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
  (
    await ctx.request.put(DATA, { headers: { "content-type": "application/json" }, data: { doc } })
  ).json();

const before = await fetchLoader();
const originalDoc = before.questionBuilder.doc;
ok("stage question_builder + no logic_model", before.stage === "question_builder" && originalDoc.logic_model == null);

try {
  // ── seed: decider doc with Q1 promoted (targets left unmapped) ──
  const qs = originalDoc.nodes.filter((n) => n.type === "question");
  const q1 = qs[0];
  const seeded = {
    ...originalDoc,
    logic_model: "decider",
    nodes: originalDoc.nodes.map((n) =>
      n.id === q1.id ? { ...n, data: { ...n.data, role: "decides", required: true } } : n,
    ),
  };
  const flip = await putDoc(seeded);
  ok("seed PUT ok", flip.ok === true);

  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await page.waitForSelector(".qz-ql-tabs", { timeout: 20000 });

  // ── Rules tab: empty state + precedence banner ──
  await page.locator(".qz-ql-tabs button", { hasText: "Rules" }).click();
  await page.waitForSelector(".qz-ql-rules", { timeout: 5000 });
  ok("§4.1 precedence banner on-screen", /first rule whose conditions ALL match wins/i.test((await page.locator(".qz-ql-rules-precedence").textContent()) ?? ""));
  ok("empty state renders", (await page.locator(".qz-ql-rules-empty").count()) === 1);

  // ── add a rule → half-built flag + est "—" ──
  await page.locator(".qz-ql-rules-add").click();
  await page.waitForSelector(".qz-ql-rule", { timeout: 5000 });
  ok("rule row appears (Rule 1)", /Rule 1/.test((await page.locator(".qz-ql-rule-prio").first().textContent()) ?? ""));
  ok("half-built flag (needs a condition)", (await page.locator(".qz-ql-rule-flag.is-half").count()) === 1);
  ok("est shows — while half-built", ((await page.locator(".qz-ql-rule-est").first().textContent()) ?? "").trim() === "—");

  // ── add a condition → dropdown-built If [Q] is [A]; est becomes ≈% ──
  await page.locator(".qz-ql-rule-addcond").first().click();
  await page.waitForSelector(".qz-ql-cond", { timeout: 5000 });
  ok("condition row: If join label", ((await page.locator(".qz-ql-cond-join").first().textContent()) ?? "").trim() === "If");
  ok("half-built flag cleared", (await page.locator(".qz-ql-rule-flag.is-half").count()) === 0);
  ok("est shows ≈%", /≈\d+%/.test((await page.locator(".qz-ql-rule-est").first().textContent()) ?? ""));
  ok("§4.3 fall-through note", /match no rule/i.test((await page.locator(".qz-ql-rules-fallthrough").textContent()) ?? ""));

  // pick the SECOND answer via the condition answer select (dropdown-built)
  const answerSel = page.locator(".qz-ql-cond select").nth(2);
  const answerVals = await answerSel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  await answerSel.selectOption(answerVals[1] ?? answerVals[0]);

  // retarget the rule via the target select
  const targetSel = page.locator(".qz-ql-rule-target select").first();
  const targetVals = await targetSel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  const pickedTarget = targetVals[targetVals.length - 1];
  await targetSel.selectOption(pickedTarget);

  // ── second rule + ↑ reorder (priority = array order) ──
  await page.locator(".qz-ql-rules-add").click();
  await page.waitForFunction(() => document.querySelectorAll(".qz-ql-rule").length === 2);
  await page.locator(".qz-ql-rule").nth(1).locator("button[title='Raise priority']").click();
  await page.waitForTimeout(2500); // debounced autosave

  // ── read back: order + condition + target persisted ──
  const mid = await fetchLoader();
  const rules = mid.questionBuilder.doc.decision_rules ?? [];
  ok("2 rules persisted", rules.length === 2);
  ok("reorder persisted (the once-second rule is now FIRST: 0 conditions)", rules[0]?.conditions.length === 0);
  ok("condition persisted on the now-second rule", rules[1]?.conditions.length === 1 && rules[1].conditions[0].op === "is");
  ok("condition answer persisted", rules[1]?.conditions[0]?.answer_id === (answerVals[1] ?? answerVals[0]));
  ok("target persisted", rules[1]?.target_id === pickedTarget);
  ok("stage NOT rewound", mid.stage === "question_builder");

  // ── inline accordion (§4.2) on the referenced question ──
  await page.locator(".qz-ql-tabs button", { hasText: "Builder" }).click();
  await page.waitForSelector(".qz-ql-inline-rules", { timeout: 5000 });
  const q1Card = page.locator(".qz-ql-card").first();
  const summaryText = (await q1Card.locator(".qz-ql-inline-rules summary").textContent()) ?? "";
  ok("accordion shows count (1) on the referenced card", /Advanced rules \(1\)/.test(summaryText));
  await q1Card.locator(".qz-ql-inline-rules summary").click();
  ok("expanded summary names the rule", /Rule 2/.test((await q1Card.locator(".qz-ql-inline-rules").textContent()) ?? ""));
  await q1Card.locator(".qz-ql-inline-rules-edit").click();
  ok("Edit-in-Rules-tab switches the view", (await page.locator(".qz-ql-rules").count()) === 1);

  // ── §9 delete-with-consequences: deleting the referenced ANSWER confirms ──
  await page.locator(".qz-ql-tabs button", { hasText: "Builder" }).click();
  await page.waitForSelector(".qz-ql-card");
  page.once("dialog", (d) => {
    out.dialogs.push(d.message());
    d.dismiss(); // do NOT actually delete
  });
  // the condition references q1's answer at answerVals index — find its row by position
  const refIdx = answerVals.indexOf(answerVals[1] ?? answerVals[0]);
  await q1Card.locator(".qz-ql-adel").nth(refIdx).click();
  await page.waitForTimeout(300);
  ok("§9 answer-delete confirm fired with consequences", out.dialogs.some((m) => /1 advanced rule .*will break/i.test(m) || /rule.*reference this answer/i.test(m)));

  // ── rule delete confirm (accept) ──
  await page.locator(".qz-ql-tabs button", { hasText: "Rules" }).click();
  await page.waitForSelector(".qz-ql-rule");
  page.once("dialog", (d) => {
    out.dialogs.push(d.message());
    d.accept();
  });
  await page.locator(".qz-ql-rule-del").first().click();
  await page.waitForFunction(() => document.querySelectorAll(".qz-ql-rule").length === 1);
  ok("rule delete confirm carried the summary", out.dialogs.some((m) => /Delete this rule\?/.test(m)));
  await page.waitForTimeout(2500);
  const afterDel = await fetchLoader();
  ok("delete persisted (1 rule left)", (afterDel.questionBuilder.doc.decision_rules ?? []).length === 1);
} finally {
  const restore = await putDoc(originalDoc);
  ok("RESTORED original doc", restore.ok === true);
  const final = await fetchLoader();
  ok("restore: no logic_model / rules / roles", final.questionBuilder.doc.logic_model == null && (final.questionBuilder.doc.decision_rules ?? []).length === 0 && !final.questionBuilder.doc.nodes.some((n) => n.type === "question" && n.data.role != null));
}

ok("ZERO page errors", out.pageErrors.length === 0);
if (out.pageErrors.length) console.log("pageErrors:", out.pageErrors);

await browser.close();
const failed = Object.entries(out.checks).filter(([, v]) => !v);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} FAILED: ${failed.map(([k]) => k).join(" · ")}`);
process.exit(failed.length === 0 ? 0 : 1);
