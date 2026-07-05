// QL3-P1 live-verify — the Step-3 v3 shell (?step3=v3, decider docs) against a
// LOCAL production build (BASE env, e.g. http://localhost:51059).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt (a decider draft parked at the
// grouping stage). The probe snapshots its draftJson + quiz-scoped Category
// rows (prisma, DATABASE_URL from .env), seeds 2 probe buckets + a minimal
// valid decider doc at build_session.stage="question_builder", drives the
// shell with Playwright, then RESTORES the snapshot byte-for-byte (doc back,
// probe buckets deleted, original rows re-created with their original ids).
//
// Asserts: floating topbar (single bar) · rail rows + gold decider chip ·
// termini rows w/ tooltip · brand tokens computed INSIDE the phone screen ·
// kicker/type chip · fit steps (data-fit=tight on the 7-answer question) ·
// Back/Next real walk Q1→…→capture→reveal · rail click sync · view toggle →
// logic stubs + Continue tri-label · save chip after a no-op-ish commit ·
// WITHOUT the flag the OLD QuestionsLogicLayout renders · zero page errors.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/ql3p1-shots";
const BACKUP = `${SHOTS}/ql3p1-${QUIZ}-backup.json`;

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
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P1 Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p1_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P1 Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p1_probe",
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
        data: { headline: "QL3P1 Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "How do you like to ride?", question_type: "single_select", required: true, role: "qualifier",
          answers: answers([["a_groom", "Groomed runs"], ["a_powder", "Powder days"], ["a_park", "Park laps"]]) } },
      { id: "q2", type: "question", position: { x: 0, y: 240 },
        data: { text: "What are you shopping for today?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "q3", type: "question", position: { x: 0, y: 360 },
        data: { text: "Which extras matter most to you when you're planning a long mountain day — comfort, safety, or pure convenience gear?", question_type: "single_select", required: true, role: "qualifier",
          answers: answers([["x1", "Warm gloves"], ["x2", "Goggles"], ["x3", "A stomp pad"], ["x4", "Wax kit"], ["x5", "A lock"], ["x6", "Boot dryer"], ["x7", "Helmet upgrade"]]) } },
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
  console.log(`seeded probe doc (targets ${catA.id} / ${catB.id})`);

  // ── drive the shell ────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 300)));

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

  // 1 ── flag ON: the v3 shell
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}?step3=v3`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  ok("Step3Shell mounts (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);
  ok("floating topbar renders", (await page.locator(".qz-topbar--floating").count()) === 1);
  ok("EXACTLY one topbar (standard bar suppressed)", (await page.locator(".qz-topbar").count()) === 1);
  ok("step pills present, Questions current",
    (await page.locator(".qz-stepnav-pill").count()) === 5 &&
    (await page.locator(".qz-stepnav-pill.is-current").textContent())?.includes("Questions"));
  ok("health pill green 'Logic valid'", await page.locator(".qz-s3-healthpill.is-ok", { hasText: "Logic valid" }).isVisible());
  ok("Continue reads '◆ Continue to Logic'", await page.locator(".qz-topbar-right button", { hasText: "Continue to Logic" }).isVisible());

  // rail
  ok("rail renders 3 question rows", (await page.locator(".qz-s3-row:not(.is-terminus)").count()) === 3);
  const deciderChip = page.locator(".qz-s3-numchip.is-decider");
  ok("gold decider chip on Q2", (await deciderChip.count()) === 1 && (await deciderChip.first().textContent())?.trim() === "2");
  ok("✉ Email capture terminus row", await page.locator(".qz-s3-row.is-terminus", { hasText: "Email capture" }).isVisible());
  ok("◆ Result reveal terminus row", await page.locator(".qz-s3-row.is-terminus", { hasText: "Result reveal" }).isVisible());
  ok("terminus tooltip 'Configured in Step 4 · Results'",
    (await page.locator(".qz-s3-row.is-terminus").first().getAttribute("title")) === "Configured in Step 4 · Results");

  // phone — brand tokens computed INSIDE the screen
  ok("caption pill persistent", await page.locator(".qz-s3-caption", { hasText: "styling lives in Design" }).isVisible());
  const screenProbe = await page.locator(".qz-s3-phone-screen").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      primaryVar: cs.getPropertyValue("--qz-color-primary").trim(),
      width: el.parentElement ? getComputedStyle(el.parentElement).width : "",
    };
  });
  ok("screen bg = brand background #FFF4E6", screenProbe.bg === "rgb(255, 244, 230)", screenProbe.bg);
  ok("--qz-color-primary = brand #2A9D8F inside screen", screenProbe.primaryVar === "#2A9D8F", screenProbe.primaryVar);
  ok("phone bezel 322px wide", screenProbe.width === "322px", screenProbe.width);
  const nextBg = await page.locator(".qz-s3-next").evaluate((el) => getComputedStyle(el).backgroundColor);
  ok("Next button wears brand primary", nextBg === "rgb(42, 157, 143)", nextBg);

  ok("Q1 active: kicker 'QUESTION 1 OF 3'", (await page.locator(".qz-s3-kicker").textContent())?.trim() === "QUESTION 1 OF 3");
  ok("Q1 title on the phone", await page.locator(".qz-s3-qtitle", { hasText: "How do you like to ride?" }).isVisible());
  ok("static type chip renders", await page.locator(".qz-s3-typechip", { hasText: "Single select" }).isVisible());
  ok("Q1 fit=normal (3 answers)", (await page.locator(".qz-s3-qbody").getAttribute("data-fit")) === "normal");
  ok("Back disabled on Q1", await page.locator(".qz-s3-backpill").isDisabled());
  ok("↻ Regenerate chip present + disabled", await page.locator(".qz-s3-regen").isDisabled());
  await page.screenshot({ path: `${SHOTS}/1-content-q1.png`, fullPage: true });

  // walk Q1 → Q2 → Q3 → capture → reveal
  await page.locator(".qz-s3-next").click();
  ok("Next → Q2 (decider) on the phone", (await page.locator(".qz-s3-kicker").textContent())?.trim() === "QUESTION 2 OF 3");
  ok("rail active row follows the walk (Q2)", await page.locator(".qz-s3-row.is-active", { hasText: "What are you shopping for" }).isVisible());
  await page.locator(".qz-s3-next").click();
  ok("Next → Q3, fit=tight (7 answers)", (await page.locator(".qz-s3-qbody").getAttribute("data-fit")) === "tight");
  ok("Q3 long title steps down (data-title-long)", (await page.locator(".qz-s3-qbody").getAttribute("data-title-long")) !== null);
  await page.screenshot({ path: `${SHOTS}/2-content-q3-tight.png`, fullPage: true });
  await page.locator(".qz-s3-next").click();
  ok("Next → capture mock (email field)", await page.locator(".qz-s3-capture .qz-s3-inputmock", { hasText: "you@example.com" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/3-capture.png` });
  await page.locator(".qz-s3-next").click();
  ok("Continue → reveal (defaults headline + product card)",
    (await page.locator(".qz-s3-reveal .qz-s3-qtitle", { hasText: "Your perfect match" }).isVisible()) &&
    (await page.locator(".qz-s3-prodcard").isVisible()));
  ok("reveal shows ↺ Start over", await page.locator(".qz-s3-next.is-restart").isVisible());
  await page.screenshot({ path: `${SHOTS}/4-reveal.png` });
  await page.locator(".qz-s3-backpill").click();
  ok("Back from reveal → capture", await page.locator(".qz-s3-capture").isVisible());

  // rail click loads a question on the phone
  await page.locator(".qz-s3-row", { hasText: "What are you shopping for" }).click();
  ok("rail click → phone loads Q2", (await page.locator(".qz-s3-kicker").textContent())?.trim() === "QUESTION 2 OF 3");

  // view toggle → logic stubs + Continue tri-label
  await page.locator(".qz-s3-viewtoggle button", { hasText: "Logic" }).click();
  ok("Logic view: stub scroll with 3 cards", (await page.locator(".qz-s3-stubcard").count()) === 3);
  ok("Logic view: Continue reads '◆ Continue to Results'", await page.locator(".qz-topbar-right button", { hasText: "Continue to Results" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/5-logic-stub.png`, fullPage: true });
  await page.locator(".qz-s3-viewtoggle button", { hasText: "Content" }).click();
  ok("toggle back → phone canvas returns", await page.locator(".qz-s3-phone-screen").isVisible());

  // save chip: + New question commits through the REAL 700ms autosave
  await page.locator(".qz-s3-railfoot button", { hasText: "New question" }).click();
  ok("new question appears in the rail (4 rows)", (await page.locator(".qz-s3-row:not(.is-terminus)").count()) === 4);
  await page.waitForTimeout(1400);
  const saveChip = await page.locator(".qz-save-chip").textContent().catch(() => "");
  ok("save chip shows Saved after the commit", Boolean(saveChip && saveChip.includes("Saved")), saveChip ?? "");
  await page.screenshot({ path: `${SHOTS}/6-after-add-save-chip.png` });

  // 2 ── flag OFF: the OLD QuestionsLogicLayout, standard topbar back
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  ok("no flag → old layout (.qz-ql)", (await page.locator(".qz-ql").count()) === 1);
  ok("no flag → v3 shell absent", (await page.locator(".qz-s3").count()) === 0);
  ok("no flag → standard topbar, not floating",
    (await page.locator(".qz-topbar").count()) === 1 && (await page.locator(".qz-topbar--floating").count()) === 0);
  ok("old layout decider tabs intact (Builder/Flow/Rules)", await page.locator(".qz-ql-tabs button", { hasText: "Rules" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/7-legacy-no-flag.png`, fullPage: true });

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
