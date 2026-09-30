// Logic step · Table view, Export and Import live-verify (handoff "Table
// view, Export and Import"; D16, D16-template, B3, B21, B22, B26, B37, B40)
// against a LOCAL production build + local DB.
//
// Never edits the shared fixture: it clones cmr7khgd50001vkhscvox8dgt (and
// its quiz-scoped Category rows, under new ids) into a temporary quiz, drives
// that copy in BOTH logic styles, and deletes the copy in `finally`.
//
//   Filter Results + Rules  Table (Rules then Answers) · every cell popover
//                           (type, role, Choose a result, route) with
//                           screenshots · B40 (the Edit selection never moves)
//                           · Export → re-import = "Nothing changed" ·
//                           an edited file (answer rename + rule edit) =
//                           "Imported 2 changes" · Undo · a bad rule row
//                           (all or nothing) · markup stays text (B21) · a
//                           UTF-8 CSV (B26) · autosave persisted.
//   Rules only              Table (Rules then Recommendations) · trash +
//                           Undo · Export of an empty quiz is the template
//                           (one example row) · importing it back changes
//                           nothing and says so · a row under the example
//                           imports.
//
//   set -a; source .env; set +a
//   BASE=http://localhost:3000 node e2e/logic-table-io-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SRC = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-table-io-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
const mask = (s) => String(s).replaceAll(KEY, "***");

const prisma = new PrismaClient();
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${mask(detail)}` : ""}`);
  if (!cond) failures++;
};

// ── the temporary copy ─────────────────────────────────────────────────────
async function cloneQuiz(style) {
  const quiz = await prisma.quiz.findUnique({ where: { id: SRC } });
  if (!quiz) throw new Error("fixture quiz not found");
  const cats = await prisma.category.findMany({ where: { quizId: SRC } });
  const id = `e2etable${randomBytes(6).toString("hex")}`;
  let json = JSON.stringify(quiz.draftJson);
  const map = new Map();
  for (const c of cats) {
    const nid = `e2etcat${randomBytes(6).toString("hex")}`;
    map.set(c.id, nid);
    json = json.split(c.id).join(nid);
  }
  const doc = JSON.parse(json);
  doc.logic_style = style;
  // Two rules at least, so reorder and the delete count have something to do.
  const rules = doc.decision_rules ?? [];
  if (rules.length === 1) rules.push({ ...rules[0], id: `${rules[0].id}-copy` });
  doc.decision_rules = rules;
  await prisma.quiz.create({ data: { id, shopId: quiz.shopId, name: "e2e table copy", status: "draft", draftJson: doc } });
  for (const c of cats) {
    const { id: oldId, createdAt: _c, updatedAt: _u, ...rest } = c;
    await prisma.category.create({ data: { ...rest, id: map.get(oldId), quizId: id } });
  }
  return id;
}
async function dropQuiz(id) {
  await prisma.category.deleteMany({ where: { quizId: id } });
  await prisma.quiz.deleteMany({ where: { id } });
}
const draft = async (id) => (await prisma.quiz.findUnique({ where: { id }, select: { draftJson: true } }))?.draftJson;

