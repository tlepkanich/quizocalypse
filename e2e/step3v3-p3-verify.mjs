// QL3-P3 live-verify — the Logic view (sections + flag-move + distributed
// rules + pre-scoped add + answers table) on the Step-3 v3 shell (?step3=v3,
// decider docs) against a LOCAL production build (BASE env).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt — seed/restore copied verbatim from
// e2e/step3v3-p2-verify.mjs (snapshot draftJson + quiz-scoped Category rows,
// seed 2 probe buckets + a minimal decider doc at question_builder, restore
// byte-for-byte). This probe ADDS one decision rule spanning q1+q3 (home = q1,
// so q3's chip is a cross-section jump).
//
// Asserts (the P3 checklist):
//  1. sections render in flow order w/ distinct --sec-color; decider = gold
//     (section var + solid gold flag), qualifier ghosts always visible
//  2. flag-move: ghost ◇ → confirm dialog (copy: mappings CLEARED, rules
//     KEPT) → confirm → prisma: new role=decides+required, old decider's
//     answers carry NO target_id keys, decision_rules unchanged; gold repaints
//  3. maps-to: unmapped decider answers show the amber Choose… state; picking
//     a target persists target_id
//  4. pre-scoped add: λ Add rule opens the editor with the Question token
//     pre-locked and the doc UNCHANGED; cancel = still unchanged; the first
//     answer pick creates EXACTLY ONE rule carrying that condition
//  5. λ R# chip on a non-home answer → click → home section scrolls in + the
//     rule expands
//  6. Then-go-to → End quiz persists an edge to an end node
//  7. the divider AFTER THE LAST question inserts before the terminal
//     (spine read-back: q3→new→result)
//  8. zero page errors
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/ql3p3-shots";
const BACKUP = `${SHOTS}/ql3p3-${QUIZ}-backup.json`;

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

// ── snapshot (the P1/P2 pattern) ────────────────────────────────────────────
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

