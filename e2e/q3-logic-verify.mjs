// WIS-025: preserved Logic coverage, entered through the real HTTP stage intent.
// Local fixture only, snapshot/restored in finally.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3200";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qs-logic-shots";
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
  const response = await ctx.request.post(`${BASE}/studio/onboarding/${QUIZ}`, {form:{intent:"to-logic"}});
  if (!response.ok()) throw new Error(`to-logic failed: ${response.status()}`);
  await page.reload();
  await page.waitForSelector(".qz-s3-logicview", { timeout: 15000 });
  await page.waitForTimeout(500);
  ok('to-logic persisted (build_session.stage "logic")',
    (await draftDoc())?.build_session?.stage === "logic");
  ok("Questions panel unmounted on the Logic stage",
    (await page.locator('[data-testid="questions-walkthrough"]').count()) === 0);
  // Logic-step §2 — a FRESH quiz (no rules, no filter roles, logic_style
  // unset) lands on the style chooser first. Click through the recommended
  // card so the workspace assertions below run; the pick writes
  // build_session.logic_style via the set-logic-style intent (the fixture
  // restore in `finally` reverts it byte-for-byte).
  const clickThroughChooser = async () => {
    if ((await page.locator('[data-testid="logic-style-chooser"]').count()) === 0) return;
    // Click the Attributes + Rules ROW explicitly (module 01 rebuild: the
    // whole row is the button, and recommendEngine() decides which row is
    // recommended from the catalog scan — on a catalog without strong
    // attributes Rules only leads, and the sections below assert the
    // attributes workspace, so never click ".is-rec" here).
    await page.locator('.qz-lsc-eng[data-pick="attributes"] .qz-lsc-go').click();
    await page.waitForSelector('[data-testid="logic-style-bar"]', { timeout: 8000 });
    await page.waitForTimeout(400);
  };
  await clickThroughChooser();
  ok("style chooser answered — the style bar renders",
    (await page.locator('[data-testid="logic-style-bar"]').count()) === 1);
  const lvGeo = await page.locator(".qz-s3-logicview").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, left: r.left, right: window.innerWidth - r.right };
  });
  // Owner 2026-08-18 — the answers section widened: 1248 wrap (page cap
  // 1296), so the table's Answer column gets the extra room.
  ok("Logic column is the widened centered 1248px wrap",
    lvGeo.w > 1078 && lvGeo.w <= 1250 && Math.abs(lvGeo.left - lvGeo.right) < 4,
    `w${lvGeo.w} L${lvGeo.left} R${lvGeo.right}`);

  // 19 ── LW: the funnel Logic stage is the Live artifact's WORKSPACE (mock-
  // live screenWorkspace): the style bar, the .qz-lw-grid (questions rail +
  // ONE detail panel), the .qz-lw-rzone rules ledger BELOW the grid in the
  // Attributes + Rules style — and NOTHING else: no subhead entries, no
  // explainer strip, no fallback/capture modules (the fallback config moved
  // to the guided Results step; the capture config to the Questions step's
  // ✉ rail row — asserted at #12 above).
  const ltab = page.locator('[data-testid="logic-tab-card"]');
  ok("the Logic card stack renders", (await ltab.count()) === 1);
  ok("style bar present above the workspace",
    (await page.locator('[data-testid="logic-style-bar"]').count()) === 1);
  // Module 02 — the Catalog strip renders at the top of the workspace,
  // directly ABOVE the style bar, with the product count chip.
  ok("catalog strip above the style bar with a numeric product count",
    await page.evaluate(() => {
      const strip = document.querySelector('[data-testid="logic-catalog-strip"]');
      const bar = document.querySelector('[data-testid="logic-style-bar"]');
      const n = strip?.querySelector(".qz-lcs-s.is-cat")?.textContent?.trim() ?? "";
      return Boolean(strip && bar && /^\d+$/.test(n) &&
        strip.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  ok("strip attributes variant: products + attributes items, one status flag, no rules-only sentence",
    (await page.locator(".qz-lcs-item").count()) === 2 &&
    (await page.locator(".qz-lcs-flag").count()) === 1 &&
    (await page.locator(".qz-lcs-muted").count()) === 0);
  // Modules 12/14 are rules-only surfaces — the attributes flow renders
  // NOTHING of them (no setup scaffold, no coverage sidebar/row).
  ok("attributes mode renders nothing of modules 12/14",
    (await page.locator(
      '.qz-lrs, .qz-lcov, .qz-lcov-row, [data-testid="rules-setup-scaffold"], [data-testid="logic-coverage-sidebar"]',
    ).count()) === 0);
  ok("ledger rzone with the Rules heading",
    (await ltab.locator(".qz-lw-rzone h4", { hasText: "Rules" }).count()) === 1);
  ok("Add rule present in the rzone head (LW label)",
    (await ltab.locator(".qz-ltab-create", { hasText: "Add rule" }).count()) === 1);
  ok("attributes style: the lgrid leads, the ledger follows (resolution order)",
    await ltab.evaluate((el) => {
      const grid = el.querySelector(".qz-lw-grid");
      const rz = el.querySelector(".qz-lw-rzone");
      return Boolean(grid && rz &&
        grid.compareDocumentPosition(rz) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  ok("lgrid renders one rail row per question (3)",
    (await ltab.locator(".qz-lw-qi").count()) === 3);
  ok("ONE detail panel, showing the selected (first) question's 2 rows",
    (await ltab.locator(".qz-lw-panel").count()) === 1 &&
    (await ltab.locator(".qz-lw-panel .qz-lw-ar").count()) === 2);
  ok("exactly one Picks-the-result pill (decider guard carried over)",
    (await ltab.locator(".qz-ltab-pill.is-start").count()) === 1);
  ok("route column live on every detail row (Then-go-to KEPT)",
    (await ltab.locator(".qz-lw-ar .qz-lw-aroute").evaluateAll(
      (cells) => cells.length > 0 &&
        cells.every((c) => c.textContent.trim().length > 0))));
  // every rail row selects — click row 2 (the multi question, 4 answers)
  await ltab.locator(".qz-lw-qi").nth(1).click();
  await page.waitForTimeout(200);
  ok("rail row selects — the panel now shows the multi question (4 rows)",
    (await ltab.locator(".qz-lw-qi").nth(1).getAttribute("class"))?.includes("is-on") &&
    (await ltab.locator(".qz-lw-panel .qz-lw-ar").count()) === 4);
  await ltab.locator(".qz-lw-qi").nth(2).click();
  await page.waitForTimeout(200);
  ok("…and row 3 too (the rating question, 5 rows)",
    (await ltab.locator(".qz-lw-panel .qz-lw-ar").count()) === 5);
  await ltab.locator(".qz-lw-qi").first().click();
  await page.waitForTimeout(200);
  ok("nothing else on the Logic surface (subhead/explainer/fallback/capture gone)",
    (await page.locator(
      ".qz-s3-logicview .qz-s3-subhead, .qz-s3-logicview .qz-s3-explainer, .qz-s3-logicview .qz-s3-fallback, .qz-s3-logicview .qz-s3-capmod, .qz-s3-logicview .qz-ltab-note",
    ).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/6-logic-card.png`, fullPage: true });

  // 19b ── owner 2026-08-18: the no-match FallbackSection left the guided
  // Results "matches" step (configured elsewhere); assert it GONE, the foot's
  // forward button reads "Continue", and back is the bare ‹ chevron.
  await page.locator(".qz-topbar-continue").click();
  await page.waitForSelector(".qz-rg", { timeout: 15000 });
  await page.waitForTimeout(400);
  ok('guided foot forward button reads "Continue"',
    ((await page.locator(".qz-rg-btn2.is-pri").textContent()) ?? "").trim() === "Continue");
  await page.locator(".qz-rg-btn2.is-pri").click(); // → the matches step
  await page.waitForTimeout(300);
  ok("fallback section GONE from the matches step",
    (await page.locator(".qz-rg-panel .qz-s3-fallback").count()) === 0);
  ok("guided foot back is the bare ‹ chevron",
    ((await page.locator(".qz-rg-btn2.is-backico").textContent()) ?? "").trim() === "‹");
  await page.screenshot({ path: `${SHOTS}/7-results-matches.png`, fullPage: true });
  // back to the Logic stage before the #20 walk (goto-stage backwards-only)
  await page.locator(".qz-topbar-back").click();
  await page.waitForSelector(".qz-s3-logicview", { timeout: 15000 });
  await page.waitForTimeout(300);
  // The persisted logic_style should skip the chooser on re-entry; the
  // guard stays for a slow intent write (never a wrong-order failure).
  await clickThroughChooser();

  // 19c ── the style bar's SWITCH, on a RE-ENTRY render (owner repro: the
  // persisted logic_style is in the loader doc here, which used to shadow
  // the click until a full reload — "Switch does nothing"). The flip must
  // be IMMEDIATE: bar text, ledger-leads order, and the retired role
  // column all change without a navigation; and the set-logic-style intent
  // persists the flip server-side.
  const barText = async () =>
    (await page.locator('[data-testid="logic-style-bar"]').textContent()) ?? "";
  ok("re-entry bar shows the persisted Attributes + Rules style",
    (await barText()).includes("Attributes + Rules"));
  await page.locator(".qz-lsb-switch").click();
  await page.waitForTimeout(400);
  ok("Switch flips the bar to Rules only IMMEDIATELY (no reload)",
    (await barText()).includes("Rules only"));
  ok("rules-only leads with the ledger (rzone before the grid)",
    await page.evaluate(() => {
      const rz = document.querySelector(".qz-lw-rzone");
      const grid = document.querySelector(".qz-lw-grid");
      return Boolean(rz && grid &&
        rz.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
  ok("rules-only retires the role column (no Role row in the panel)",
    (await page.locator(".qz-lw-drole").count()) === 0);
  ok('switch persisted server-side (build_session.logic_style "rules")',
    await waitDraft((d) => d?.build_session?.logic_style === "rules"));
  // Flip BACK so the fixture flow (and the restore snapshot's expectations)
  // continue on the attributes style the section above asserted.
  await page.locator(".qz-lsb-switch").click();
  await page.waitForTimeout(400);
  ok("Switch flips back to Attributes + Rules immediately",
    (await barText()).includes("Attributes + Rules"));
  ok('switch-back persisted (build_session.logic_style "attributes")',
    await waitDraft((d) => d?.build_session?.logic_style === "attributes"));

  // 20 ── the bar's ‹ back = the goto-stage intent (backwards-only) → the
  // Questions stage again, so the walk proves both directions of the seam.
  await page.locator(".qz-topbar-back").click();
  await page.waitForSelector('[data-testid="questions-walkthrough"]', { timeout: 15000 });
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
