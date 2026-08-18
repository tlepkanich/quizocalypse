// QSTEP live-verify — the funnel Questions step exact to the OWNER-RULED
// docs/design/questions/questions-full-page.html spec (c573c3e) against a
// LOCAL production build (BASE env, default :3200).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt — snapshot draftJson + quiz-scoped
// Category rows, seed a minimal decider doc at question_builder (intro →
// single_select DECIDES w/ target_id → multi_select → rating(5) → result),
// restore byte-for-byte in the finally.
//
// The questions-full-page surface (the AUDIT-22/23 questions-simple list is
// RETIRED; owner 2026-08-18: the ✎/▦ tab pair is retired TOO — the step is
// the ✎ view only, .qz-s3-viewtoggle gone, OverviewLedger parked for the
// main builder). questions-artifact 2026-08-18: the sub-head is GONE —
// no hint; Question library + both inserts live in the rail's sticky foot;
// the card runs 1200px (1400 in desktop preview) toward the fold.
// The view: a NAV RAIL (.qz-qf-navcol — "Flow · N questions" head, compact rows
// w/ click-to-renumber number (.qz-qf-ncn → inline number input), 2-line
// editable wording, mono type line, hover ⠿/trash tools + ↑↓ movers,
// "+ Add question" foot, quiet ✉/◎ termini .qz-qf-navterm) | a drag RESIZER
// (.qz-qf-resizer, --navw 232..max) | the EDITABLE phone ("Click any text on
// the phone to edit it": contenteditable title .qz-qf-qtitleedit · answer
// chips .qz-s3-achip.is-edit w/ ⠿ .qz-qf-odrag / text .qz-qf-otext / ✕
// .qz-qf-odel (2-floor) · dashed .qz-qf-addopt) with the answer-type control
// IN the pv-bar (.qz-s3-pvtype — QRTZ-S5 retired the floating tag; hidden on
// capture/reveal) plus Mobile/Desktop + icon-only Expand, over the shared
// DeviceFrame (QRTZ-G2 — canonical 390×745 phone / 960×700 desktop band,
// fit = min(paneW/w, paneH/h, 1), host floor .55 via the .qz-g2-stage
// clamp). The former ▦ OverviewLedger surface is parked (see section 17).
//
// ONE-LINE-CHROME stage seam (unchanged, still asserted): the bar's Continue
// posts to-logic (build_session.stage persists to "logic") and the Logic
// stage renders the shared ONE-CARD Logic view (logic-tab migration; it
// previously rendered the LogicScroll LEDGER — ONE connected container of
// flush hairline rows, the right column defined ONCE (--rcol: 226px) so the
// settings divider runs one vertical line through header AND body (§1.1),
// N+1 ＋ inserters riding the dividers, capture terminal OUTSIDE the ledger,
// decider guards (solid-accent numchip, disabled .qz-s3-cdel). The bar's
// ‹ back drives goto-stage (backwards-only, server-enforced) home.
// Screenshots → /tmp/qs-shots.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3200";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qs-shots";
const BACKUP = `${SHOTS}/qs-${QUIZ}-backup.json`;

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

// NEVER print the token — mask it out of any thrown/goto error text.
const mask = (s) => String(s).replaceAll(KEY, "***");

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = Boolean(v);
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${mask(extra)}` : ""}`);
};

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(
  BACKUP,
  JSON.stringify({ draftJson: quiz.draftJson, categories: originalCats }, null, 2),
);
console.log(`snapshot written: ${BACKUP} (${originalCats.length} quiz-scoped categories)`);

let seeded = false;
async function restore() {
  if (!seeded) return;
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  seeded = false;
  console.log("fixture restored (doc + categories, byte-for-byte)");
}

