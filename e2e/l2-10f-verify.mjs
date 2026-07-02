// L2-10f live-verify — the legacy→decider upgrade WIZARD on the deploy.
// On the real legacy quiz cmr0tattc… (3 buckets · 3 result pages):
// 1. Back up its draft, publish the LEGACY doc (the draft-only baseline sha).
// 2. Builder: legacy topbar shows scoring + "↑ Upgrade" → the modal opens via
//    a REAL click (portal pointer-trap check) with the deciding question,
//    merged pages, and the email-mandatory disclosure → Cancel closes.
// 3. Confirm → the draft flips to a VALID decider doc (stamp, roles, targets,
//    ONE result, loader valid:true) and the topbar shows the ◆ badge.
// 4. Top-bar UNDO restores the legacy draft BYTE-IDENTICALLY (one step).
// 5. Re-upgrade → the published /q.json sha is UNCHANGED (draft-only proof).
// 6. Republish → the shopper flow now runs capture → loading → reveal.
// 7. Legacy harness sha + zero page errors. The quiz is LEFT UPGRADED as the
//    program's wizard fixture (original draft backed up beside the memories).
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const FIXTURE = "cmr0tattc001lqvl075wc1lnh";
const LEGACY = "cmqqcb0ao004mqvkwjug7t0ya";
const BACKUP = `${process.env.HOME}/.claude/projects/-Users-tylerlepkanich-Desktop-projects-quizocalypse/l2-10f-${FIXTURE}-legacy-draft-backup.json`;

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
const harnessBefore = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());

const builderData = `${BASE}/studio/${FIXTURE}?_data=routes%2Fstudio_.%24id`;
const readLoader = async () => (await ctx.request.get(builderData)).json();
const publish = (doc) =>
  ctx.request.post(builderData, { form: { intent: "publish", doc: JSON.stringify(doc) } });

// ── 1. backup + publish the LEGACY baseline ─────────────────────────────────
let loaded = await readLoader();
if (loaded.doc.logic_model === "decider") {
  console.log("fixture already upgraded — aborting to avoid double-converting");
  process.exit(1);
}
writeFileSync(BACKUP, JSON.stringify(loaded.doc));
console.log(`legacy draft backed up: ${BACKUP}`);
const legacyDraftSha = sha(JSON.stringify(loaded.doc));

const pub1 = await publish(loaded.doc);
let pub1Json = {};
try { pub1Json = await pub1.json(); } catch { /* html */ }
ok("legacy doc publishes (baseline)", pub1.ok() && pub1Json.ok !== false, JSON.stringify(pub1Json).slice(0, 100));
const pubShaLegacy = sha(await (await ctx.request.get(`${BASE}/q/${FIXTURE}.json`)).text());
ok("published legacy sha snapshotted", Boolean(pubShaLegacy), pubShaLegacy);

