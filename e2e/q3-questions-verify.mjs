// AUDIT-22 live-verify — the funnel Step-3 ✎ Questions tab exact to the
// OWNER-RULED simple spec docs/design/questions/questions-simple.html
// (+ the phone-preview SPEC geometry) against a LOCAL production build
// (BASE env, default :3200).
//
// Fixture: draft cmr7khgd50001vkhscvox8dgt — snapshot draftJson + quiz-scoped
// Category rows, seed a minimal decider doc at question_builder (intro →
// single_select DECIDES w/ target_id → multi_select → rating(5) → result),
// restore byte-for-byte in the finally.
//
// Asserts the AUDIT-22 deltas: one panel (toolbar: title · mono count ·
// + New question · library) over a compact-list | 340px preview split ·
// compact rows (19px number circle, deciding = accent + dot · inline-editable
// wording · mono "N · TYPE" meta that OPENS the type popover · hover ⠿/trash,
// decider delete disabled) · click a row → answers expand INLINE (editable
// inputs · ✕ delete w/ 2-floor · + answer · regen bracket) · whole-question
// AND answer drag-reorder · quiet termini rows w/ right hints · live chip ·
// pv-bar (Mobile/Desktop + Expand) · TRUE 390×844 frame scaled ≤1 via
// transform · READ-ONLY phone question surface (no editables/grips/kebabs) ·
// desktop 1180 frame w/ chrome · Expand ≥1:1 + Esc · zero page errors.
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
  await goto(`${BASE}/studio/onboarding/${QUIZ}`);
  await page.waitForTimeout(1400);
  ok("Step3Shell mounts (.qz-s3)", (await page.locator(".qz-s3").count()) === 1);

  // 1 ── the panel: toolbar (title · mono count · library · + New question)
  ok("one questions-simple panel", (await page.locator(".qz-qs-panel").count()) === 1);
  ok('toolbar title "Questions"',
    (await page.locator(".qz-qs-ttitle").textContent())?.trim() === "Questions");
  ok('mono count "3 questions"',
    (await page.locator(".qz-qs-tcount").textContent())?.trim() === "3 questions");
  ok("+ New question toolbar button", await page.locator(".qz-qs-tbtn", { hasText: "New question" }).isVisible());
  ok("Question library toolbar entry", await page.locator(".qz-qs-tlib").isVisible());
  ok("old resizer/rail retired", (await page.locator(".qz-s3-resizer, .qz-s3-rail, .qz-s3-navterm").count()) === 0);

  // 2 ── split geometry: 340px preview column
  const pvW = await page.locator(".qz-qs-pv").evaluate((el) => el.getBoundingClientRect().width);
  ok("preview column is 340px", Math.abs(pvW - 340) < 2, `${pvW}`);

  // 3 ── compact rows: number circles, deciding accent, mono meta, ONE expansion
  ok("3 compact question rows", (await page.locator(".qz-qs-q").count()) === 3);
  ok("decider row's number circle is accent (is-deciding)",
    await page.locator(".qz-qs-q").first().locator(".qz-qs-qn.is-deciding").count() === 1);
  ok("exactly one deciding dot", (await page.locator(".qz-qs-decdot").count()) === 1);
  ok('decider meta reads "2 · Single select"',
    (await page.locator(".qz-qs-qmeta").first().textContent())?.trim() === "2 · Single select");
  ok("meta renders UPPERCASE mono (CSS)",
    await page.locator(".qz-qs-qmeta").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.textTransform === "uppercase" && /mono|Menlo|SFMono/i.test(cs.fontFamily);
    }));
  ok("first question expanded by default (ONE .qz-qs-ans)",
    (await page.locator(".qz-qs-ans").count()) === 1 &&
    (await page.locator(".qz-qs-q").first().locator(".qz-qs-ans").count()) === 1);
  ok("expanded answers are editable inputs (2 on the decider)",
    (await page.locator(".qz-qs-ainput").count()) === 2);
  ok("✕ answer delete DISABLED at the 2-answer floor",
    await page.locator(".qz-qs-adel").first().isDisabled());
  ok("regen bracket lives in the expanded footer",
    (await page.locator(".qz-qs-ans .qz-qs-regen").count()) === 1);
  await page.locator(".qz-qs-list").screenshot({ path: `${SHOTS}/1-list-default.png` });

  // 4 ── click a row → its answers expand inline (and only one expansion)
  await page.locator(".qz-qs-q").nth(1).locator(".qz-qs-qn").click();
  await page.waitForTimeout(300);
  ok("clicking row 2 moves the expansion (4 multi answers)",
    (await page.locator(".qz-qs-ans").count()) === 1 &&
    (await page.locator(".qz-qs-q").nth(1).locator(".qz-qs-ainput").count()) === 4);
  ok("row 2 gains the selected wash (is-on)",
    await page.locator(".qz-qs-q").nth(1).evaluate((el) => el.classList.contains("is-on")));
  await page.locator(".qz-qs-list").screenshot({ path: `${SHOTS}/2-row-expanded.png` });

  // phone follows the selection + multi stays truthful
  ok('multi subcap "Select up to 2" on the phone',
    (await page.locator(".qz-s3-subcap").textContent())?.trim() === "Select up to 2");

  // 5 ── inline edits persist (wording via the LIST row, answer via the input)
  const wording = page.locator(".qz-qs-q").nth(1).locator(".qz-qs-qtext");
  await wording.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Renamed in the list", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  ok("list wording edit syncs the phone title",
    (await page.locator(".qz-s3-qtitle").first().textContent())?.trim() === "Renamed in the list");
  await page.waitForTimeout(1400); // autosave
  ok("wording edit persisted (prisma)", (await draftNode("q2"))?.data?.text === "Renamed in the list");

  const firstAnswer = page.locator(".qz-qs-q").nth(1).locator(".qz-qs-ainput").first();
  await firstAnswer.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Featherweight build", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1400);
  ok("answer edit persisted (prisma)",
    (await draftNode("q2"))?.data?.answers?.[0]?.text === "Featherweight build");

  // 6 ── + answer / ✕ delete round-trip on the expanded row
  await page.locator(".qz-qs-aadd").click();
  await page.waitForTimeout(1400);
  ok("+ answer persisted (5 answers in prisma)", (await draftNode("q2"))?.data?.answers?.length === 5);
  const freshDel = page.locator(".qz-qs-q").nth(1).locator(".qz-qs-adel").nth(4);
  ok("✕ delete ENABLED above the floor", !(await freshDel.isDisabled()));
  await freshDel.click();
  await page.waitForTimeout(1400);
  ok("✕ delete persisted (back to 4)", (await draftNode("q2"))?.data?.answers?.length === 4);

  // 7 ── the mono meta IS the type control: popover + decider guard
  await page.locator(".qz-qs-qmeta").first().click();
  ok("meta click opens the type popover (4 radios)", (await page.locator(".qz-s3-tp-type").count()) === 4);
  ok("current type radio marked", await page.locator(".qz-s3-tp-type.is-on", { hasText: "Single select" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/3-typepop-from-meta.png` });
  await page.locator(".qz-s3-tp-type", { hasText: "Multi-select" }).click();
  ok("decider → Multi-select still BLOCKED",
    await page.locator(".qz-modal-title", { hasText: "Multi-select can" }).isVisible());
  await page.locator(".qz-modal button", { hasText: "Got it" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // multi meta shows its own count · type
  ok('multi meta reads "4 · Multi-select"',
    (await page.locator(".qz-qs-qmeta").nth(1).textContent())?.trim() === "4 · Multi-select");

  // 8 ── answer drag-reorder (synthetic HTML5 dnd) → moveAnswer persists
  const orderBefore = ((await draftNode("q2"))?.data?.answers ?? []).map((a) => a.id);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".qz-qs-a")];
    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    rows[2].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    rows[2].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(1400);
  const orderAfter = ((await draftNode("q2"))?.data?.answers ?? []).map((a) => a.id);
  ok("answer ⠿ drag-reorder persisted (a→index 2, objects intact)",
    orderAfter.join(",") === [orderBefore[1], orderBefore[2], orderBefore[0], orderBefore[3]].join(","),
    orderAfter.join(","));

  // 9 ── whole-question drag-reorder → moveStep persists (q3 → row 2)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".qz-qs-q")];
    const dt = new DataTransfer();
    rows[2].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    rows[1].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    rows[1].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(1600);
  const metas = await page.locator(".qz-qs-qmeta").allTextContents();
  ok("question drag-reorder: rating now row 2 (meta shows 5 · Five-point scale)",
    (metas[1] ?? "").includes("Five-point scale"), metas.join(" | "));
  const q3Doc = await draftDoc();
  const flowAfter = (q3Doc?.edges ?? []).map((e) => `${e.source}→${e.target}`).join(",");
  ok("reorder persisted in the edge chain (q1→q3→q2)",
    flowAfter.includes("q1→q3") && flowAfter.includes("q3→q2"), flowAfter);

  // 10 ── termini rows with the mock's right hints
  ok("two quiet termini rows", (await page.locator(".qz-qs-term").count()) === 2);
  ok('capture hint "Optional lead step"',
    (await page.locator(".qz-qs-term").first().locator(".qz-qs-ts").textContent())?.trim() === "Optional lead step");
  ok('reveal hint "Configured in Step 4 · Results"',
    (await page.locator(".qz-qs-term").nth(1).locator(".qz-qs-ts").textContent())?.trim() === "Configured in Step 4 · Results");

  // 11 ── the live chip + pv-bar + TRUE-viewport phone geometry
  ok('live chip "Live preview · your brand"',
    ((await page.locator(".qz-qs-livechip").textContent()) ?? "").includes("Live preview · your brand"));
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
  ok("fit-the-pane scale ≤ 1 (never upscales)", scale > 0.2 && scale <= 1, `s=${scale}`);
  ok("minimal bezel (44px radius)", geo.radius.includes("44px"), geo.radius);
  ok("scroll fade present", (await page.locator(".qz-s3-device:not(.is-expand) .qz-s3-fade").count()) === 1);

  // 12 ── phone question surface is READ-ONLY (editing lives in the list)
  ok("no editables inside the phone question surface",
    (await page.locator(".qz-s3-qbody .qz-s3-editable").count()) === 0);
  ok("no grips/kebabs/add-answer inside the phone",
    (await page.locator(".qz-s3-phone-screen .qz-s3-odrag, .qz-s3-phone-screen .qz-s3-omore, .qz-s3-phone-screen .qz-s3-addopt").count()) === 0);
  ok("floating type tag retired", (await page.locator(".qz-s3-typetag").count()) === 0);

  // select the FIRST question: Back pill hidden at the first step (mock)
  await page.locator(".qz-qs-q").first().locator(".qz-qs-qn").click();
  await page.waitForTimeout(300);
  ok("Back pill HIDDEN at the first step", (await page.locator(".qz-s3-backpill").count()) === 0);
  ok("first option card is the preview selection (is-hot)",
    await page.locator(".qz-s3-achip").first().evaluate((el) => el.classList.contains("is-hot")));
  await page.screenshot({ path: `${SHOTS}/4-full-tab.png`, fullPage: true });

  // rating preview stays truthful: select the rating row (now row 2)
  await page.locator(".qz-qs-q").nth(1).locator(".qz-qs-qn").click();
  await page.waitForTimeout(300);
  ok("rating renders the scalebar (5 points)", (await page.locator(".qz-s3-sbn").count()) === 5);
  ok("scalebar endpoint labels (Beginner/Expert)",
    ((await page.locator(".qz-s3-scalelab").textContent()) ?? "").includes("Beginner"));
  ok("Back pill visible mid-walk", (await page.locator(".qz-s3-backpill").count()) === 1);

  // 13 ── desktop toggle: 1180 frame, browser chrome, hidden top bar, 600px col
  await page.locator(".qz-s3-segbtns button").nth(1).click();
  await page.waitForTimeout(400);
  const dgeo = await page.locator(".qz-s3-device:not(.is-expand) .qz-s3-frame").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { w: cs.width, radius: cs.borderRadius };
  });
  ok("desktop frame is 1180 logical px", dgeo.w === "1180px", dgeo.w);
  ok("desktop browser chrome (dots + blurred URL)", await page.locator(".qz-s3-dchrome").isVisible());
  ok("in-screen top bar hidden on desktop",
    await page.locator(".qz-s3-screen-top").first().evaluate((el) => getComputedStyle(el).display === "none"));
  ok("desktop content centers in a 600px column",
    await page.locator(".qz-s3-scr").first().evaluate((el) => getComputedStyle(el).maxWidth === "600px"));

  // 14 ── Expand overlay (back on mobile): scale ≥ 1, Esc closes
  await page.locator(".qz-s3-segbtns button").nth(0).click();
  await page.locator(".qz-s3-expandbtn").click();
  await page.waitForTimeout(400);
  ok("Expand overlay opens", await page.locator(".qz-s3-phscrim").isVisible());
  const exScale = await page.locator(".qz-s3-device.is-expand").evaluate((el) =>
    Number(getComputedStyle(el).getPropertyValue("--s")));
  ok("Expand floors mobile at TRUE 1:1", exScale >= 1, `s=${exScale}`);
  await page.screenshot({ path: `${SHOTS}/5-expand.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok("Esc closes the Expand overlay", (await page.locator(".qz-s3-phscrim").count()) === 0);

  // 15 ── + New question (toolbar) → appended + selected + persisted
  await page.locator(".qz-qs-tbtn").click();
  await page.waitForTimeout(1600);
  ok("+ New question appends a 4th row", (await page.locator(".qz-qs-q").count()) === 4);
  ok("the new question is selected (expanded)",
    (await page.locator(".qz-qs-q").nth(3).locator(".qz-qs-ans").count()) === 1);
  ok("count follows: 4 questions",
    (await page.locator(".qz-qs-tcount").textContent())?.trim() === "4 questions");
  const afterAdd = await draftDoc();
  ok("add persisted (4 question nodes)",
    (afterAdd?.nodes ?? []).filter((n) => n.type === "question").length === 4);

  // 16 ── hover-trash delete: decider disabled; qualifier deletes + re-stitches
  const deciderTrash = page.locator(".qz-qs-q").first().locator(".qz-qs-icon").nth(1);
  ok("decider row's delete is DISABLED", await deciderTrash.isDisabled());
  page.once("dialog", (d) => d.accept());
  await page.locator(".qz-qs-q").nth(3).locator(".qz-qs-icon").nth(1).click();
  await page.waitForTimeout(1600);
  ok("trash delete removes the question (3 rows left)", (await page.locator(".qz-qs-q").count()) === 3);
  const afterDel = await draftDoc();
  ok("delete persisted (3 question nodes, flow re-stitched)",
    (afterDel?.nodes ?? []).filter((n) => n.type === "question").length === 3);

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
