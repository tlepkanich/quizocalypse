// AUDIT-17 live-verify — the funnel Step-3 ✎ Questions view exact to
// docs/design/questions/questions-full-page.html (+ the phone-preview SPEC
// geometry) against a LOCAL production build (BASE env).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt — snapshot draftJson + quiz-scoped
// Category rows, seed a minimal decider doc at question_builder (intro →
// single_select DECIDES w/ target_id → multi_select → rating(5) → result),
// restore byte-for-byte in the finally.
//
// Asserts the AUDIT-17 deltas: 3-col grid + drag-resizable navigator ·
// nav inline title edit · click-to-renumber · hover ✕ delete (disabled on
// the decider) · mock navterm termini · pv-bar (Mobile/Desktop + Expand) ·
// true 390×844 frame scaled via transform (fit-the-pane) · desktop 1180
// frame w/ browser chrome + hidden in-screen top bar + 600px column ·
// Expand overlay ≥1:1 + Esc close · floating type tag → popover (radios +
// multi Min/Max steppers + scale Max/endpoint labels) · answer rows (⠿ grip
// · radio/checkbox indicator + preview selection · ⋯ kebab → Delete answer ·
// + Add answer · drag-reorder via moveAnswer) · multi "Select up to N" ·
// rating scalebar + endpoint labels · Back pill hidden at the first step ·
// zero page errors. Screenshots → /tmp/q3-shots.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/q3-shots";
const BACKUP = `${SHOTS}/q3-${QUIZ}-backup.json`;

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
      shopId: quiz.shopId, quizId: QUIZ, name: "Q3 Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "q3_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "Q3 Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "q3_probe",
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
        data: { headline: "Q3 Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
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

  // ── drive the ✎ view ──────────────────────────────────────────────────────
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
  const open = async () => {
    await goto(`${BASE}/studio/onboarding/${QUIZ}`);
    await page.waitForTimeout(1400);
  };
  await open();
  ok("Step3Shell mounts (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);

  // 1 ── panel geometry: nav · resizer · phone col; resizer drags
  ok("resizer column present", (await page.locator(".qz-s3-resizer").count()) === 1);
  const railW0 = await page.locator(".qz-s3-rail").evaluate((el) => el.getBoundingClientRect().width);
  const rz = page.locator(".qz-s3-resizer");
  const rzBox = await rz.boundingBox();
  await page.mouse.move(rzBox.x + rzBox.width / 2, rzBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(rzBox.x + rzBox.width / 2 - 60, rzBox.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const railW1 = await page.locator(".qz-s3-rail").evaluate((el) => el.getBoundingClientRect().width);
  ok("navigator drag-resizes (−60px)", Math.abs(railW0 - 60 - railW1) < 4, `${railW0} → ${railW1}`);
  // floor: drag far left clamps at 232
  await page.mouse.move(rzBox.x - 58, rzBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(rzBox.x - 500, rzBox.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const railW2 = await page.locator(".qz-s3-rail").evaluate((el) => el.getBoundingClientRect().width);
  ok("navigator width floors at 232px", Math.abs(railW2 - 232) < 4, `${railW2}`);

  // 2 ── nav rows: editable titles, delete affordance, termini styling
  ok("nav titles are inline-editable (3 rows)", (await page.locator(".qz-s3-navedit").count()) === 3);
  ok("per-row delete buttons render", (await page.locator(".qz-s3-ndel").count()) === 3);
  const deciderDel = page.locator(".qz-s3-row").first().locator(".qz-s3-ndel");
  ok("decider row's delete is DISABLED", await deciderDel.isDisabled());
  ok("mock navterm termini (✉ capture + ◎ reveal)", (await page.locator(".qz-s3-navterm").count()) === 2);
  ok("+ New question row present", await page.locator(".qz-s3-navadd", { hasText: "New question" }).isVisible());

  // nav inline title edit syncs the phone
  const navTitle = page.locator(".qz-s3-navedit").first();
  await navTitle.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Renamed from the nav", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  ok("nav title edit syncs the phone title",
    (await page.locator(".qz-s3-qtitle .qz-s3-editable").first().textContent())?.trim() === "Renamed from the nav");
  await page.waitForTimeout(1400); // autosave
  ok("nav title edit persisted (prisma)", (await draftNode("q1"))?.data?.text === "Renamed from the nav");

  // 3 ── pv-bar + true-viewport phone geometry (fit-the-pane)
  ok("pv-bar: Mobile/Desktop segmented control", (await page.locator(".qz-s3-segbtns button").count()) === 2);
  ok("pv-bar: Expand control", await page.locator(".qz-s3-expandbtn").isVisible());
  const frame = page.locator(".qz-s3-device:not(.is-expand) .qz-s3-frame");
  const geo = await frame.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { w: cs.width, h: cs.height, transform: cs.transform, radius: cs.borderRadius };
  });
  ok("frame is a TRUE 390px viewport", geo.w === "390px", geo.w);
  ok("frame is 844 logical px tall", geo.h === "844px", geo.h);
  ok("frame scales via transform (not layout)", geo.transform.startsWith("matrix("), geo.transform);
  const scale = Number(geo.transform.match(/matrix\(([\d.]+)/)?.[1] ?? 0);
  ok("fit-the-pane scale in (0.34, 1]", scale > 0.34 && scale <= 1, `s=${scale}`);
  ok("minimal bezel (44px radius, no ink bar)", geo.radius.includes("44px"), geo.radius);
  ok("scroll fade present", (await page.locator(".qz-s3-device:not(.is-expand) .qz-s3-fade").count()) === 1);
  ok("Back pill HIDDEN at the first step", (await page.locator(".qz-s3-backpill").count()) === 0);

  // 4 ── floating type tag → popover (decider question: no settings block)
  ok("floating type tag reads Single select",
    (await page.locator(".qz-s3-typetagbtn .qz-s3-tt-type").textContent())?.trim() === "Single select");
  await page.locator(".qz-s3-typetagbtn").click();
  ok("type popover opens with 4 radios", (await page.locator(".qz-s3-tp-type").count()) === 4);
  ok("current type radio marked", await page.locator(".qz-s3-tp-type.is-on", { hasText: "Single select" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/1-typepop-decider.png` });
  // decider guard still intercepts multi
  await page.locator(".qz-s3-tp-type", { hasText: "Multi-select" }).click();
  ok("decider → Multi-select still BLOCKED",
    await page.locator(".qz-modal-title", { hasText: "Multi-select can" }).isVisible());
  await page.locator(".qz-modal button", { hasText: "Got it" }).click();
  await page.keyboard.press("Escape");

  // answer rows on the decider (single select): grip · radio · kebab
  ok("answer rows carry the ⠿ grip", (await page.locator(".qz-s3-odrag").count()) === 2);
  ok("single select renders RADIO indicators", (await page.locator(".qz-s3-oradio").count()) === 2);
  ok("first answer is the preview selection", await page.locator(".qz-s3-achip").first().evaluate((el) => el.classList.contains("is-hot")));
  await page.locator(".qz-s3-oradio").nth(1).click();
  ok("clicking an answer moves the preview selection",
    await page.locator(".qz-s3-achip").nth(1).evaluate((el) => el.classList.contains("is-hot")));
  ok("+ Add answer on the phone", await page.locator(".qz-s3-addopt").isVisible());
  await page.screenshot({ path: `${SHOTS}/2-decider-phone.png` });

  // kebab → Delete answer (on a 2-answer question the item is disabled)
  await page.locator(".qz-s3-achip").first().hover();
  await page.locator(".qz-s3-omore").first().click();
  ok("kebab menu opens with Delete answer", await page.locator(".qz-s3-omdel").isVisible());
  ok("Delete answer DISABLED at the 2-answer floor", await page.locator(".qz-s3-omdel").isDisabled());
  await page.screenshot({ path: `${SHOTS}/3-kebab-menu.png` });
  await page.keyboard.press("Escape");
  await page.locator(".qz-s3-qtitle").click(); // close menu via outside click

  // + Add answer → persists; then kebab-delete the fresh answer → back to 2
  await page.locator(".qz-s3-addopt").click();
  await page.waitForTimeout(1400);
  ok("+ Add answer persisted (3 answers in prisma)", (await draftNode("q1"))?.data?.answers?.length === 3);
  await page.locator(".qz-s3-achip").nth(2).hover();
  await page.locator(".qz-s3-achip").nth(2).locator(".qz-s3-omore").click();
  await page.locator(".qz-s3-omdel").click();
  await page.waitForTimeout(1400);
  ok("kebab Delete answer persisted (back to 2)", (await draftNode("q1"))?.data?.answers?.length === 2);

  // 5 ── multi-select question: checkbox indicators + Select-up-to + steppers
  await page.locator(".qz-s3-row", { hasText: "Which features matter most" }).click();
  await page.waitForTimeout(300);
  ok("multi select renders CHECKBOX indicators", (await page.locator(".qz-s3-obox").count()) === 4);
  ok('multi subcap "Select up to 2"', (await page.locator(".qz-s3-subcap").textContent())?.trim() === "Select up to 2");
  await page.locator(".qz-s3-typetagbtn").click();
  ok("multi settings: Min/Max steppers", (await page.locator(".qz-s3-stepper").count()) === 2);
  await page.screenshot({ path: `${SHOTS}/4-typepop-multi.png` });
  // bump Max 2 → 3, assert doc + subcap
  await page.locator(".qz-s3-tp-row", { hasText: "Max" }).locator("button", { hasText: "+" }).click();
  await page.waitForTimeout(1400);
  ok("Max stepper writes max_selections=3", (await draftNode("q2"))?.data?.max_selections === 3);
  ok('subcap follows: "Select up to 3"', (await page.locator(".qz-s3-subcap").textContent())?.trim() === "Select up to 3");
  await page.keyboard.press("Escape");

  // answer drag-reorder (synthetic HTML5 dnd) → moveAnswer persists
  const orderBefore = ((await draftNode("q2"))?.data?.answers ?? []).map((a) => a.id);
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll(".qz-s3-achip")];
    const dt = new DataTransfer();
    chips[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    chips[2].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    chips[2].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(1400);
  const orderAfter = ((await draftNode("q2"))?.data?.answers ?? []).map((a) => a.id);
  ok("⠿ drag-reorder persisted (a→index 2, objects intact)",
    orderAfter.join(",") === [orderBefore[1], orderBefore[2], orderBefore[0], orderBefore[3]].join(","),
    orderAfter.join(","));

  // 6 ── rating question: scalebar + endpoint labels + scale settings
  await page.locator(".qz-s3-row", { hasText: "riding ability" }).click();
  await page.waitForTimeout(300);
  ok("rating renders the mock scalebar (5 points)", (await page.locator(".qz-s3-sbn").count()) === 5);
  ok("scalebar endpoint labels (Beginner/Expert)",
    ((await page.locator(".qz-s3-scalelab").textContent()) ?? "").includes("Beginner"));
  await page.locator(".qz-s3-sbn").nth(2).click();
  ok("tapping a point selects it (preview)", await page.locator(".qz-s3-sbn").nth(2).evaluate((el) => el.classList.contains("is-on")));
  const fillW = await page.locator(".qz-s3-sbtrack span").evaluate((el) => el.style.width);
  ok("track fill follows the selection (50%)", /^50(\.0)?%$/.test(fillW), fillW);
  await page.locator(".qz-s3-typetagbtn").click();
  ok("scale settings: Max stepper + 2 endpoint inputs",
    (await page.locator(".qz-s3-stepper").count()) === 1 && (await page.locator(".qz-s3-lblinput").count()) === 2);
  await page.screenshot({ path: `${SHOTS}/5-typepop-scale.png` });
  // Max + → a 6th REAL answer named "6", scale_config.max synced
  await page.locator(".qz-s3-stepper button", { hasText: "+" }).click();
  await page.waitForTimeout(1400);
  const q3d = await draftNode("q3");
  ok("scale Max+ adds a REAL answer point (6, named '6')",
    q3d?.data?.answers?.length === 6 && q3d?.data?.answers?.[5]?.text === "6");
  ok("scale_config.max synced to 6", q3d?.data?.scale_config?.max === 6);
  // endpoint label edit → phone label + prisma
  await page.locator(".qz-s3-lblinput").nth(1).fill("Pro rider");
  await page.waitForTimeout(1400);
  ok("endpoint label persists (prisma)", (await draftNode("q3"))?.data?.scale_config?.endpoint_label_max === "Pro rider");
  ok("endpoint label live on the phone",
    ((await page.locator(".qz-s3-scalelab").textContent()) ?? "").includes("Pro rider"));
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SHOTS}/6-rating-scalebar.png` });

  // Back pill visible off the first step
  ok("Back pill visible mid-walk", (await page.locator(".qz-s3-backpill").count()) === 1);

  // 7 ── click-to-renumber: move q3 (rating, #3) to spot 2
  await page.locator(".qz-s3-row").nth(2).locator(".qz-s3-numchip.is-edit").click();
  await page.locator(".qz-s3-ncninput").fill("2");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1600);
  const orderIds = (await draftDoc())?.edges ? null : null;
  const rowTypes = await page.locator(".qz-s3-rowtype").allTextContents();
  ok("renumber 3→2 reorders the flow (Scale now row 2)",
    rowTypes[1] === "Scale", rowTypes.join(" · "));
  void orderIds;
  await page.screenshot({ path: `${SHOTS}/7-renumbered.png` });

  // 8 ── desktop toggle: 1180 frame, browser chrome, hidden top bar, 600px col
  await page.locator(".qz-s3-segbtns button").nth(1).click();
  await page.waitForTimeout(400);
  const dgeo = await page.locator(".qz-s3-device:not(.is-expand) .qz-s3-frame").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { w: cs.width, radius: cs.borderRadius };
  });
  ok("desktop frame is 1180 logical px", dgeo.w === "1180px", dgeo.w);
  ok("desktop frame radius 16px", dgeo.radius.includes("16px"), dgeo.radius);
  ok("desktop browser chrome (dots + blurred URL)", await page.locator(".qz-s3-dchrome").isVisible());
  ok("desktop top progress bar", (await page.locator(".qz-s3-dprogfill").count()) === 1);
  ok("in-screen top bar hidden on desktop",
    await page.locator(".qz-s3-screen-top").first().evaluate((el) => getComputedStyle(el).display === "none"));
  ok("desktop content centers in a 600px column",
    await page.locator(".qz-s3-scr").first().evaluate((el) => getComputedStyle(el).maxWidth === "600px"));
  await page.screenshot({ path: `${SHOTS}/8-desktop.png` });

  // 9 ── Expand overlay (back on mobile): scale ≥ 1, Esc closes
  await page.locator(".qz-s3-segbtns button").nth(0).click();
  await page.locator(".qz-s3-expandbtn").click();
  await page.waitForTimeout(400);
  ok("Expand overlay opens", await page.locator(".qz-s3-phscrim").isVisible());
  const exScale = await page.locator(".qz-s3-device.is-expand").evaluate((el) =>
    Number(getComputedStyle(el).getPropertyValue("--s")));
  ok("Expand floors mobile at TRUE 1:1", exScale >= 1, `s=${exScale}`);
  await page.screenshot({ path: `${SHOTS}/9-expand.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok("Esc closes the Expand overlay", (await page.locator(".qz-s3-phscrim").count()) === 0);

  // 10 ── nav delete (qualifier): confirm dialog → row gone + doc pruned
  page.once("dialog", (d) => d.accept());
  await page.locator(".qz-s3-row", { hasText: "Which features matter most" }).locator(".qz-s3-ndel").click();
  await page.waitForTimeout(1600);
  ok("nav ✕ delete removes the question (2 rows left)", (await page.locator(".qz-s3-row").count()) === 2);
  ok("delete persisted (q2 gone from the doc)", (await draftNode("q2")) === null);
  ok("flow re-stitched (no orphans: rail still renders)", (await page.locator(".qz-s3-navedit").count()) === 2);
  await page.screenshot({ path: `${SHOTS}/10-after-delete.png`, fullPage: true });

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