// ── 2. builder: legacy affordances + the modal (REAL clicks) ────────────────
await page.goto(`${BASE}/studio/${FIXTURE}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const upgradeBtn = page.getByRole("button", { name: "↑ Upgrade to Decider logic" }).first();
ok("legacy topbar shows the Upgrade button", await upgradeBtn.isVisible().catch(() => false));
ok("legacy topbar keeps the scoring toggle", await page.getByRole("button", { name: /Direct mapping|Weighted scoring/ }).first().isVisible().catch(() => false));

await upgradeBtn.click();
await page.waitForTimeout(500);
const dialog = page.getByRole("dialog", { name: "Upgrade to Decider logic" });
ok("modal opens on a REAL click (portal pointer-trap check)", await dialog.isVisible().catch(() => false));
const modalText = (await dialog.textContent().catch(() => "")) ?? "";
ok("modal names the deciding question", /riding ability|First things first/i.test(modalText), modalText.slice(0, 90));
ok("modal lists the merged pages", /fold into|single results page/i.test(modalText));
ok("modal carries the email-mandatory disclosure", /Email capture becomes required/i.test(modalText));
ok("modal states draft-only + undo", /this draft only/i.test(modalText) && /Undo restores/i.test(modalText));
await page.screenshot({ path: "e2e/shots/l2-10f-modal.png" });

await dialog.getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(300);
ok("Cancel closes the modal", !(await dialog.isVisible().catch(() => false)));

// ── 3. confirm → decider draft + ◆ badge ────────────────────────────────────
await upgradeBtn.click();
await page.waitForTimeout(400);
await dialog.getByRole("button", { name: "Upgrade this draft →" }).click();
await page.waitForTimeout(2200); // commit + autosave debounce
loaded = await readLoader();
const upgraded = loaded.doc;
const deciders = upgraded.nodes.filter((n) => n.type === "question" && n.data.role === "decides");
ok("draft is now a decider doc", upgraded.logic_model === "decider");
ok("EXACTLY ONE deciding question, required, all answers targeted",
  deciders.length === 1 && deciders[0].data.required === true &&
  deciders[0].data.answers.every((a) => Boolean(a.target_id)));
ok("result pages merged to ONE", upgraded.nodes.filter((n) => n.type === "result").length === 1);
ok("per-target headline overrides seeded", Object.keys(upgraded.rec_page_settings?.overrides ?? {}).length >= 1);
ok("loader validates the upgraded draft (validateQuiz clean)", loaded.valid === true, JSON.stringify(loaded.issues ?? []).slice(0, 120));
ok("topbar shows the ◆ Decider badge", await page.getByText("◆ Decider logic").first().isVisible().catch(() => false));
ok("scoring toggle GONE for the decider doc", !(await page.getByRole("button", { name: /Weighted scoring|→ Direct mapping/ }).first().isVisible().catch(() => false)));

// ── 4. one-step UNDO restores the legacy draft byte-identically ─────────────
await page.getByRole("button", { name: "Undo" }).click();
await page.waitForTimeout(2200);
loaded = await readLoader();
ok("UNDO restores the legacy draft BYTE-IDENTICALLY (one step)",
  sha(JSON.stringify(loaded.doc)) === legacyDraftSha && loaded.doc.logic_model === undefined,
  sha(JSON.stringify(loaded.doc)));

// ── 5. re-upgrade → published sha UNCHANGED (draft-only proof) ──────────────
await page.getByRole("button", { name: "↑ Upgrade to Decider logic" }).first().click();
await page.waitForTimeout(400);
await dialog.getByRole("button", { name: "Upgrade this draft →" }).click();
await page.waitForTimeout(2200);
loaded = await readLoader();
ok("re-upgraded to decider", loaded.doc.logic_model === "decider");
const pubShaMid = sha(await (await ctx.request.get(`${BASE}/q/${FIXTURE}.json`)).text());
ok("published /q.json sha UNCHANGED after two upgrades + an undo (DRAFT-ONLY)", pubShaMid === pubShaLegacy, pubShaMid);

// ── 6. republish → capture → loading → reveal ───────────────────────────────
const pub2 = await publish(loaded.doc);
let pub2Json = {};
try { pub2Json = await pub2.json(); } catch { /* html */ }
ok("upgraded doc republishes (V-gates + target bake)", pub2.ok() && pub2Json.ok !== false, JSON.stringify(pub2Json).slice(0, 120));

const shopper = await ctx.newPage();
shopper.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));
await shopper.goto(`${BASE}/q/${FIXTURE}`, { waitUntil: "domcontentloaded" });
await shopper.waitForTimeout(800);
const startBtn = shopper.getByRole("button", { name: /start|begin|get started/i }).first();
if (await startBtn.isVisible().catch(() => false)) await startBtn.click();
let captureSeen = false;
for (let step = 0; step < 14; step++) {
  await shopper.waitForTimeout(700);
  if (await shopper.locator('input[type="email"]').first().isVisible().catch(() => false)) { captureSeen = true; break; }
  const freeform = shopper.locator('input[type="text"], textarea').first();
  if (await freeform.isVisible().catch(() => false)) await freeform.fill("probe answer").catch(() => {});
  const answer = shopper
    .locator("button")
    .filter({ hasNotText: /^(i|Back|Next|Start|Start over|Skip this question)$/ })
    .first();
  await answer.click({ timeout: 3000 }).catch(() => {});
  const nextBtn = shopper.getByRole("button", { name: "Next", exact: true }).first();
  if (await nextBtn.isEnabled().catch(() => false)) await nextBtn.click().catch(() => {});
}
ok("republished shopper flow reaches CAPTURE (the §7 cutover)", captureSeen);
if (captureSeen) {
  await shopper.locator('input[type="email"]').first().fill("l2-10f@example.com");
  await shopper.getByRole("button", { name: "Continue" }).first().click();
  await shopper.waitForTimeout(3200);
  const revealText = (await shopper.locator("body").textContent().catch(() => "")) ?? "";
  ok("REVEAL renders with the carried per-target headline or the default + hero badge",
    /top pick for you/i.test(revealText));
  await shopper.screenshot({ path: "e2e/shots/l2-10f-reveal.png" });
}
await shopper.close();

// ── 7. harness + errors ─────────────────────────────────────────────────────
const harnessAfter = sha(await (await ctx.request.get(`${BASE}/q/${LEGACY}.json`)).text());
ok("legacy harness /q.json BYTE-IDENTICAL", harnessAfter === harnessBefore, harnessAfter);
ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));

await browser.close();
const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\nwizard fixture (left upgraded + republished): ${FIXTURE}`);
console.log(`${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
