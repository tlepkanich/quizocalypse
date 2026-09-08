// WIS-025 Questions walkthrough: real autosave, capture invariants and stage seam.
// Local named fixture only; restored in finally. Logic coverage: q3-logic-verify.mjs.
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
  await page.waitForSelector('[data-testid="questions-walkthrough"]');
  ok("phone editor and rail are inactive", await page.locator('.qz-qf-panel,.qz-qf-navcol,.qz-qf-resizer,.qz-s3-device').count() === 0);
  const beforeReview = JSON.stringify(await draftDoc());
  await page.getByRole('button',{name:'Start →',exact:true}).click();
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  ok("early overview is read-only", await page.locator('[data-mode="read"] input,[data-mode="read"] [contenteditable]').count() === 0);
  await page.keyboard.press('Escape');
  ok("review writes no document state", JSON.stringify(await draftDoc()) === beforeReview);
  const title = page.getByRole('textbox',{name:'Question text',exact:true});
  await title.fill('What are you shopping for on this trip?');
  await title.press('Enter');
  ok("question wording autosaves", await waitDraft(d=>d.nodes.find(n=>n.id==='q1').data.text.endsWith('this trip?')));
  ok("two-answer floor", await page.getByRole('button',{name:'Delete answer 1',exact:true}).isDisabled());
  await page.getByRole('button',{name:'+ Add answer',exact:true}).click();
  ok("answer append focuses new field", await page.getByRole('textbox',{name:'Answer 3',exact:true}).evaluate(el=>document.activeElement===el));
  await page.getByRole('textbox',{name:'Answer 3',exact:true}).fill('Boots');
  await page.getByRole('textbox',{name:'Answer 3',exact:true}).press('Enter');
  ok("answer edit autosaves", await waitDraft(d=>d.nodes.find(n=>n.id==='q1').data.answers.at(-1).text==='Boots'));
  await page.getByRole('textbox',{name:'Answer 3',exact:true}).press('Alt+ArrowUp');
  ok("keyboard reorder autosaves", await waitDraft(d=>d.nodes.find(n=>n.id==='q1').data.answers[1].text==='Boots'));
  await page.getByRole('button',{name:'↻ Regenerate',exact:true}).click();
  ok("regenerate confirms before spending", await page.getByRole('alertdialog').isVisible());
  await page.screenshot({path:`${SHOTS}/regenerate-confirm.png`});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Add question',exact:true}).click();
  const composer=page.getByRole('dialog');
  await composer.getByLabel('Question',{exact:true}).fill('What else should we know?');
  await composer.getByLabel('Answer 1',{exact:true}).fill('One');
  await composer.getByLabel('Answer 2',{exact:true}).fill('Two');
  await page.screenshot({path:`${SHOTS}/composer.png`});
  await composer.getByRole('button',{name:'Add question',exact:true}).click();
  ok("composer appends and selects a real question", await waitDraft(d=>d.nodes.some(n=>n.type==='question'&&n.data.text==='What else should we know?')) && (await title.textContent())==='What else should we know?');
  await page.getByRole('button',{name:'Delete question',exact:true}).click();
  ok("delete confirms before removing the new question",await page.getByRole('alertdialog').isVisible());
  await page.getByRole('alertdialog').getByRole('button',{name:'Delete',exact:true}).click();
  ok("delete removes question and reconnects flow",await waitDraft(d=>d.nodes.filter(n=>n.type==='question').length===3));
  await page.getByRole('button',{name:'Email capture',exact:true}).click();
  await page.getByLabel('Terms and conditions',{exact:true}).check();
  await page.getByRole('group',{name:'Terms consent mode'}).getByRole('button',{name:'Notice only',exact:true}).click();
  await page.getByLabel('Collect a phone number for SMS',{exact:true}).check();
  await page.getByRole('button',{name:'On the results page',exact:true}).click();
  ok("inline placement preserves phone and persists explicit opt-in", await waitDraft(d=>d.rec_page_settings.global.captureInlineOn===true&&d.rec_page_settings.global.capturePhone===true));
  await page.screenshot({path:`${SHOTS}/email.png`,fullPage:true});
  await page.getByRole('button',{name:'Don’t collect',exact:true}).click();
  ok("email off warns before dropping SMS", await page.getByRole('alertdialog').isVisible());
  await page.getByRole('alertdialog').getByRole('button',{name:'Don’t collect',exact:true}).click();
  ok("capture off clears phone and new SMS fields", await waitDraft(d=>d.rec_page_settings.global.captureEmail===false&&!d.rec_page_settings.global.capturePhone&&!d.rec_page_settings.global.smsConsentMode));
  ok("email chip remains visible when off", await page.getByRole('button',{name:'Email capture',exact:true}).isVisible());
  await page.locator('.qz-topbar-continue').click();
  ok("unread gate identifies questions", (await page.getByRole('dialog').textContent()).includes('questions 2 and 3'));
  await page.getByRole('button',{name:'Review them',exact:true}).click();
  ok("review them visits first unread question", (await title.textContent()).includes('features'));
  await page.screenshot({path:`${SHOTS}/question.png`,fullPage:true});
  await page.locator('.qz-topbar-continue').click();
  await page.getByRole('button',{name:'Continue anyway',exact:true}).click();
  ok("to-logic persists", await waitDraft(d=>d.build_session.stage==='logic'));
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
