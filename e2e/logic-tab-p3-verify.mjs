// RETIRED (logic-step live-exact rebuild, 2026-08-28, commit b8cf66f): this
// probe asserts the two-card Rules/Questions table structure that the Live-
// pane workspace (rail + one-question detail panel) replaced. Kept per the
// conservative-deletion culture; the canonical suite is q3-questions-verify.
console.log("RETIRED probe — superseded by the logic-step Live rebuild (see e2e/q3-questions-verify.mjs). Exiting 0.");
process.exit(0);

// Logic tab live-verify (UNIFIED one-window + QRTZ-H5 unification) — the
// question window is the answer-MAPPING editor (reached through the mapping
// cells); the role pill opens the SHARED role menu (the mock's role popover,
// QuestionRoleControl — same as the Overview's) and the attr-slot opens the
// SHARED AttributePickerDialog (owner's H5 call: one surface everywhere).
// Route menu + product-count popover remain.
// Against a LOCAL production build. Fixture: draft cmr7khgd50001vkhscvox8dgt
// (decider, local DB — not the deploy DB, never the byte-pinned doc).
//
// Interactions are LIVE CLICKS (a pointer-trapped overlay renders fine and is
// unclickable — repo landmine). Mutations: a role round-trip through the
// WINDOW SPINE (Asked only → Narrows → Asked only) verified by reading the
// draft back, then the H5 dialog flow (menu-Narrows opens the dialog with NO
// role write · Cancel/Esc leave the draft byte-identical · Use seeds values
// · the slot reopens the dialog with the current field preselected). The
// draftJson is snapshotted via prisma and restored byte-for-byte in finally
// (e2e/README seed/restore contract), so mid-probe failures can't strand the
// fixture.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-tab-p3-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const prisma = new PrismaClient();
const fixture = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!fixture) {
  console.error("fixture quiz not found in the local DB");
  process.exit(1);
}
const draftDoc = async () => {
  const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  return row?.draftJson ?? null;
};
const waitDraft = async (pred, ms = 6000) => {
  const t0 = Date.now();
  for (;;) {
    if (pred(await draftDoc())) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
};

const browser = await chromium.launch();
let restored = false;
const restore = async () => {
  if (restored) return;
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: fixture.draftJson } });
  restored = true;
  console.log("fixture draft restored (byte-for-byte)");
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));

  const openLogic = async () => {
    await page.waitForSelector(".qz-builder", { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.locator(".qz-builder-rail-item", { hasText: "Logic" }).click();
    await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 10000 });
  };
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await openLogic();
  const card = page.locator('[data-testid="logic-tab-card"]');
  const win = page.locator(".qz-crm.qz-qwin");
  const menu = page.locator(".qz-popover .qz-ltab-menu");
  const ap = page.locator(".qz-ap");

  // ── QRTZ-H5 — the role pill opens the SHARED role menu (not the window) ────
  await card.locator(".qz-ltab-pill-btn").first().click();
  await page.waitForTimeout(200);
  ok("pill opens the role menu popover (window stays closed)",
    (await menu.count()) === 1 && (await win.count()) === 0);
  ok("role menu: mock vocabulary + one-decider foot (Overview parity)",
    /Question \d+ does/.test((await menu.locator(".qz-ltab-menu-title").innerText()) ?? "") &&
    (await menu.locator(".qz-ltab-menu-row").count()) === 3 &&
    /One question picks the result/.test((await menu.innerText()) ?? ""));
  ok("the current role row is marked",
    (await menu.locator(".qz-ltab-menu-row.is-current").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/role-menu.png` });
  await page.keyboard.press("Escape");
  ok("Esc closes the role menu", (await menu.count()) === 0);

  // ── UNIFIED — the window opens through a MAPPING cell (its remaining door) ─
  await card.locator(".qz-qwin-mapcell").first().click();
  ok("mapping cell opens the question window in a body portal", (await win.count()) === 1);
  ok("window title is the question text", (await win.locator("h2").innerText()).length > 3);
  ok("three panels (answers · spine · bank)", (await win.locator(".qz-crm-col").count()) === 3);
  const jobs = await win.locator(".qz-crm-verb").allInnerTexts();
  ok(
    "spine shows the three jobs",
    /Picks the result/.test(jobs[0] ?? "") && /Narrows/.test(jobs[1] ?? "") && /Asked only/.test(jobs[2] ?? ""),
    JSON.stringify(jobs.map((j) => j.split("\n")[0])),
  );
  await page.screenshot({ path: `${SHOTS}/question-window.png` });
  await page.keyboard.press("Escape");
  ok("Esc closes the window", (await win.count()) === 0);

  // ── real mutation round-trip via the SPINE (window door): Asked only →
  // Narrows → Asked only on an Asked-only question ──────────────────────────
  const infoPills = card.locator(".qz-ltab-pill-btn", { hasText: "Asked only" });
  const infoCount0 = await infoPills.count();
  ok("an Asked-only pill exists to flip", infoCount0 >= 1, `${infoCount0}`);
  const infoGroup = card
    .locator("tbody.qz-ltab-qgroup")
    .filter({ has: page.locator(".qz-ltab-pill-btn", { hasText: "Asked only" }) })
    .first();
  const infoNodeId = await infoGroup.locator("tr[data-node-id]").getAttribute("data-node-id");
  // Role flips below make role-based filters stale — pin the group by node id.
  const flipGroup = card
    .locator("tbody.qz-ltab-qgroup")
    .filter({ has: page.locator(`tr[data-node-id="${infoNodeId}"]`) });
  await infoGroup.locator(".qz-qwin-mapcell").first().click();
  ok("info window shows the not-used message", (await win.locator(".qz-qwin-infomsg").count()) === 1);
  await win.locator(".qz-crm-verb", { hasText: "Narrows" }).click();
  await page.waitForTimeout(300);
  // QRTZ-H3/H5 — the pill reads "Narrows"; the attribute rides the mock's
  // .attr-slot beneath it (freshly flipped + unmapped = "Choose attribute").
  const narrowsPill = card.locator(".qz-ltab-pill-btn", { hasText: "Narrows" });
  ok("pill flips to Narrows with the attr slot",
    (await narrowsPill.count()) === 1 &&
    (await card.locator(".qz-ap-slot").count()) === 1);
  ok("spine shows the derived readout", (await win.locator(".qz-qwin-derived").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/narrows-flipped.png` });
  // Mapping cells on that question now show the mock's only empty-state form
  // (QRTZ-H3): the bordered is-none "No filter" tag — covering both unset and
  // no-preference answers ("not mapped yet"/"keeps everything" are retired).
  ok(
    "filter answers show the No-filter is-none tag",
    (await card.locator(".qz-ltab-tag.is-none", { hasText: "No filter" }).count()) > 0,
  );
  // Flip back through the same window.
  await win.locator(".qz-crm-verb", { hasText: "Asked only" }).click();
  await page.waitForTimeout(300);
  ok("pill restores to Asked only",
    (await card.locator(".qz-ltab-pill-btn", { hasText: "Asked only" }).count()) === infoCount0);
  await win.locator(".qz-btn-primary", { hasText: "Done" }).click();
  ok("Done closes the window", (await win.count()) === 0);
  await page.waitForTimeout(900); // autosave debounce settle

  // ── reload: the round-trip PERSISTED through the autosave PUT ───────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await openLogic();
  ok(
    "after reload the question is still Asked only (draft read-back)",
    (await card.locator(".qz-ltab-pill-btn", { hasText: "Asked only" }).count()) === infoCount0,
  );

  // ── QRTZ-H5 — menu-Narrows on an UNMAPPED question opens the DIALOG
  // instead of writing the role (open-first/apply-together, Overview parity) ─
  const beforeDialog = JSON.stringify(await draftDoc());
  await flipGroup.locator(".qz-ltab-pill-btn").click();
  await menu.locator(".qz-ltab-menu-row", { hasText: "Narrows" }).click();
  await page.waitForTimeout(300);
  ok("menu flip-to-Narrows opens the attribute dialog (no immediate role write)",
    (await ap.count()) === 1 && (await win.count()) === 0);
  ok('dialog copy: "How should question N narrow?" + coverage foot',
    /How should question \d+ narrow\?/.test((await ap.locator(".qz-ap-title").innerText()) ?? "") &&
    /Coverage matters\./.test((await ap.locator(".qz-ap-foot").innerText()) ?? ""));
  ok("no field preselected on an unmapped question (Use disabled)",
    (await ap.locator(".qz-ap-row.is-on").count()) === 0 &&
    (await ap.locator(".qz-ap-foot .qz-btn-primary").isDisabled()));
  // Read the first row for the seed round below.
  const firstRow = ap.locator(".qz-ap-row").first();
  const apKey = await firstRow.locator(".qz-ap-key").evaluate((el) => el.childNodes[0]?.textContent?.trim() ?? "");
  const apKind = (await firstRow.locator(".qz-ap-kind").innerText()).trim();
  const apVal = ((await firstRow.locator(".qz-ap-vals").innerText()) ?? "").split("·")[0]?.trim() ?? "";
  console.log(`  dialog first row: ${apKind} "${apKey}" — first value "${apVal}"`);
  await page.screenshot({ path: `${SHOTS}/h5-dialog-from-menu.png` });
  await ap.locator(".qz-ap-foot .qz-btn:not(.qz-btn-primary)").click(); // Cancel
  await page.waitForTimeout(1600); // an erroneous write would autosave in 700ms
  ok("Cancel leaves the doc UNCHANGED (draft byte read-back)",
    (await ap.count()) === 0 && JSON.stringify(await draftDoc()) === beforeDialog);

  // ── seed round: rename the question's first answer to the field's own value
  // (prisma — the Logic table has no text editing), then Use commits role +
  // seeded values in ONE go through applyNarrowField ──────────────────────────
  const seedDoc = structuredClone(await draftDoc());
  const seedNode = seedDoc?.nodes?.find((n) => n.id === infoNodeId);
  ok("flip target found in the draft for the seed rename", Boolean(seedNode && apVal), infoNodeId ?? "?");
  if (seedNode && apVal) {
    seedNode.data.answers[0].text = apVal;
    await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: seedDoc } });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await openLogic();
  await flipGroup.locator(".qz-ltab-pill-btn").click();
  await menu.locator(".qz-ltab-menu-row", { hasText: "Narrows" }).click();
  await page.waitForTimeout(300);
  await ap.locator(".qz-ap-row").first().click();
  ok("radio select marks the row (is-on)", (await ap.locator(".qz-ap-row.is-on").count()) === 1);
  await ap.locator(".qz-ap-foot .qz-btn-primary").click(); // Use
  const carriesField = (ans) => {
    if (apKind === "Tag") return (ans?.tags ?? []).some((t) => t.toLowerCase().startsWith(`${apKey.toLowerCase()}:`));
    if (apKind === "Metafield") return (ans?.metafield_filters ?? []).some((m) => m.key === apKey);
    if (apKind === "Option") return (ans?.variant_filters ?? []).some((v) => v.name === apKey);
    return (ans?.product_type_filters ?? []).length > 0;
  };
  ok("Use writes role=filter + the seeded value in ONE commit (draft read-back)",
    await waitDraft((d) => {
      const q = d?.nodes?.find((n) => n.id === infoNodeId);
      return q?.data?.role === "filter" && carriesField(q?.data?.answers?.[0]);
    }));

  // ── QRTZ-H5 — the attr-slot reopens the SAME dialog, current field
  // preselected; Esc discards with the draft byte-identical ──────────────────
  const slot = flipGroup.locator(".qz-ap-slot");
  ok("attr slot shows the derived field (not the empty state)",
    (await slot.count()) === 1 && /narrows on/.test((await slot.innerText()) ?? ""));
  const beforeSlot = JSON.stringify(await draftDoc());
  await slot.click();
  await page.waitForTimeout(300);
  ok("slot opens the attribute dialog with the current field preselected (never the window)",
    (await ap.count()) === 1 && (await win.count()) === 0 &&
    (await ap.locator(".qz-ap-row.is-on").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/h5-dialog-from-slot.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1600);
  ok("Esc closes the dialog with the draft byte-identical (role stays filter)",
    (await ap.count()) === 0 && JSON.stringify(await draftDoc()) === beforeSlot);

  // ── UNIFIED — a mapping cell opens the window FOCUSED on that answer ────────
  const mapRows = card.locator("tbody tr").filter({ has: page.locator(".qz-qwin-mapcell") });
  const mapRow = mapRows.nth(Math.min(1, (await mapRows.count()) - 1));
  // QRTZ-H3 — the key sits inside the Answer cell now; read only the text span.
  const answerText = (await mapRow.locator(".qz-ltab-atext").innerText()).trim();
  await mapRow.locator(".qz-qwin-mapcell").click();
  ok("mapping cell opens the window", (await win.count()) === 1);
  ok(
    "window is focused on the clicked answer",
    (await win.locator(".qz-qwin-arow.is-on .qz-qwin-atext").innerText()).trim() === answerText,
    answerText,
  );
  await win.locator(".qz-btn-primary", { hasText: "Done" }).click();
  await page.waitForTimeout(400); // let the previous window unmount

  // ── UNIFIED — the Picks-the-result window via ITS mapping cell (G9) ─────────
  const startGroup = card
    .locator("tbody.qz-ltab-qgroup")
    .filter({ has: page.locator(".qz-ltab-pill.is-start") })
    .first();
  await startGroup.locator(".qz-qwin-mapcell").first().click();
  await win.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(300);
  ok(
    "decides window banks read Answers / What it opens",
    /What it opens/i.test(await win.locator(".qz-crm-col").last().innerText()),
  );
  // Focus a MAPPED answer (its left-bank row carries a target chip) so the
  // bank shows its selected Set.
  const mappedRow = win.locator(".qz-qwin-arow").filter({ has: page.locator(".qz-ltab-chip") }).first();
  if ((await mappedRow.count()) > 0) await mappedRow.click();
  ok(
    "the current target is marked in the set list",
    (await win.locator(".qz-crm-res.is-on").count()) >= 1,
  );
  await page.screenshot({ path: `${SHOTS}/starting-set-window.png` });
  await win.locator(".qz-btn-primary", { hasText: "Done" }).click();

  // ── §6.4 product popover behind the count — QRTZ-H3: the mock's .pp grid ────
  const pp = page.locator(".qz-popover .qz-pp");
  await card.locator(".qz-ltab-count .qz-ltab-countbtn").first().click();
  ok(
    "product popover opens the pp grid (cards or the safety-net empty copy)",
    (await pp.locator(".qz-pp-card").count()) > 0 ||
      (await pp.locator(".qz-pp-none").count()) > 0,
  );
  ok(
    "pp head carries the count·sync sub line",
    /products? matched/.test((await pp.locator(".qz-pp-sub").innerText()) ?? ""),
  );
  await page.keyboard.press("Escape");

  // ── §6.5 route menu — forward-only options + UNIFIED parity ─────────────────
  await card.locator("tbody td:last-child .qz-ltab-cellbtn").first().click();
  const routeRows = await menu.locator(".qz-ltab-menu-row").allInnerTexts();
  ok(
    "route menu: next question first, results last",
    /next question/i.test(routeRows[0] ?? "") && /results/i.test(routeRows[routeRows.length - 1] ?? ""),
    JSON.stringify(routeRows),
  );
  // UNIFIED (mock routeMenu) — title is "<answer> · goes to"; the current
  // destination is marked; a separator sits before "Straight to the results".
  ok(
    "route menu title says · goes to",
    /· goes to/i.test((await menu.locator(".qz-ltab-menu-title").innerText()) ?? ""),
  );
  ok(
    "the current destination is marked",
    (await menu.locator(".qz-ltab-menu-row.is-current").count()) >= 1,
  );
  ok(
    "results row sits under a separator",
    (await menu.locator(".qz-ltab-menu-sep").count()) === 1,
  );
  // "The next question" for an answer already on the default = no-op commit.
  await menu.locator(".qz-ltab-menu-row").first().click();
  await page.waitForTimeout(300);

  ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close().catch(() => {});
  await restore();
  await prisma.$disconnect();
}
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
