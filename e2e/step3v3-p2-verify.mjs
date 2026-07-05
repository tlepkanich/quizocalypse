// QL3-P2 live-verify — Content-view inline editing on the Step-3 v3 shell
// (?step3=v3, decider docs) against a LOCAL production build (BASE env).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt — seed/restore copied from
// e2e/step3v3-p1-verify.mjs (snapshot draftJson + quiz-scoped Category rows,
// seed 2 probe buckets + a minimal decider doc at question_builder, restore
// byte-for-byte). q3 carries NINE answers here (the >8 advisory case).
//
// Asserts: keyboard-typing into the TITLE persists through the real 700ms
// autosave (reload + prisma) · typing into an ANSWER persists · the caret
// does NOT jump while typing (ArrowLeft mid-string insert stays mid-string
// while autosave echoes land) · section color vars inlined (Q1 green,
// decider Q2 gold) · decider chip → Multi-select = BLOCK dialog, doc
// UNCHANGED · qualifier chip → Multi-select = reset-confirm → confirm =
// type changed + answers reset to defaults · >8-answer warning banner on
// the 9-answer question (absent on Q1) · ↻ Regenerate chip ENABLED on a
// question, disabled on the reveal · zero page errors.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/ql3p2-shots";
const BACKUP = `${SHOTS}/ql3p2-${QUIZ}-backup.json`;

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// ── snapshot (the P1 pattern) ───────────────────────────────────────────────
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
console.log(`snapshot written: ${BACKUP} (stage=${quiz.draftJson?.build_session?.stage ?? "?"}, ${originalCats.length} quiz-scoped categories)`);

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
  console.log("fixture restored (doc + categories)");
}

const draftNode = async (nodeId) => {
  const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  return row?.draftJson?.nodes?.find((n) => n.id === nodeId) ?? null;
};