const draftDoc = async () => {
  const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  return row?.draftJson ?? null;
};
const draftNode = async (nodeId) => (await draftDoc())?.nodes?.find((n) => n.id === nodeId) ?? null;
// Poll the draft until pred holds (autosave = 700ms debounce + a round-trip;
// a fixed sleep is a flake — the add-answer check raced it once).
const waitDraft = async (pred, ms = 6000) => {
  const t0 = Date.now();
  for (;;) {
    if (pred(await draftDoc())) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
};
const edgeChain = (d) => (d?.edges ?? []).map((e) => `${e.source}→${e.target}`).join(",");

let browser = null;
try {
  // ── seed: 2 probe buckets + the decider doc the task pins ─────────────────
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId },
    select: { productId: true },
    take: 6,
  });
  const collection = await prisma.collection.findFirst({
    where: { shopId: quiz.shopId },
    select: { collectionId: true },
  });
  const fallbackCol = collection?.collectionId ?? "manual";

  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QS Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "qs_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QS Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "qs_probe",
    },
  });

  const answers = (defs) =>
    defs.map(([id, text, target]) => ({
      id, text, tags: [], edge_handle_id: `h_${id}`, ...(target ? { target_id: target } : {}),
    }));
  const probeDoc = {
    quiz_id: QUIZ,
    status: "draft",
    scope: { collection_ids: [] },
    logic_model: "decider",
    design_tokens: {
      colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" },
      radius: "rounded",
    },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "QS Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "What are you shopping for today?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "q2", type: "question", position: { x: 0, y: 240 },
        data: { text: "Which features matter most?", question_type: "multi_select", required: true, role: "qualifier",
          max_selections: 2,
          answers: answers([["f1", "Lightweight build"], ["f2", "Powder float"], ["f3", "Edge grip on ice"], ["f4", "Park durability"]]) } },
      { id: "q3", type: "question", position: { x: 0, y: 360 },
        data: { text: "How would you rate your riding ability?", question_type: "rating", required: true, role: "qualifier",
          scale_config: { min: 1, max: 5, endpoint_label_min: "Beginner", endpoint_label_max: "Expert" },
          answers: answers([["r1", "1"], ["r2", "2"], ["r3", "3"], ["r4", "4"], ["r5", "5"]]) } },
      { id: "r1", type: "result", position: { x: 0, y: 480 },
        data: { headline: "Your match", fallback_collection_id: fallbackCol } },
    ],
    edges: [
      { id: "e1", source: "intro1", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "q3" },
      { id: "e4", source: "q3", target: "r1" },
    ],
    results_pages: [],
    rec_page_settings: { global: {}, overrides: {} },
    build_session: { stage: "question_builder", built: true },
  };
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: probeDoc } });
  console.log(`seeded probe doc (decider q1 → multi q2 → rating q3; targets ${catA.id} / ${catB.id})`);

  // ── drive the Questions step ──────────────────────────────────────────────
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(mask(String(e)).slice(0, 300)));

  const goto = async (url) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      throw new Error(mask(e.message ?? e));
    }
  };
  await goto(`${BASE}/studio?key=${KEY}`);
  await goto(`${BASE}/studio/onboarding/${QUIZ}`);
  await page.waitForTimeout(1400);
  ok("Step3Shell mounts (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);

  // 1 ── the sub-head: tab pair + tab-aware hint + library / + Add
  ok("questions-simple surface RETIRED (no qz-qs list/panel/rows)",
    (await page.locator(".qz-qs-panel, .qz-qs-list, .qz-qs-q, .qz-qs-ans, .qz-qs-term, .qz-qs-qmeta").count()) === 0);
  ok("older rails retired too (.qz-s3-resizer/.qz-s3-rail/.qz-s3-navterm)",
    (await page.locator(".qz-s3-resizer, .qz-s3-rail, .qz-s3-navterm").count()) === 0);
  ok("one questions-full-page panel", (await page.locator(".qz-qf-panel").count()) === 1);
  // Owner 2026-08-18 — the ✎/▦ tab pair is retired: no toggle, no ledger.
  ok("✎/▦ tab pair retired (no .qz-s3-viewtoggle, no .qz-s3-ledger)",
    (await page.locator(".qz-s3-viewtoggle").count()) === 0 &&
    (await page.locator(".qz-s3-ledger").count()) === 0);
  // questions-artifact — the sub-head is GONE; the library + inserts live
  // in the rail's sticky foot.
  ok("sub-head retired (no .qz-qf-subhead / hint / .qz-qs-tlib)",
    (await page.locator(".qz-qf-subhead, .qz-qf-hint, .qz-qs-tlib, .qz-qs-tbtn").count()) === 0);
  ok("rail foot: + Add question · + Add content · Question library",
    (await page.locator(".qz-qf-navaddrow .qz-qf-navadd").count()) === 3 &&
    await page.locator(".qz-qf-navadd.is-library", { hasText: "Question library" }).isVisible());

  // 1b ── questions-artifact: the card fills the widened 1248px funnel
  // column (1200px content at 24px side padding) and stays centered.
  const panelGeo = await page.locator(".qz-qf-panel").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const pg = el.closest(".qz-page");
    const cs = getComputedStyle(pg);
    const content = pg.getBoundingClientRect().width -
      parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { w: r.width, left: r.left, right: window.innerWidth - r.right, content };
  });
  ok("panel fills the widened 1248px funnel column (1200 content)",
    Math.abs(panelGeo.w - panelGeo.content) < 2 && Math.abs(panelGeo.w - 1200) < 3,
    `${panelGeo.w} vs content ${panelGeo.content}`);
  ok("panel is CENTERED (equal side margins)",
    Math.abs(panelGeo.left - panelGeo.right) < 4, `L${panelGeo.left} R${panelGeo.right}`);

  // 2 ── the nav rail: rows, decider accent chip, meta lines, tools, termini
  ok("rail head retired (no .qz-qf-navhd — the list starts at the top)",
    (await page.locator(".qz-qf-navhd").count()) === 0);
  ok("3 nav rows", (await page.locator(".qz-qf-navrow").count()) === 3);
  ok("first row is the decider (is-dec) and active (is-on)",
    await page.locator(".qz-qf-navrow").first().evaluate(
      (el) => el.classList.contains("is-dec") && el.classList.contains("is-on")));
  // questions-artifact — meta is "N answers" (answer-less rating keeps its
  // type label so the line never reads "0 answers").
  ok('decider meta "2 answers"',
    (await page.locator(".qz-qf-nct").first().textContent())?.trim() === "2 answers");
  ok('rating meta "Scale" (no answers → type label)',
    (await page.locator(".qz-qf-nct").nth(2).textContent())?.trim() === "Scale");
  // QRTZ-T accent — Quartz violet #5B45D6; the artifact marks the decider
  // on the number CHIP (accent fill), not on a type line.
  ok("decider number chip renders ACCENT fill",
    await page.locator(".qz-qf-navrow.is-dec .qz-qf-ncn").evaluate(
      (el) => getComputedStyle(el).backgroundColor === "rgb(91, 69, 214)"));
  ok("decider row's hover-trash is DISABLED",
    await page.locator(".qz-qf-navrow").first().locator(".qz-qf-tool:not(.is-drag)").isDisabled());
  ok("qualifier row's hover-trash is enabled",
    !(await page.locator(".qz-qf-navrow").nth(1).locator(".qz-qf-tool:not(.is-drag)").isDisabled()));
  // QRTZ-S5 — grip-only reorder: the stacked ↑/↓ movers (.qz-qf-nmvb) are
  // retired; the ⠿ grip is the one reorder affordance per row.
  ok("grip-only reorder (⠿ per row, stacked ↑/↓ movers gone)",
    (await page.locator(".qz-qf-navrow .qz-qf-tool.is-drag").count()) === 3 &&
    (await page.locator(".qz-qf-nmvb").count()) === 0);
  // 051eceb added a second navadd (+ Add content) — target the question one.
  ok("+ Add question rail foot",
    await page.locator(".qz-qf-navadd:not(.is-content):not(.is-library)").isVisible());
  ok("two quiet termini rows", (await page.locator(".qz-qf-navterm").count()) === 2);
  // questions-artifact — the termini are quiet icon+label rows; the
  // decorative sub-labels are gone (only a functional "Off" would render).
  ok('capture terminus "Email capture", no sub-label while on',
    ((await page.locator(".qz-qf-navterm").first().locator(".qz-qf-tlabel").textContent()) ?? "").trim() === "Email capture" &&
    (await page.locator(".qz-qf-navterm").first().locator(".qz-qf-ts").count()) === 0);
  ok('reveal terminus "Result reveal", no sub-label',
    ((await page.locator(".qz-qf-navterm").nth(1).locator(".qz-qf-tlabel").textContent()) ?? "").trim() === "Result reveal" &&
    (await page.locator(".qz-qf-navterm").nth(1).locator(".qz-qf-ts").count()) === 0);

  // 3 ── split geometry + the drag resizer (--navw, min-clamp 232)
  const firstCol = () =>
    page.locator(".qz-qf-view").evaluate(
      (el) => parseFloat(getComputedStyle(el).gridTemplateColumns.split(/\s+/)[0]));
  ok("nav column opens at the artifact's 340px", Math.abs((await firstCol()) - 340) < 2,
    `${await firstCol()}`);
  const rb = await page.locator(".qz-qf-resizer").boundingBox();
  const rx = rb.x + rb.width / 2;
  const ry = rb.y + 200;
  await page.mouse.move(rx, ry);
  await page.mouse.down();
  await page.mouse.move(rx - 200, ry, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  ok("resizer drag left CLAMPS at 232", Math.abs((await firstCol()) - 232) < 2, `${await firstCol()}`);
  const rb2 = await page.locator(".qz-qf-resizer").boundingBox();
  await page.mouse.move(rb2.x + rb2.width / 2, ry);
  await page.mouse.down();
  await page.mouse.move(rb2.x + rb2.width / 2 + 100, ry, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  ok("resizer drag right widens (232 → 332)", Math.abs((await firstCol()) - 332) < 2, `${await firstCol()}`);
  await page.screenshot({ path: `${SHOTS}/1-questions-tab.png`, fullPage: true });

  // 4 ── the EDITABLE phone (q1 active): counter, editables, chips, floor
  ok('step counter counts questions only ("1/3")',
    (await page.locator(".qz-s3-kicker").textContent())?.trim() === "1/3");
  ok("phone title is contenteditable (.qz-qf-qtitleedit)",
    (await page.locator(".qz-s3-qtitle.is-edit .qz-qf-qtitleedit").count()) === 1);
  ok("phone IS the editor (3 editables on the decider: title + 2 answers)",
    (await page.locator(".qz-s3-phone-screen .qz-s3-editable").count()) === 3);
  ok("2 editable answer chips (.qz-s3-achip.is-edit), first is-hot",
    (await page.locator(".qz-s3-achip.is-edit").count()) === 2 &&
    (await page.locator(".qz-s3-achip").first().evaluate((el) => el.classList.contains("is-hot"))));
  ok("option cards are white brand cards",
    await page.locator(".qz-s3-achip").first().evaluate(
      (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)"));
  ok("✕ answer delete DISABLED at the 2-answer floor",
    await page.locator(".qz-qf-odel").first().isDisabled());
  ok("dashed + Add answer under the chips", await page.locator(".qz-qf-addopt").isVisible());

  // 5 ── the answer-type control in the pv-bar (QRTZ-S5 — the floating tag
  // beside the phone is retired on the mock's authority): popover + guard
  ok("type control lives in the pv-bar (floating tag retired)",
    (await page.locator(".qz-s3-pvtype .qz-s3-typetagwrap").count()) === 1 &&
    (await page.locator(".qz-s3-typetag").count()) === 0);
  await page.locator(".qz-s3-pvtype .qz-s3-typetagbtn").click();
  ok("tag click opens the type popover (4 radios)", (await page.locator(".qz-s3-tp-type").count()) === 4);
  ok("current type radio marked", await page.locator(".qz-s3-tp-type.is-on", { hasText: "Single select" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/2-typepop.png` });
  await page.locator(".qz-s3-tp-type", { hasText: "Multi-select" }).click();
  ok("decider → Multi-select still BLOCKED",
    await page.locator(".qz-modal-title", { hasText: "Multi-select can" }).isVisible());
  await page.locator(".qz-modal button", { hasText: "Got it" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // 6 ── phone title edit → syncs the rail row + persists (prisma)
  await page.locator(".qz-qf-qtitleedit").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Renamed on the phone", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  ok("phone title edit syncs the rail wording",
    (await page.locator(".qz-qf-ncq").first().textContent())?.trim() === "Renamed on the phone");
  ok("title edit persisted (prisma)",
    await waitDraft((d) => d?.nodes?.find((n) => n.id === "q1")?.data?.text === "Renamed on the phone"));

  // 7 ── select the multi row: phone follows + subcap + tag label
  await page.locator(".qz-qf-navrow").nth(1).locator(".qz-qf-cell").click();
  await page.waitForTimeout(300);
  ok("clicking row 2 moves the selection (is-on + 4 chips)",
    (await page.locator(".qz-qf-navrow").nth(1).evaluate((el) => el.classList.contains("is-on"))) &&
    (await page.locator(".qz-s3-achip.is-edit").count()) === 4);
  ok('multi subcap "Select up to 2" on the phone',
    (await page.locator(".qz-s3-subcap").textContent())?.trim() === "Select up to 2");
  ok('type control follows ("Multi-select")',
    (await page.locator(".qz-s3-pvtype .qz-s3-tt-type").textContent())?.trim() === "Multi-select");

  // 8 ── answer edits ON THE PHONE persist: wording, + add, ✕ delete
  await page.locator(".qz-qf-otext").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Featherweight build", { delay: 20 });
  await page.keyboard.press("Enter");
  ok("answer edit persisted (prisma)",
    await waitDraft((d) => d?.nodes?.find((n) => n.id === "q2")?.data?.answers?.[0]?.text === "Featherweight build"));
  await page.locator(".qz-qf-addopt").click();
  ok("+ Add answer persisted (5 answers in prisma)",
    await waitDraft((d) => d?.nodes?.find((n) => n.id === "q2")?.data?.answers?.length === 5));
  const freshDel = page.locator(".qz-s3-achip").nth(4).locator(".qz-qf-odel");
  ok("✕ delete ENABLED above the floor", !(await freshDel.isDisabled()));
  await freshDel.click();
  ok("✕ delete persisted (back to 4)",
    await waitDraft((d) => d?.nodes?.find((n) => n.id === "q2")?.data?.answers?.length === 4));

  // 9 ── answer ⠿ drag-reorder on the phone (synthetic HTML5 dnd) → moveAnswer
  const orderBefore = ((await draftNode("q2"))?.data?.answers ?? []).map((a) => a.id);
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll(".qz-s3-achip")];
    const dt = new DataTransfer();
    chips[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    chips[2].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    chips[2].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  const wantOrder = [orderBefore[1], orderBefore[2], orderBefore[0], orderBefore[3]].join(",");
  ok("answer ⠿ drag-reorder persisted (a→index 2, objects intact)",
    await waitDraft((d) =>
      (d?.nodes?.find((n) => n.id === "q2")?.data?.answers ?? []).map((a) => a.id).join(",") === wantOrder),
    wantOrder);

  // 10 ── click-to-RENUMBER (the rail number IS a mover): q3 → position 2
  await page.locator(".qz-qf-navrow").nth(2).locator(".qz-qf-ncn").click();
  ok("number click opens the renumber input", await page.locator(".qz-qf-ncninput").isVisible());
  await page.locator(".qz-qf-ncninput").fill("2");
  await page.keyboard.press("Enter");
  ok("renumber persisted in the edge chain (q1→q3→q2)",
    await waitDraft((d) => edgeChain(d).includes("q1→q3") && edgeChain(d).includes("q3→q2")),
    edgeChain(await draftDoc()));
  ok("rail order follows (row 2 type line is Scale)",
    (await page.locator(".qz-qf-nct").nth(1).textContent())?.trim() === "Scale");

  // 11 ── whole-question ⠿ drag (rail rows) → moveStep: rating back to row 3
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".qz-qf-navrow")];
    const dt = new DataTransfer();
    rows[1].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    rows[2].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    rows[2].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  ok("question ⠿ drag-reorder persisted (chain restored q1→q2→q3)",
    await waitDraft((d) => edgeChain(d).includes("q1→q2") && edgeChain(d).includes("q2→q3")),
    edgeChain(await draftDoc()));

  // 12 ── termini are REAL walk positions: capture + reveal surfaces
  await page.locator(".qz-qf-navterm").first().click();
  await page.waitForTimeout(300);
  ok("✉ terminus shows the capture surface (rail is-on)",
    (await page.locator(".qz-s3-capture").count()) === 1 &&
    (await page.locator(".qz-qf-navterm").first().evaluate((el) => el.classList.contains("is-on"))));
  ok("type control hidden on the capture screen", (await page.locator(".qz-s3-pvtype").count()) === 0);
  ok("type tag hidden on the capture screen", (await page.locator(".qz-s3-typetagbtn").count()) === 0);
  // QRTZ-G3 — the relocated capture CONFIG (formerly the Logic step's
  // CaptureModule) opens inline under the selected ✉ row.
  ok("capture config panel opens under the ✉ row (relocated CaptureModule)",
    (await page.locator(".qz-qf-cappanel .qz-s3-capmod").count()) === 1);
  ok("capture config keeps its master toggle + SMS/terms toggles",
    (await page.locator(".qz-qf-cappanel .qz-s3-capmod-toggle").count()) === 3);
  await page.locator(".qz-qf-navterm").nth(1).click();
  await page.waitForTimeout(300);
  ok("◎ terminus shows the reveal mock + Start over",
    (await page.locator(".qz-s3-reveal").count()) === 1 &&
    (await page.locator(".qz-s3-next.is-restart").count()) === 1);

  // 13 ── pv-bar + TRUE-viewport phone geometry (back on the first question)
  await page.locator(".qz-qf-navrow").first().locator(".qz-qf-cell").click();
  await page.waitForTimeout(300);
  ok("Back pill HIDDEN at the first step", (await page.locator(".qz-s3-backpill").count()) === 0);
  ok("live chip retired (questions-artifact)",
    (await page.locator(".qz-qs-livechip").count()) === 0);
  ok('stage readout "390 × 745 · N%" (mock .stage-tag)',
    /^390 × 745 · \d+%$/.test(((await page.locator(".qz-qf-stagetag").textContent()) ?? "").trim()));
  ok("pv-bar: Mobile/Desktop segmented control", (await page.locator(".qz-s3-segbtns button").count()) === 2);
  ok("pv-bar: icon-only Expand control",
    await page.locator(".qz-s3-expandbtn.is-icon").isVisible() &&
    (await page.locator(".qz-s3-expandbtn").getAttribute("aria-label")) === "Expand preview");
  // QRTZ-G2 — the device is the shared DeviceFrame (previewWidth.DEVICES:
  // phone 390×745), Quartz chrome (borderless, --qz-phone-r, fold marker),
  // fit = min(paneW/w, paneH/h, 1). The old 844 frame / 44px bezel / fade /
  // faux desktop chrome are retired.
  const frame = page.locator(".qz-g2-stage .qz-devframe");
  const geo = await frame.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const pane = el.closest(".qz-vp-pane").getBoundingClientRect();
    return {
      w: cs.width, h: cs.height, transform: cs.transform, radius: cs.borderRadius,
      inPane: r.top >= pane.top - 1 && r.bottom <= pane.bottom + 1 &&
        r.left >= pane.left - 1 && r.right <= pane.right + 1,
      aspect: r.width / r.height,
    };
  });
  ok("frame is the canonical 390px phone viewport", geo.w === "390px", geo.w);
  ok("frame is 745 logical px tall (Quartz phone, was 844)", geo.h === "745px", geo.h);
  ok("frame scales via transform (not layout)", geo.transform.startsWith("matrix("), geo.transform);
  const scale = Number(geo.transform.match(/matrix\(([\d.]+)/)?.[1] ?? 0);
  ok("fit clamps: readable floor ≤ s ≤ 1 (never upscales)", scale >= 0.549 && scale <= 1, `s=${scale}`);
  ok("frame fully inside its pane (never cut off)", geo.inPane);
  ok("aspect stays 390:745 exact", Math.abs(geo.aspect - 390 / 745) < 0.005, `${geo.aspect}`);
  ok("Quartz borderless phone (20px device radius)", geo.radius.includes("20px"), geo.radius);
  ok("fold marker on the phone tier", (await page.locator(".qz-g2-stage .qz-devfold").count()) === 1);
  ok("old fade retired", (await page.locator(".qz-s3-fade").count()) === 0);

  // rating preview stays truthful (select the rating row)
  await page.locator(".qz-qf-navrow").nth(2).locator(".qz-qf-cell").click();
  await page.waitForTimeout(300);
  ok("rating renders the scalebar (5 points)", (await page.locator(".qz-s3-sbn").count()) === 5);
  ok("scalebar endpoint labels (Beginner/Expert)",
    ((await page.locator(".qz-s3-scalelab").textContent()) ?? "").includes("Beginner"));
  ok("Back pill visible mid-walk", (await page.locator(".qz-s3-backpill").count()) === 1);

  // 14 ── desktop toggle: the canonical 960×700 inline band (QRTZ-G2 — no
  // faux browser chrome; the in-screen top bar shows like the live runtime)
  await page.locator(".qz-s3-segbtns button").nth(1).click();
  await page.waitForTimeout(400);
  const dgeo = await page.locator(".qz-g2-stage .qz-devframe").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { w: cs.width, h: cs.height };
  });
  ok("desktop band is the canonical 960 logical px (was 1180)", dgeo.w === "960px", dgeo.w);
  // questions-artifact — the card widens for the desktop band (1400 content
  // via the .qz-page :has() rule; 1448 cap minus 48 padding).
  // (the 1448 cap can clamp to the viewport minus padding — assert it grew
  // well past the 1200 resting width and let the transition settle first)
  await page.waitForTimeout(450);
  ok("card widens past 1300 on desktop (1448 cap or viewport-clamped)",
    await page.locator(".qz-qf-panel").evaluate((el) =>
      el.getBoundingClientRect().width > 1300));
  ok("desktop band is 700 logical px tall", dgeo.h === "700px", dgeo.h);
  ok("faux browser chrome retired", (await page.locator(".qz-s3-dchrome").count()) === 0);
  ok("in-screen top bar SHOWS on desktop (like the live runtime)",
    await page.locator(".qz-s3-screen-top").first().evaluate((el) => getComputedStyle(el).display !== "none"));
  ok("desktop content centers in a 600px column",
    await page.locator(".qz-s3-scr").first().evaluate((el) => getComputedStyle(el).maxWidth === "600px"));

  // 15 ── Expand overlay (back on mobile): a bigger PANE, same fit rule —
  // at this 950px-tall viewport the 745 phone reaches exactly 1:1 (never past)
  await page.locator(".qz-s3-segbtns button").nth(0).click();
  await page.locator(".qz-s3-expandbtn").click();
  await page.waitForTimeout(400);
  ok("Expand overlay opens", await page.locator(".qz-s3-phscrim").isVisible());
  const exScale = await page.locator(".qz-s3-phscrim .qz-devframe").evaluate((el) => {
    const m = getComputedStyle(el).transform.match(/matrix\(([\d.]+)/);
    return Number(m?.[1] ?? 0);
  });
  ok("Expand shows the phone at TRUE 1:1 (fit rule, never past)", exScale === 1, `s=${exScale}`);
  await page.screenshot({ path: `${SHOTS}/3-expand.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok("Esc closes the Expand overlay", (await page.locator(".qz-s3-phscrim").count()) === 0);

  // 16 ── + Add question (rail foot) → appended + selected + persisted;
  // trash delete
  await page.locator(".qz-qf-navadd:not(.is-content):not(.is-library)").click();
  await page.waitForTimeout(1600);
  ok("+ Add appends a 4th rail row", (await page.locator(".qz-qf-navrow").count()) === 4);
  ok("the new question is selected (is-on)",
    await page.locator(".qz-qf-navrow").nth(3).evaluate((el) => el.classList.contains("is-on")));
  ok("rail follows (4 question rows)",
    (await page.locator(".qz-qf-navrow:not(.is-content)").count()) === 4);
  const afterAdd = await draftDoc();
  ok("add persisted (4 question nodes)",
    (afterAdd?.nodes ?? []).filter((n) => n.type === "question").length === 4);
  page.once("dialog", (d) => d.accept());
  await page.locator(".qz-qf-navrow").nth(3).hover();
  await page.locator(".qz-qf-navrow").nth(3).locator(".qz-qf-tool:not(.is-drag)").click();
  await page.waitForTimeout(1600);
  ok("trash delete removes the question (3 rows left)", (await page.locator(".qz-qf-navrow").count()) === 3);
  const afterDel = await draftDoc();
  ok("delete persisted (3 question nodes, flow re-stitched)",
    (afterDel?.nodes ?? []).filter((n) => n.type === "question").length === 3);

  // 17 ── (RETIRED 2026-08-18) the ▦ Overview ledger left the funnel — its
  // bulk-editing surface (role menu, attribute dialog, steppers, renumber)
  // is parked in OverviewLedger.tsx for the main builder. Asserted absent in
  // section 1; the role/attribute seams stay covered by the Logic step.
  await page.screenshot({ path: `${SHOTS}/5-full-tab.png`, fullPage: true });

  // 18 ── one-line-chrome stage seam: the bar's Continue posts the to-logic
  // intent; the loader revalidates into the logic-mode shell.
  await page.locator(".qz-topbar-continue").click();
  await page.waitForSelector(".qz-s3-logicview", { timeout: 15000 });
  await page.waitForTimeout(500);
  ok('to-logic persisted (build_session.stage "logic")',
    (await draftDoc())?.build_session?.stage === "logic");
  ok("Questions panel unmounted on the Logic stage",
    (await page.locator(".qz-qf-panel").count()) === 0);
  const lvGeo = await page.locator(".qz-s3-logicview").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, left: r.left, right: window.innerWidth - r.right };
  });
  ok("Logic column stays the centered ≤1076px wrap",
    lvGeo.w <= 1078 && Math.abs(lvGeo.left - lvGeo.right) < 4,
    `w${lvGeo.w} L${lvGeo.left} R${lvGeo.right}`);

  // 19 ── QRTZ-G3: the funnel Logic stage is the artifact's TWO stacked
  // cards (Rules, then Questions — shared.mjs screenLogic) and NOTHING else:
  // no subhead entries, no explainer strip, no fallback/capture modules (the
  // fallback config moved to the guided Results step; the capture config to
  // the Questions step's ✉ rail row — asserted at #12 above).
  const ltab = page.locator('[data-testid="logic-tab-card"]');
  ok("the Logic card stack renders", (await ltab.count()) === 1);
  ok("two stacked cards: Rules, then Questions",
    (await ltab.locator("section.qz-ltab").count()) === 2 &&
    (await ltab.locator("section.qz-ltab").first().locator("h2", { hasText: "Rules" }).count()) === 1 &&
    (await ltab.locator("section.qz-ltab").nth(1).locator("h2", { hasText: "Questions" }).count()) === 1);
  ok("one table row-group per question (3 label cells)",
    (await ltab.locator(".qz-ltab-qcell").count()) === 3);
  ok("exactly one Picks-the-result pill (decider guard carried over)",
    (await ltab.locator(".qz-ltab-pill.is-start").count()) === 1);
  ok("Add rule present on the funnel card (QRTZ-H3 label)",
    (await ltab.locator(".qz-ltab-create", { hasText: "Add rule" }).count()) === 1);
  ok("every question row routes somewhere (Then-go-to column live)",
    (await ltab.locator("tbody td:last-child").evaluateAll(
      (tds) => tds.every((td) => td.textContent.trim().length > 0))));
  ok("nothing else on the Logic surface (subhead/explainer/fallback/capture gone)",
    (await page.locator(
      ".qz-s3-logicview .qz-s3-subhead, .qz-s3-logicview .qz-s3-explainer, .qz-s3-logicview .qz-s3-fallback, .qz-s3-logicview .qz-s3-capmod, .qz-s3-logicview .qz-ltab-note",
    ).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/6-logic-card.png`, fullPage: true });

  // 19b ── QRTZ-G3: the relocated no-match fallback lives on the guided
  // Results flow's "The matches" step now (mutation seam unchanged —
  // doc.global_fallback). Continue → rec_page, walk to step 2, smoke it.
  await page.locator(".qz-topbar-continue").click();
  await page.waitForSelector(".qz-rg", { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.locator(".qz-rg-btn2.is-pri").click(); // "Next: the matches"
  await page.waitForTimeout(300);
  ok("relocated fallback renders on the matches step",
    (await page.locator(".qz-rg-panel .qz-s3-fallback .qz-s3-fb-head").count()) === 1);
  await page.locator(".qz-rg-panel .qz-s3-fb-head").click();
  await page.waitForTimeout(200);
  ok("fallback chooser keeps its three modes (seam intact)",
    (await page.locator(".qz-rg-panel .qz-s3-fb-opt.is-radio").count()) === 3);
  await page.screenshot({ path: `${SHOTS}/7-results-fallback.png`, fullPage: true });
  // back to the Logic stage before the #20 walk (goto-stage backwards-only)
  await page.locator(".qz-topbar-back").click();
  await page.waitForSelector(".qz-s3-logicview", { timeout: 15000 });
  await page.waitForTimeout(300);

  // 20 ── the bar's ‹ back = the goto-stage intent (backwards-only) → the
  // Questions stage again, so the walk proves both directions of the seam.
  await page.locator(".qz-topbar-back").click();
  await page.waitForSelector(".qz-qf-panel", { timeout: 15000 });
  await page.waitForTimeout(500);
  ok('goto-stage back persisted (build_session.stage "question_builder")',
    (await draftDoc())?.build_session?.stage === "question_builder");

  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
  await browser.close();
  browser = null;
} finally {
  if (browser) await browser.close().catch(() => {});
  await restore();
  await prisma.$disconnect();
}

const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