// ── workbook helpers (the file a merchant edits) ──────────────────────────
const readBook = (path) => XLSX.read(readFileSync(path), { type: "buffer" });
const rowsOf = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
function writeBook(path, sheets, props) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  if (props) wb.Custprops = props;
  writeFileSync(path, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
const colIx = (rows, head) => rows[0].findIndex((h) => String(h).toLowerCase().startsWith(head.toLowerCase()));

const copies = [];
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  const goto = async (url) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      throw new Error(mask(e.message ?? e));
    }
  };
  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  const card = page.locator('[data-testid="logic-tab-card"]');
  const table = page.locator('[data-testid="logic-table-view"]');
  const toast = page.locator(".qz-toast");
  const toastText = async () => (await toast.first().textContent({ timeout: 5000 }).catch(() => "")) ?? "";
  const waitToast = async (re) => {
    await page.waitForFunction(
      (src) => [...document.querySelectorAll(".qz-toast")].some((t) => new RegExp(src).test(t.textContent ?? "")),
      re.source,
      { timeout: 8000 },
    );
    return toastText();
  };
  const open = async (id) => {
    await goto(`${BASE}/studio/onboarding/${id}`);
    await card.waitFor({ timeout: 20000 });
    await page.waitForTimeout(700);
  };
  const toTable = async () => {
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await table.waitFor();
    await page.waitForTimeout(300);
  };
  const exportFile = async (path) => {
    const btn = page.locator('[data-io="export"]');
    const [dl] = await Promise.all([page.waitForEvent("download"), btn.click()]);
    ok("download is quiz-logic.xlsx", dl.suggestedFilename() === "quiz-logic.xlsx", dl.suggestedFilename());
    await dl.saveAs(path);
    return path;
  };
  const importFile = async (path) => {
    await page.locator('[data-testid="logic-io-file"]').setInputFiles(path);
  };
  const settle = async () => page.waitForTimeout(1600); // autosave debounce (700 ms) + PUT

  await goto(`${BASE}/studio?key=${KEY}`);

  // ════════════════════════════════════════════════════════════════════════
  // A · Filter Results + Rules
  // ════════════════════════════════════════════════════════════════════════
  const qa = await cloneQuiz("attributes");
  copies.push(qa);
  await open(qa);
  // B40 setup: select Q2 in the Edit rail first.
  const rail = page.locator(".qz-lg-rail .qz-lg-qi");
  if ((await rail.count()) > 1) await rail.nth(1).click();
  const selectedBefore = await page.locator(".qz-lg-rail .qz-lg-qi.is-on").getAttribute("data-node-id");
  await toTable();
  ok("header shows Import | Export in Table view", (await page.locator('[data-testid="logic-io"] button').count()) === 2);
  ok("no Paste rules / Create a rule in the Table header",
    (await page.locator(".qz-lg-sact .qz-lg-btn.is-pri, .qz-lg-sact .qz-lg-link").count()) === 0);
  const labels = await page.locator("table.qz-lg-xl").evaluateAll((ts) => ts.map((t) => t.getAttribute("aria-label")));
  ok("Filter: Rules sheet then Answers sheet", JSON.stringify(labels) === '["Rules","Answers"]', JSON.stringify(labels));
  await shot("a1-filter-table");

  const answers = page.locator('table[aria-label="Answers"]');
  // Popovers from the Table (each a screenshot: interactive state).
  // The Edit pane's OWN controls in the Table's dress (P1-6).
  await answers.locator(".qz-lg-tbtn.is-dim").first().click();
  await page.waitForSelector('[data-testid="type-popover"]');
  ok("type popover (the pane's) opens", (await page.locator('[data-testid="type-popover"] [role="radio"]').count()) >= 4);
  await shot("a2-type-menu");
  await page.keyboard.press("Escape");
  await answers.locator(".qz-lg-tbtn.is-does").first().click();
  await page.waitForSelector('[data-testid="role-menu"]');
  ok("role menu (the pane's) opens", (await page.locator('[data-testid="role-menu"] [role="menuitemradio"]').count()) === 3);
  await shot("a3-role-menu");
  await page.keyboard.press("Escape");
  const picks = answers.locator(".qz-lg-tbtn.is-res").first();
  if (await picks.count()) {
    await picks.click();
    await page.waitForSelector('[data-testid="picks-picker"]');
    ok("Choose a result picker (the pane's) opens", (await page.locator('[data-testid="picks-picker"] [role="checkbox"]').count()) > 0);
    const pw = await page.locator(".qz-popover").first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
    ok("the picker is 240px wide (mock)", pw === 240, String(pw));
    await shot("a4-choose-a-result");
    await page.keyboard.press("Escape");
  }
  await answers.locator("td:last-child .qz-lg-tbtn").first().click();
  await page.waitForSelector('[role="menu"]');
  await shot("a5-route-menu");
  await page.keyboard.press("Escape");
  const lastThen = (await answers.locator("tbody tr").last().locator("td").last().innerText()).replace("▾", "").trim();
  ok("P1-9: an unset route on the last question reads Results (last question)",
    lastThen === "Results (last question)" || lastThen === "Straight to results", lastThen);
  // B40: back to Edit, the selection is where it was.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.waitForTimeout(300);
  const selectedAfter = await page.locator(".qz-lg-rail .qz-lg-qi.is-on").getAttribute("data-node-id");
  ok("B40: Table popovers never move the Edit selection", selectedBefore === selectedAfter, `${selectedBefore} → ${selectedAfter}`);
  await toTable();

  // P1-7: ↑/↓ on the Rules sheet (hover reveals them), Undo moves it back.
  const rulesTbl = page.locator('table[aria-label="Rules"]');
  const ruleIds = async () => rulesTbl.locator("tbody tr[data-rule-id]").evaluateAll((trs) => trs.map((t) => t.getAttribute("data-rule-id")));
  const idsBefore = await ruleIds();
  if (idsBefore.length > 1) {
    await rulesTbl.locator("tbody tr").nth(0).hover();
    await shot("a5b-rules-row-hover");
    await rulesTbl.locator('tbody tr').nth(0).locator('[data-move="down"]').click();
    const tm = await waitToast(/moved to position 2/);
    ok("P1-7: ↓ moves rule 1 to position 2", /Rule 1 moved to position 2/.test(tm), tm);
    const idsMoved = await ruleIds();
    ok("P1-7: the order changed", idsMoved[0] === idsBefore[1] && idsMoved[1] === idsBefore[0], JSON.stringify(idsMoved));
    ok("P1-7: focus follows the rule", await page.evaluate((id) => document.activeElement?.closest("tr")?.getAttribute("data-rule-id") === id, idsBefore[0]));
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForTimeout(300);
    ok("P1-7: Alt+ArrowUp moves it back", JSON.stringify(await ruleIds()) === JSON.stringify(idsBefore));
    await page.locator(".qz-toast-action").click();
    await page.waitForTimeout(400);
    ok("P1-7: one Undo takes back the whole run", JSON.stringify(await ruleIds()) === JSON.stringify(idsBefore));
    // P2-7: a delete toast is not relabelled by a role change (a move of
    // "Picks the result", whose loss message must wait).
    await settle();
    const restoreTo = await draft(qa);
    await rulesTbl.locator(".qz-lg-tdel").first().click();
    await waitToast(/Rule 1 deleted/);
    await answers.locator(".qz-lg-tbtn.is-does").nth(1).click();
    await page.waitForSelector('[data-testid="role-menu"]');
    await page.locator('[data-testid="role-menu"] [role="menuitemradio"]').nth(0).click();
    await page.waitForTimeout(400);
    const tt = await toastText();
    const lbl = await page.locator(".qz-toast-action").innerText().catch(() => "");
    ok("P2-7: the delete toast keeps its own message and plain Undo", /Rule 1 deleted/.test(tt) && lbl === "Undo", `${tt} / ${lbl}`);
    await shot("a5c-delete-then-role");
    await page.locator(".qz-toast-action").click();
    await page.waitForTimeout(400);
    ok("P2-7: Undo restores only the rule", (await ruleIds()).length === idsBefore.length);
    await settle();
    // Put the copy back as it was for the import checks below.
    await prisma.quiz.update({ where: { id: qa }, data: { draftJson: restoreTo } });
    await open(qa);
    await toTable();
  }

  // Export → import unchanged.
  const fA = await exportFile(`${SHOTS}/a-export.xlsx`);
  const bookA = readBook(fA);
  ok("the file has the Table's sheets", JSON.stringify(bookA.SheetNames) === '["Rules","Answers"]', JSON.stringify(bookA.SheetNames));
  const rulesA = rowsOf(bookA, "Rules");
  const answersA = rowsOf(bookA, "Answers");
  ok("Rules sheet trails the Rule ID column", String(rulesA[0].at(-1)).startsWith("Rule ID"));
  ok("Answers sheet trails the Answer ID column", String(answersA[0].at(-1)).startsWith("Answer ID"));
  ok("every When answer is Qn = text (B3)", rulesA.slice(1).every((r) => /^(\(|NOT |Q\d+ = |\(no answers\))/.test(String(r[3]))), JSON.stringify(rulesA.slice(1).map((r) => r[3])));
  const domRules = await page.locator('table[aria-label="Rules"] tbody tr').count();
  ok("Table rows = file rows (Rules)", domRules === Math.max(1, rulesA.length - 1), `${domRules} vs ${rulesA.length - 1}`);
  ok("Table rows = file rows (Answers)", (await answers.locator("tbody tr").count()) === answersA.length - 1);
  ok("B37: Export re-enabled after the download", await page.locator('[data-io="export"]').isEnabled());
  await waitToast(/Exported quiz-logic\.xlsx/);
  await importFile(fA);
  const t0 = await waitToast(/Nothing changed/);
  ok("unchanged export imports as Nothing changed", /^Nothing changed/.test(t0), t0);
  await shot("a6-nothing-changed");

  // An edited file: one answer renamed, one rule's recommendations changed.
  const before = await draft(qa);
  const aText = answersA[0][colIx(answersA, "Answer")];
  const edited = answersA.map((r) => [...r]);
  edited[1][colIx(answersA, "Answer")] = `${aText} (edited)`;
  const rulesEd = rulesA.map((r) => [...r]);
  const recNames = answersA.slice(1).map((r) => r[colIx(answersA, "Shows / keeps")]).filter(Boolean);
  const otherRec = recNames.find((n) => !String(rulesA[1]?.[2] ?? "").includes(n)) ?? recNames[0];
  if (rulesEd[1]) rulesEd[1][2] = otherRec;
  writeBook(`${SHOTS}/a-edited.xlsx`, [["Rules", rulesEd], ["Answers", edited]], bookA.Custprops);
  await importFile(`${SHOTS}/a-edited.xlsx`);
  const t1 = await waitToast(/Imported/);
  ok("edited file: Imported 2 changes", /^Imported 2 changes/.test(t1), t1);
  ok("the import toast carries Undo", (await page.locator(".qz-toast-action").count()) === 1);
  await shot("a7-imported");
  ok("the Table shows the renamed answer", (await answers.textContent()).includes(`${aText} (edited)`));
  await settle();
  const saved = await draft(qa);
  ok("the import autosaved (one doc)", JSON.stringify(saved).includes(`${aText} (edited)`));
  ok("import never writes logic_style / build_session",
    saved.logic_style === before.logic_style && JSON.stringify(saved.build_session) === JSON.stringify(before.build_session));
  await page.locator(".qz-toast-action").click();
  await settle();
  const undone = await draft(qa);
  ok("Undo restores the answers and the rules",
    JSON.stringify(undone.nodes) === JSON.stringify(before.nodes) &&
      JSON.stringify(undone.decision_rules) === JSON.stringify(before.decision_rules));

  // All or nothing: a bad rule row, a valid answer edit in the same file.
  const bad = rulesA.map((r) => [...r]);
  if (bad[1]) bad[1][2] = "No such recommendation";
  writeBook(`${SHOTS}/a-bad.xlsx`, [["Rules", bad], ["Answers", edited]], bookA.Custprops);
  await page.waitForTimeout(400);
  await importFile(`${SHOTS}/a-bad.xlsx`);
  const t2 = await waitToast(/No rule changed/);
  ok("B22: bad row named, no rule changed, answers still applied",
    /Imported 1 change · 1 skipped · No rule changed: Rules row 2/.test(t2), t2);
  await shot("a8-bad-row");
  await page.locator(".qz-toast-action").click().catch(() => {});
  await settle();

  // B21: markup in a text column stays text.
  const markup = answersA.map((r) => [...r]);
  markup[1][colIx(answersA, "Answer")] = '<img src=x onerror="window.__xss=1">';
  writeBook(`${SHOTS}/a-markup.xlsx`, [["Answers", markup]], bookA.Custprops);
  await page.waitForTimeout(400);
  await importFile(`${SHOTS}/a-markup.xlsx`);
  await waitToast(/Imported/);
  ok("B21: imported markup renders as text", (await answers.locator("img").count()) === 0 &&
    (await answers.textContent()).includes("<img src=x"));
  ok("B21: nothing ran", (await page.evaluate(() => window.__xss)) === undefined);
  await page.locator(".qz-toast-action").click().catch(() => {});
  await settle();

  // B26: a UTF-8 CSV without a BOM.
  const aid = answersA[1].at(-1);
  const q = answersA[1][0];
  writeFileSync(`${SHOTS}/a-utf8.csv`, `Q,Answer,Answer ID (don't edit)\n${q},Don’t know — keep it simple,${aid}\n`);
  await page.waitForTimeout(400);
  await importFile(`${SHOTS}/a-utf8.csv`);
  await waitToast(/Imported/);
  ok("B26: UTF-8 CSV keeps curly quotes and dashes", (await answers.textContent()).includes("Don’t know — keep it simple"));
  await shot("a9-csv");
  await page.locator(".qz-toast-action").click().catch(() => {});
  await settle();

  // ════════════════════════════════════════════════════════════════════════
  // B · Rules only
  // ════════════════════════════════════════════════════════════════════════
  const qr = await cloneQuiz("rules");
  copies.push(qr);
  await open(qr);
  // P1-5: ONE count across surfaces — a delete in Edit, then one in the Table.
  const editRows = page.locator(".qz-lg-rlist2 [data-rule-id]");
  const nStart = await editRows.count();
  if (nStart >= 2) {
    await editRows.first().hover();
    await editRows.first().locator(".qz-lg-xdel").click();
    await waitToast(/Rule 1 deleted/);
    await toTable();
    await page.locator('table[aria-label="Rules"] .qz-lg-tdel').first().click();
    const t2 = await waitToast(/rules deleted/);
    ok("P1-5: Edit delete + Table delete read 2 rules deleted", /^2 rules deleted/.test(t2), t2);
    await page.locator(".qz-toast-action").click();
    await page.waitForTimeout(400);
    ok("P1-5: Undo restores both", (await page.locator('table[aria-label="Rules"] .qz-lg-tdel').count()) === nStart);
    await settle();
  } else {
    await toTable();
  }
  const labelsR = await page.locator("table.qz-lg-xl").evaluateAll((ts) => ts.map((t) => t.getAttribute("aria-label")));
  ok("Rules only: Rules sheet then Recommendations sheet", JSON.stringify(labelsR) === '["Rules","Recommendations"]', JSON.stringify(labelsR));
  ok("Rules only: every verb reads Show",
    (await page.locator('table[aria-label="Rules"] td.is-verb').allTextContents()).every((t) => t === "Show"));
  await shot("b1-rules-table");
  // Trash + Undo.
  const nRules = await page.locator('table[aria-label="Rules"] .qz-lg-tdel').count();
  if (nRules > 0) {
    await page.locator('table[aria-label="Rules"] tr').nth(1).hover();
    await shot("b2-row-hover");
    await page.locator('table[aria-label="Rules"] .qz-lg-tdel').first().click();
    const td = await waitToast(/deleted/);
    ok("trash toasts Rule 1 deleted with Undo", /Rule 1 deleted/.test(td), td);
    await shot("b3-deleted-toast");
    await page.locator(".qz-toast-action").click();
    await page.waitForTimeout(400);
    ok("Undo brings the rule back", (await page.locator('table[aria-label="Rules"] .qz-lg-tdel').count()) === nRules);
    // Delete every rule for the template export.
    for (let i = 0; i < nRules; i++) {
      await page.locator('table[aria-label="Rules"] .qz-lg-tdel').first().click();
      await page.waitForTimeout(150);
    }
    const tm = await toastText();
    ok("deletes inside one toast accumulate", nRules < 2 || /rules deleted/.test(tm), tm);
    await page.waitForTimeout(7500);
  }
  ok("an empty Rules sheet reads Nothing yet", (await page.locator('table[aria-label="Rules"] td.is-dim').textContent()) === "Nothing yet");
  ok("Needs a rule rows open Create a rule",
    (await page.locator('table[aria-label="Recommendations"] button[aria-label^="Create a rule for"]').count()) > 0);
  await shot("b4-empty-rules");
  const fT = await exportFile(`${SHOTS}/b-template.xlsx`);
  const tT = await waitToast(/Exported/);
  ok("template export says one example row", /with one example row/.test(tT), tT);
  const bookT = readBook(fT);
  const rulesT = rowsOf(bookT, "Rules");
  ok("the template has one EXAMPLE row", rulesT.length === 2 && rulesT[1].at(-1) === "EXAMPLE", JSON.stringify(rulesT));
  await importFile(fT);
  const tE = await waitToast(/example row/);
  ok("importing the template changes nothing and says so", /^Nothing changed · Ignored the example row/.test(tE), tE);
  // A row filled in under the example imports.
  const filled = rulesT.map((r) => [...r]);
  filled.push([2, "Show", rulesT[1][2], rulesT[1][3], ""]);
  writeBook(`${SHOTS}/b-filled.xlsx`, [["Rules", filled]], bookT.Custprops);
  await page.waitForTimeout(400);
  await importFile(`${SHOTS}/b-filled.xlsx`);
  const tF = await waitToast(/Imported/);
  ok("a row under the example imports as one rule", /^Imported 1 change · Ignored the example row/.test(tF), tF);
  ok("the Table shows the new rule", (await page.locator('table[aria-label="Rules"] .qz-lg-tdel').count()) === 1);
  await shot("b5-template-filled");
  await settle();
  const rSaved = await draft(qr);
  ok("the imported rule autosaved", (rSaved.decision_rules ?? []).length === 1);

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  failures++;
  console.error("✗ probe crashed —", mask(e?.message ?? e));
} finally {
  await browser?.close();
  for (const id of copies) await dropQuiz(id).catch((e) => console.error("cleanup", mask(e.message)));
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