const draft = async () => {
  const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  return row?.draftJson ?? null;
};
const draftNode = async (nodeId) => (await draft())?.nodes?.find((n) => n.id === nodeId) ?? null;

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
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P3 Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p3_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QL3P3 Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "ql3p3_probe",
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
        data: { headline: "QL3P3 Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
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
    // ONE rule spanning q1 + q3 → home = q1 (flow-earliest); q3's chip is the
    // cross-section jump case.
    decision_rules: [
      { id: "rule_probe1",
        conditions: [
          { question_id: "q1", answer_id: "a_park", op: "is" },
          { question_id: "q3", answer_id: "x2", op: "is" },
        ],
        target_id: catB.id },
    ],
    build_session: { stage: "question_builder", built: true },
  };
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: probeDoc } });
  console.log(`seeded probe doc (targets ${catA.id} / ${catB.id}; rule_probe1 home=q1, chip on q3/x2)`);

  // ── drive the shell ────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 300)));

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}?step3=v3`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  ok("Step3Shell mounts (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);

  await page.locator(".qz-s3-viewtoggle button", { hasText: "Logic" }).click();
  await page.waitForTimeout(400);

  const sec = (id) => page.locator(`.qz-s3-sec[data-node-id="${id}"]`);
  const secColor = (id) =>
    sec(id).evaluate((el) => getComputedStyle(el).getPropertyValue("--sec-color").trim());

  // 1 ── sections in flow order + distinct colors + gold decider/flag
  const order = await page.locator(".qz-s3-sec").evaluateAll((els) => els.map((e) => e.dataset.nodeId));
  ok("sections render in flow order (q1,q2,q3)", JSON.stringify(order) === JSON.stringify(["q1", "q2", "q3"]), order.join(","));
  const c1 = await secColor("q1");
  const c2 = await secColor("q2");
  const c3 = await secColor("q3");
  ok("q1 --sec-color = palette green", /22a06b|--qz-pal-green/i.test(c1), c1);
  ok("q2 (decider) --sec-color = GOLD", /8c6d1f|--qz-gold/i.test(c2), c2);
  ok("q3 --sec-color = palette coral (distinct)", /ff6b5b|--qz-pal-coral/i.test(c3), c3);
  ok("decider section wears the solid gold ◆ flag",
    (await sec("q2").locator(".qz-s3-flag.is-decider").count()) === 1);
  const flagBg = await sec("q2").locator(".qz-s3-flag.is-decider").evaluate((el) => getComputedStyle(el).backgroundColor);
  ok("gold flag computed background = #8C6D1F", flagBg === "rgb(140, 109, 31)", flagBg);
  ok("qualifier ghosts ◇ always visible (q1 + q3)",
    (await page.locator(".qz-s3-flag.is-ghost").count()) === 2);
  ok("rules strip reads 'λ 1 RULE'", /λ\s*1\s*RULE/.test((await page.locator(".qz-s3-rulesstrip-count").textContent()) ?? ""));
  await page.screenshot({ path: `${SHOTS}/1-logic-view.png`, fullPage: true });

  // 5 ── λ R# chip (non-home, on q3/x2) → scrolls to the HOME section + expands
  const q3Chip = sec("q3").locator(".qz-s3-rulechip", { hasText: "R1" });
  ok("q3's Goggles row carries a λ R1 chip (non-home)", (await q3Chip.count()) === 1);
  await sec("q3").scrollIntoViewIfNeeded();
  await q3Chip.click();
  await page.waitForTimeout(900);
  ok("chip click → R1 expands in its HOME section (q1)",
    (await sec("q1").locator(".qz-s3-rr.is-expanded").count()) === 1);
  const q1Top = await sec("q1").evaluate((el) => el.getBoundingClientRect().top);
  ok("chip click → home section scrolled into view", q1Top > -40 && q1Top < 900, `top=${Math.round(q1Top)}`);
  ok("home-section chip renders the subtler is-home marker",
    (await sec("q1").locator(".qz-s3-rulechip.is-home").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/2-chip-jump.png` });

  // 4 ── pre-scoped add on q3: open = doc UNCHANGED · cancel = unchanged ·
  //      first answer pick = exactly ONE new rule with that condition
  await sec("q3").scrollIntoViewIfNeeded();
  await sec("q3").locator(".qz-s3-sec-footbtn", { hasText: "Add rule" }).click();
  const draftRow = page.locator("[data-draft-rule]");
  ok("λ Add rule opens the ephemeral editor", await draftRow.isVisible());
  const lockedQ = await draftRow.locator(".qz-s3-cond select").first();
  ok("Question token pre-locked (disabled select reads Q3)",
    (await lockedQ.isDisabled()) && /Q3/.test((await lockedQ.evaluate((el) => el.selectedOptions[0]?.textContent)) ?? ""));
  await page.waitForTimeout(1400); // any (buggy) write would autosave by now
  ok("draft OPEN → doc UNCHANGED in prisma (1 rule)", ((await draft())?.decision_rules ?? []).length === 1);
  await page.screenshot({ path: `${SHOTS}/3-draft-open.png` });
  await draftRow.locator("button", { hasText: "Cancel" }).click();
  await page.waitForTimeout(1400);
  ok("draft CANCEL → zero writes (still 1 rule)", ((await draft())?.decision_rules ?? []).length === 1);
  await sec("q3").locator(".qz-s3-sec-footbtn", { hasText: "Add rule" }).click();
  await page.locator("[data-draft-rule] .qz-s3-cond select >> nth=2").selectOption("x1");
  await page.waitForTimeout(1600);
  const rulesAfterAdd = (await draft())?.decision_rules ?? [];
  ok("answer pick → EXACTLY ONE new rule", rulesAfterAdd.length === 2, `${rulesAfterAdd.length}`);
  const newRule = rulesAfterAdd.find((r) => r.id !== "rule_probe1");
  // Field-wise compare — the Prisma JSON round-trip reorders object keys.
  const nc = newRule?.conditions ?? [];
  ok("new rule carries the pre-scoped condition (q3 is x1)",
    nc.length === 1 && nc[0].question_id === "q3" && nc[0].answer_id === "x1" && nc[0].op === "is",
    JSON.stringify(nc));
  ok("new rule seeded with a real target", Boolean(newRule?.target_id), newRule?.target_id ?? "");
  ok("editor stays open on the committed rule", (await page.locator(".qz-s3-rr.is-expanded").count()) >= 1);

  // 6 ── Then-go-to → End quiz on q3/x9 persists an edge to an end node
  await page.locator(`.qz-s3-sec[data-node-id="q3"] .qz-s3-arow >> nth=8 >> select.qz-s3-goto`).selectOption("__end__");
  await page.waitForTimeout(1600);
  const d6 = await draft();
  const endEdge = d6?.edges?.find((e) => e.source === "q3" && e.source_handle === "h_x9");
  const endNode = endEdge ? d6.nodes.find((n) => n.id === endEdge.target) : null;
  ok("End-quiz edge persisted from q3/x9 to an end node", endNode?.type === "end", `target=${endEdge?.target ?? "none"} type=${endNode?.type ?? "?"}`);
  ok("one edge per (source, handle) on x9", d6.edges.filter((e) => e.source === "q3" && e.source_handle === "h_x9").length === 1);

  // 2 ── flag-move: q1's ghost ◇ → §5.4 confirm (cleared + kept) → moveDecider
  const rulesBeforeMove = JSON.stringify((await draft())?.decision_rules ?? []);
  await sec("q1").scrollIntoViewIfNeeded();
  await sec("q1").locator(".qz-s3-flag.is-ghost").click();
  const modal = page.locator(".qz-modal");
  ok("confirm dialog opens: 'Make this the deciding question?'",
    await page.locator(".qz-modal-title", { hasText: "Make this the deciding question" }).isVisible());
  const modalText = (await modal.textContent()) ?? "";
  ok("dialog copy: current mappings CLEARED", /cleared/i.test(modalText));
  ok("dialog copy: rules KEPT", /kept/i.test(modalText));
  await page.screenshot({ path: `${SHOTS}/4-flagmove-confirm.png` });
  await modal.locator("button", { hasText: "Make it the decider" }).click();
  await page.waitForTimeout(1600);

  const q1After = await draftNode("q1");
  const q2After = await draftNode("q2");
  ok("q1 promoted: role=decides + required forced true",
    q1After?.data?.role === "decides" && q1After?.data?.required === true);
  ok("old decider q2 demoted to qualifier", q2After?.data?.role === "qualifier");
  ok("old decider's answers carry NO target_id keys (absent, not null)",
    q2After?.data?.answers?.every((a) => !("target_id" in a)) === true);
  ok("decision_rules referentially unchanged by the move",
    JSON.stringify((await draft())?.decision_rules ?? []) === rulesBeforeMove);
  const c1Moved = await secColor("q1");
  ok("gold repaints onto q1's section", /8c6d1f|--qz-gold/i.test(c1Moved), c1Moved);
  ok("q1 now wears the solid gold flag", (await sec("q1").locator(".qz-s3-flag.is-decider").count()) === 1);
  ok("q2's flag is a ghost again", (await sec("q2").locator(".qz-s3-flag.is-ghost").count()) === 1);

  // 3 ── maps-to: the new decider arrives UNMAPPED → amber Choose… → pick persists
  const unset = sec("q1").locator("select.qz-s3-target.is-unset");
  ok("all 3 new-decider answers show the amber Choose… state", (await unset.count()) === 3);
  const firstLabel = await unset.first().evaluate((el) => el.selectedOptions[0]?.textContent?.trim());
  ok("unmapped control reads 'Choose…'", firstLabel === "Choose…", firstLabel ?? "");
  await page.screenshot({ path: `${SHOTS}/5-gold-repaint-choose.png`, fullPage: true });
  await unset.first().selectOption(catA.id);
  await page.waitForTimeout(1600);
  ok("picking a target persists target_id (prisma)",
    (await draftNode("q1"))?.data?.answers?.[0]?.target_id === catA.id);
  ok("control flips to the mapped (gold) state",
    (await sec("q1").locator("select.qz-s3-target.is-mapped").count()) === 1);

  // 7 ── divider AFTER THE LAST question inserts BEFORE the terminal
  const nodesBefore = new Set(((await draft())?.nodes ?? []).map((n) => n.id));
  await page.locator(".qz-s3-secwrap >> nth=2 >> .qz-s3-divider-btn").click();
  await page.waitForTimeout(1600);
  const d7 = await draft();
  const newQ = d7.nodes.find((n) => !nodesBefore.has(n.id));
  ok("divider added a question node", newQ?.type === "question", newQ?.id ?? "none");
  const spineIn = d7.edges.find((e) => e.source === "q3" && e.target === newQ?.id && !e.source_handle);
  const spineOut = d7.edges.find((e) => e.source === newQ?.id && e.target === "r1");
  ok("new question spliced q3 → new → result (BEFORE the terminal)",
    Boolean(spineIn && spineOut), `in=${Boolean(spineIn)} out=${Boolean(spineOut)}`);
  ok("UI shows 4 sections", (await page.locator(".qz-s3-sec").count()) === 4);
  await page.screenshot({ path: `${SHOTS}/6-after-divider-add.png`, fullPage: true });

  // 8 ── zero page errors
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
