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
  // Logic step redesign (D5, D23) — no first-entry chooser and no top
  // section: the step opens straight on the workspace card, whose header
  // carries the title switch. A fresh quiz (no rules, no filter role, no
  // saved style) resolves to Filter Results + Rules and NOTHING is written
  // on load.
  const setStyleRequests = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && (r.postData() ?? "").includes("set-logic-style")) setStyleRequests.push(r.url());
  });
  ok("no style chooser (D5)",
    (await page.locator('[data-testid="logic-style-chooser"]').count()) === 0);
  ok("the title switch names Filter Results + Rules",
    ((await page.locator('[data-testid="logic-style-title"]').textContent()) ?? "").includes("Filter Results + Rules"));
  ok("no h1 / How this works / catalog strip / style bar (D23)",
    (await page.locator('.qz-ls-h1, .qz-ls-ledebox, [data-testid="logic-catalog-strip"], [data-testid="logic-style-bar"]').count()) === 0);
  ok("loading the step wrote no style", (await draftDoc())?.logic_style === undefined);
  const lvGeo = await page.locator('[data-testid="logic-tab-card"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, left: r.left, right: window.innerWidth - r.right };
  });
  // D20 — the 1256px box minus its two 16px gutters: a 1224px card, centred.
  ok("Logic card is the centred 1224px card (D20)",
    Math.abs(lvGeo.w - 1224) <= 2 && Math.abs(lvGeo.left - lvGeo.right) < 4,
    `w${lvGeo.w} L${lvGeo.left} R${lvGeo.right}`);

  // 19 ── the Filter Results + Rules workspace (D22): rail | pane | rules
  // column, and NOTHING else: no subhead entries, no explainer strip, no
  // fallback/capture modules (the fallback config moved to the guided
  // Results step; the capture config to the Questions step's ✉ rail row).
  const ltab = page.locator('[data-testid="logic-tab-card"]');
  ok("the Logic card renders", (await ltab.count()) === 1);
  ok("the Rules-only screen's pieces are absent in this style",
    (await page.locator('.qz-lg-rband, [data-testid="logic-recs-strip"], .qz-lrs, .qz-lcov, .qz-lcov-row').count()) === 0);
  ok("rules column with the Rules heading",
    (await ltab.locator(".qz-lg-rcol h4", { hasText: "Rules" }).count()) === 1);
  ok("+ Add present in the rules column head (D18)",
    (await ltab.locator(".qz-lg-rcol-h .qz-lg-btn", { hasText: "+ Add" }).count()) === 1);
  ok("three columns: the rules column sits right of the pane (D22)",
    await ltab.evaluate((el) => {
      const pane = el.querySelector(".qz-lw-pane");
      const rc = el.querySelector(".qz-lg-rcol");
      return Boolean(pane && rc && rc.getBoundingClientRect().left >= pane.getBoundingClientRect().right - 1);
    }));
  ok("lgrid renders one rail row per question (3)",
    (await ltab.locator(".qz-lw-qi").count()) === 3);
  ok("ONE detail panel, showing the selected (first) question's 2 rows",
    (await ltab.locator(".qz-lw-pane").count()) === 1 &&
    (await ltab.locator(".qz-lw-pane .qz-lw-arow").count()) === 2);
  ok("exactly one Picks-results role control (decider guard carried over)",
    (await ltab.locator(".qz-lw-rolebtn", { hasText: "Picks results" }).count()) === 1);
  ok("route column live on every detail row (Then-go-to KEPT)",
    (await ltab.locator(".qz-lw-arow .qz-lw-go").evaluateAll(
      (cells) => cells.length > 0 &&
        cells.every((c) => c.textContent.trim().length > 0))));
  // every rail row selects — click row 2 (the multi question, 4 answers)
  await ltab.locator(".qz-lw-qi").nth(1).click();
  await page.waitForTimeout(200);
  ok("rail row selects — the panel now shows the multi question (4 rows)",
    (await ltab.locator(".qz-lw-qi").nth(1).getAttribute("class"))?.includes("is-on") &&
    (await ltab.locator(".qz-lw-pane .qz-lw-arow").count()) === 4);
  await ltab.locator(".qz-lw-qi").nth(2).click();
  await page.waitForTimeout(200);
  ok("…and row 3 too (the rating question, 5 rows)",
    (await ltab.locator(".qz-lw-pane .qz-lw-arow").count()) === 5);
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

  // 19c ── the title switch, on a RE-ENTRY render: the style is a DOC field
  // written through the autosave (D1), so the flip is immediate, survives
  // Back → Continue, and never sends the set-logic-style intent.
  const titleText = async () =>
    (await page.locator('[data-testid="logic-style-title"]').textContent()) ?? "";
  ok("re-entry shows Filter Results + Rules", (await titleText()).includes("Filter Results + Rules"));
  await page.locator('[data-testid="logic-style-title"]').click();
  await page.locator('[data-testid="logic-style-menu"] [role="menuitemradio"]', { hasText: "Rules only" }).click();
  await page.waitForTimeout(400);
  ok("the switch flips to Rules only IMMEDIATELY (no reload)", (await titleText()).includes("Rules only"));
  ok("Rules only: the rules band and the recommendations strip, no question widget",
    (await page.locator(".qz-lg-rband").count()) === 1 &&
    (await page.locator('[data-testid="logic-recs-strip"]').count()) === 1 &&
    (await page.locator(".qz-lw-grid").count()) === 0);
  ok('switch persisted on the doc (logic_style "rules")',
    await waitDraft((d) => d?.logic_style === "rules"));
  await page.locator('[data-testid="logic-style-title"]').click();
  await page.locator('[data-testid="logic-style-menu"] [role="menuitemradio"]', { hasText: "Filter Results + Rules" }).click();
  await page.waitForTimeout(400);
  ok("switch back to Filter Results + Rules immediately", (await titleText()).includes("Filter Results + Rules"));
  ok('switch-back persisted (logic_style "attributes")',
    await waitDraft((d) => d?.logic_style === "attributes"));
  ok("no set-logic-style intent was sent", setStyleRequests.length === 0);

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