try {
  // ── seed: 2 probe buckets + a minimal valid decider doc at question_builder ──
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId },
    select: { productId: true },
    take: 6,
  });
  ok("catalog has ≥6 products for probe buckets", products.length >= 6, `${products.length}`);
  const collection = await prisma.collection.findFirst({
    where: { shopId: quiz.shopId },
    select: { collectionId: true },
  });
  const fallbackCol = collection?.collectionId ?? "manual";

  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P2 Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p2_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P2 Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p2_probe",
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
        data: { headline: "QL3P2 Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "How do you like to ride?", question_type: "single_select", required: true, role: "qualifier",
          answers: answers([["a_groom", "Groomed runs"], ["a_powder", "Powder days"], ["a_park", "Park laps"]]) } },
      { id: "q2", type: "question", position: { x: 0, y: 240 },
        data: { text: "What are you shopping for today?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "q3", type: "question", position: { x: 0, y: 360 },
        data: { text: "Which extras matter most to you?", question_type: "single_select", required: true, role: "qualifier",
          answers: answers([["x1", "Warm gloves"], ["x2", "Goggles"], ["x3", "A stomp pad"], ["x4", "Wax kit"], ["x5", "A lock"], ["x6", "Boot dryer"], ["x7", "Helmet upgrade"], ["x8", "Neck warmer"], ["x9", "Spare laces"]]) } },
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
  console.log(`seeded probe doc (targets ${catA.id} / ${catB.id}; q3 = 9 answers)`);

  // ── drive the shell ────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 300)));

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  const open = async () => {
    await page.goto(`${BASE}/studio/onboarding/${QUIZ}?step3=v3`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
  };
  await open();
  ok("Step3Shell mounts (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);

  const titleEd = page.locator(".qz-s3-qtitle .qz-s3-editable");
  ok("title renders as an editable run", (await titleEd.count()) === 1);
  ok("answer runs are editable (3 on Q1)", (await page.locator(".qz-s3-achip .qz-s3-editable").count()) === 3);
  ok("no >8 warning on Q1 (3 answers)", (await page.locator(".qz-s3-warnbanner").count()) === 0);
  ok("↻ Regenerate chip ENABLED on a question", await page.locator(".qz-s3-regen").isEnabled());

  // section color vars — Q1 = first qualifier = green
  const q1Sec = await page.locator(".qz-s3-qbody").evaluate((el) => getComputedStyle(el).getPropertyValue("--sec-color").trim());
  ok("Q1 wrapper carries --sec-color (palette green)", /22a06b|--qz-pal-green/i.test(q1Sec), q1Sec);

  // 1 ── TITLE: keyboard-type → real autosave → reload → persisted
  await titleEd.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Renamed by the P2 probe", { delay: 25 });
  await page.screenshot({ path: `${SHOTS}/1-title-typed.png` });
  await page.waitForTimeout(1600); // the 700ms useQuizDraft debounce + PUT
  await open();
  ok("title persisted through autosave (UI after reload)",
    (await page.locator(".qz-s3-qtitle .qz-s3-editable").textContent())?.trim() === "Renamed by the P2 probe");
  ok("title persisted in the draft doc (prisma)", (await draftNode("q1"))?.data?.text === "Renamed by the P2 probe");

  // 2 ── CARET: mid-string insert while autosave echoes land — no jump
  const ed = page.locator(".qz-s3-qtitle .qz-s3-editable");
  await ed.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("abcd", { delay: 120 });
  await page.waitForTimeout(1000); // let a commit→save→echo round-trip land WHILE focused
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  const caretText = (await ed.textContent())?.trim();
  ok("caret does NOT jump (ArrowLeft×2 then X → abXcd)", caretText === "abXcd", caretText ?? "");
  await page.screenshot({ path: `${SHOTS}/2-caret-midstring.png` });

  // 3 ── ANSWER: keyboard-type → persisted
  const firstAnswer = page.locator(".qz-s3-achip .qz-s3-editable").first();
  await firstAnswer.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Probe answer text", { delay: 25 });
  await page.waitForTimeout(1600);
  await open();
  ok("answer persisted through autosave (UI after reload)",
    (await page.locator(".qz-s3-achip .qz-s3-editable").first().textContent())?.trim() === "Probe answer text");
  ok("answer persisted in the draft doc (prisma)",
    (await draftNode("q1"))?.data?.answers?.[0]?.text === "Probe answer text");
  await page.screenshot({ path: `${SHOTS}/3-answer-typed.png` });

  // 4 ── DECIDER + Multi-select → BLOCK dialog, doc UNCHANGED
  await page.locator(".qz-s3-row", { hasText: "What are you shopping for" }).click();
  const q2Sec = await page.locator(".qz-s3-qbody").evaluate((el) => getComputedStyle(el).getPropertyValue("--sec-color").trim());
  ok("decider wrapper --sec-color = gold", /8c6d1f|--qz-gold/i.test(q2Sec), q2Sec);
  ok("type chip is a select on the kicker", (await page.locator("select.qz-s3-typechip").count()) === 1);
  await page.selectOption("select.qz-s3-typechip", "multi_select");
  ok("BLOCK dialog: 'Multi-select can't decide the result'",
    await page.locator(".qz-modal-title", { hasText: "Multi-select can" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/4-block-dialog.png` });
  await page.locator(".qz-modal button", { hasText: "Got it" }).click();
  ok("block dialog dismissed", (await page.locator(".qz-modal").count()) === 0);
  ok("chip snapped back to Single select", (await page.locator("select.qz-s3-typechip").inputValue()) === "single_select");
  await page.waitForTimeout(1200);
  const q2After = await draftNode("q2");
  ok("doc UNCHANGED after block (type/role/targets intact)",
    q2After?.data?.question_type === "single_select" &&
    q2After?.data?.role === "decides" &&
    q2After?.data?.answers?.length === 2 &&
    Boolean(q2After?.data?.answers?.[0]?.target_id));

  // 5 ── QUALIFIER + Multi-select → reset-confirm → confirm → doc updated
  await page.locator(".qz-s3-row", { hasText: "abXcd" }).click();
  await page.selectOption("select.qz-s3-typechip", "multi_select");
  ok("reset-confirm: 'Changing the type resets this question's answers'",
    await page.locator(".qz-modal-title", { hasText: "resets this question" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/5-reset-confirm.png` });
  await page.locator(".qz-modal button", { hasText: "Change type" }).click();
  await page.waitForTimeout(1600);
  const q1After = await draftNode("q1");
  ok("q1 is now multi_select with reset default answers",
    q1After?.data?.question_type === "multi_select" &&
    q1After?.data?.answers?.length === 2 &&
    q1After?.data?.answers?.[0]?.text === "Option 1");
  ok("UI shows the reset answers", await page.locator(".qz-s3-achip", { hasText: "Option 1" }).isVisible());
  ok("chip now reads Multi-select", (await page.locator("select.qz-s3-typechip").inputValue()) === "multi_select");
  await page.screenshot({ path: `${SHOTS}/6-after-type-change.png` });

  // 6 ── >8-answer advisory on the 9-answer question
  await page.locator(".qz-s3-row", { hasText: "Which extras matter most" }).click();
  ok(">8 warning banner on the 9-answer question",
    await page.locator(".qz-s3-warnbanner", { hasText: "more than 8 answers" }).isVisible());
  ok("9 answers render tight", (await page.locator(".qz-s3-qbody").getAttribute("data-fit")) === "tight");
  await page.screenshot({ path: `${SHOTS}/7-warnbanner.png`, fullPage: true });

  // 7 ── regen chip disabled on a terminus (walk to reveal)
  await page.locator(".qz-s3-next").click(); // → capture
  await page.locator(".qz-s3-next").click(); // → reveal
  ok("Regenerate disabled on the reveal terminus", await page.locator(".qz-s3-regen").isDisabled());

  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
  await browser.close();
} finally {
  await restore();
  await prisma.$disconnect();
}

const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
