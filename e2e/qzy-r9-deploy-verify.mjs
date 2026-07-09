// QZY-R9-2 DEPLOY verify — the override PICKER end-to-end on a fixture WITH a
// real synced catalog (the local fixture has none, so this closes that gap).
// Drives the real UI on the live deploy, then restores the draft in finally
// (net-zero). Only the DRAFT is touched (never publishes) — the published
// version + byte pin are untouched.
import { chromium } from "playwright";
const DEPLOY = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const FIX = "cmr3ku9kb0014qvl1ub8n5092"; // funnel-built decider, 2 real categories
const SHOT = process.env.SHOT || "/tmp/r9-deploy.png";
if (!KEY) { console.error("no token"); process.exit(1); }
let failures = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };

const loaderUrl = `${DEPLOY}/studio/${FIX}?_data=routes/studio_.$id`;
const putUrl = `${DEPLOY}/studio/${FIX}`;

const browser = await chromium.launch();
const ctx = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
ctx.on("pageerror", (e) => errs.push(String(e.message).split("\n")[0]));

// Authenticate (?key= → 302 → cookie), landing on the builder.
await ctx.goto(`${DEPLOY}/studio/${FIX}?key=${KEY}`, { waitUntil: "domcontentloaded" });
await ctx.waitForSelector(".qz-builder", { timeout: 25000 });
await ctx.waitForTimeout(1800);

// Backup the current draft (shares the browser's auth cookie).
const loadDoc = async () => (await (await ctx.request.get(loaderUrl)).json());
const start = await loadDoc();
const backup = start.doc;
const startRules = (backup.decision_rules ?? []).length;
const cats = start.categories ?? [];
const boards = cats.find((c) => /board/i.test(c.name)) ?? cats[0];
ok("deploy fixture is a decider with real categories", start.doc.logic_model === "decider" && cats.length >= 1,
  `logic_model=${start.doc.logic_model} cats=${cats.length}`);

try {
  // Logic → Table → expand the first result group.
  await ctx.locator(".qz-builder-rail button", { hasText: "Logic" }).click();
  await ctx.waitForTimeout(600);
  await ctx.locator(".qz-logic-tab", { hasText: "Table" }).click();
  await ctx.waitForTimeout(500);
  ok("Table tab renders the grid on the deploy", (await ctx.locator(".qz-ltable").count()) === 1);
  await ctx.locator(".qz-ltable-group").first().click();
  await ctx.waitForTimeout(400);

  // Hover the first per-path row → the override affordance is revealed (it is
  // GATED on categories existing — the whole point we could not test locally).
  const row = ctx.locator(".qz-ltable-path").first();
  await row.hover();
  await ctx.waitForTimeout(200);
  ok("override affordance is present (categories exist here)",
    (await ctx.locator(".qz-ltable-override").count()) >= 1);
  await ctx.locator(".qz-ltable-override").first().click();
  await ctx.waitForTimeout(300);

  // The picker lists the shop's REAL categories.
  const opts = await ctx.locator(".qz-ltable-select option").allInnerTexts();
  ok("the picker lists the shop's real categories", opts.some((o) => /board/i.test(o)),
    opts.filter(Boolean).join(" | "));

  // Pick the Boards bucket + Apply.
  await ctx.locator(".qz-ltable-select").selectOption({ label: boards.name });
  await ctx.waitForTimeout(150);
  await ctx.screenshot({ path: SHOT }); // picker open with real options
  await ctx.locator(".qz-ltable-apply").click();
  await ctx.waitForTimeout(500);

  // Toast (transient) + the rules bar now shows a rule targeting the REAL name.
  ok("a confirmation toast fired", (await ctx.locator(".qz-toast").count()) >= 1,
    await ctx.locator(".qz-toast").first().innerText().catch(() => ""));
  await ctx.waitForTimeout(400);
  ok("the shared rules bar shows the new rule with the real category name",
    (await ctx.locator(".qz-logic-rules").count()) === 1 &&
      (await ctx.locator(".qz-logic-rule-text").first().innerText()).includes(boards.name),
    await ctx.locator(".qz-logic-rule-text").first().innerText().catch(() => ""));

  // Re-enter the Table tab (remounts → expand state reset), then expand every
  // group fresh → the overridden path now carries the "rule" badge.
  await ctx.locator(".qz-logic-tab", { hasText: "Paths" }).click();
  await ctx.waitForTimeout(200);
  await ctx.locator(".qz-logic-tab", { hasText: "Table" }).click();
  await ctx.waitForTimeout(300);
  const groups = await ctx.locator(".qz-ltable-group").count();
  for (let i = 0; i < groups; i++) { await ctx.locator(".qz-ltable-group").nth(i).click(); await ctx.waitForTimeout(80); }
  ok("the overridden path re-badges 'rule'", (await ctx.locator(".qz-ltable-ruled").count()) >= 1,
    `badges=${await ctx.locator(".qz-ltable-ruled").count()}`);

  // Wait for autosave, then read the draft back → the rule IS a path signature.
  await ctx.waitForTimeout(900);
  const after = await loadDoc();
  const rule = (after.doc.decision_rules ?? []).at(-1);
  ok("a rule was appended to the draft", (after.doc.decision_rules ?? []).length === startRules + 1);
  ok("the rule targets the picked Boards category", rule?.target_id === boards.id,
    `${rule?.target_id} vs ${boards.id}`);
  ok("the rule's conditions are a path signature (≥1 AND, all op=is)",
    Array.isArray(rule?.conditions) && rule.conditions.length >= 1 &&
      rule.conditions.every((c) => c.op === "is" && c.question_id && c.answer_id),
    JSON.stringify(rule?.conditions?.map((c) => `${c.question_id}=${c.answer_id}`)));

  ok("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
} finally {
  // ALWAYS restore the exact original draft — net-zero (never touches publish).
  await ctx.request.put(putUrl, {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ doc: backup }),
  });
  await ctx.waitForTimeout(400);
  const restored = await loadDoc();
  ok("net-zero: draft restored to the original rule count",
    (restored.doc.decision_rules ?? []).length === startRules,
    `${(restored.doc.decision_rules ?? []).length} vs ${startRules}`);
  await browser.close();
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
