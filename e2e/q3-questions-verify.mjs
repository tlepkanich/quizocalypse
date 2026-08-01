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
//
// AUDIT-23 additions (exact-replica escalation): the ✎ panel is the mock's
// CENTERED 996px column (equal side margins — the builder/phone example can
// never glue to the screen edge again) · the phone sits at the mock's fixed
// mobile scale (--s .80 in the 340px pane, 14px gutters, holder centered) ·
// the step counter counts QUESTIONS only ("1/3") · option cards are white
// brand cards · termini sit tight under the list.
//
// ONE-LINE-CHROME rewrite (6ee1ee5): the in-shell ✎/▦ view toggle is RETIRED —
// Logic is its own funnel STAGE after Questions. The probe drives the REAL bar
// affordances: Continue posts the to-logic intent (build_session.stage
// persists to "logic") and the surface becomes the questions-full-page.html
// LEDGER — ONE connected bordered container (.qz-s3-ledger) of flush hairline
// rows (no per-row radius/side borders/gaps), the right column defined ONCE
// (--rcol: 226px) so the settings divider runs one vertical line through
// header AND body (§1.1), N+1 ＋ inserters riding the dividers (leading one
// included), capture terminal OUTSIDE the ledger, decider guards (solid-accent
// numchip, disabled .qz-s3-cdel). The bar's ‹ back drives goto-stage
// (backwards-only, server-enforced) home to Questions.
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

  // 2b ── one-line-chrome: pages are CAPPED — .qz-page.is-funnel is a 1000px
  // centered column (952px content at 24px side padding) and the panel fills
  // its content box (the AUDIT-23 self-owned 996px width is retired).
  const panelGeo = await page.locator(".qz-qs-panel").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const pg = el.closest(".qz-page");
    const cs = getComputedStyle(pg);
    const content = pg.getBoundingClientRect().width -
      parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { w: r.width, left: r.left, right: window.innerWidth - r.right, content };
  });
  ok("panel fills the capped 1000px funnel column (952 content)",
    Math.abs(panelGeo.w - panelGeo.content) < 2 && Math.abs(panelGeo.w - 952) < 3,
    `${panelGeo.w} vs content ${panelGeo.content}`);
  ok("panel is CENTERED (equal side margins)",
    Math.abs(panelGeo.left - panelGeo.right) < 4, `L${panelGeo.left} R${panelGeo.right}`);
  // The device holds the mock's fixed mobile scale (.80 → 312px in the 340
  // pane) and sits centered in the pane.
  const holderGeo = await page.locator(".qz-s3-device:not(.is-expand) .qz-s3-holder").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const pv = el.closest(".qz-qs-pv").getBoundingClientRect();
    return { w: r.width, lgap: r.left - pv.left, rgap: pv.right - r.right };
  });
  ok("phone at the mock scale (holder ≈312px = 390×.80)",
    Math.abs(holderGeo.w - 312) < 3, `${holderGeo.w}`);
  ok("phone centered in the pane (equal gutters)",
    Math.abs(holderGeo.lgap - holderGeo.rgap) < 3, `L${holderGeo.lgap} R${holderGeo.rgap}`);
  // Mock stepn — questions-only counting ("1/3", never the walk's "1/5").
  ok('step counter counts questions only ("1/3")',
    (await page.locator(".qz-s3-kicker").textContent())?.trim() === "1/3");
  // Mock .opt — a white brand card.
  ok("option cards are white brand cards",
    await page.locator(".qz-s3-achip").first().evaluate(
      (el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)"));
  // Mock — the termini sit TIGHT under the list (never pushed to the foot).
  ok("termini sit tight under the question list",
    await page.locator(".qz-qs-term").first().evaluate((el) => {
      const list = document.querySelector(".qz-qs-list").getBoundingClientRect();
      return Math.abs(el.getBoundingClientRect().top - list.bottom) < 8;
    }));

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
  ok("+ answer persisted (5 answers in prisma)",
    await waitDraft((d) => d?.nodes?.find((n) => n.id === "q2")?.data?.answers?.length === 5));
  const freshDel = page.locator(".qz-qs-q").nth(1).locator(".qz-qs-adel").nth(4);
  ok("✕ delete ENABLED above the floor", !(await freshDel.isDisabled()));
  await freshDel.click();
  ok("✕ delete persisted (back to 4)",
    await waitDraft((d) => d?.nodes?.find((n) => n.id === "q2")?.data?.answers?.length === 4));

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

  // 17 ── one-line-chrome: the ✎/▦ toggle is RETIRED — Logic is a separate
  // funnel STAGE. Drive the REAL affordance: the bar's Continue posts the
  // to-logic intent; the loader revalidates into the logic-mode shell.
  ok("in-shell ✎/▦ view toggle retired", (await page.locator(".qz-s3-viewtoggle").count()) === 0);
  await page.locator(".qz-topbar-continue").click();
  await page.waitForSelector(".qz-s3-ledger", { timeout: 15000 });
  await page.waitForTimeout(500);
  ok('to-logic persisted (build_session.stage "logic")',
    (await draftDoc())?.build_session?.stage === "logic");
  ok("Questions panel unmounted on the Logic stage",
    (await page.locator(".qz-qs-panel").count()) === 0);
  const lvGeo = await page.locator(".qz-s3-logicview").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, left: r.left, right: window.innerWidth - r.right };
  });
  ok("Logic column stays the centered ≤1076px wrap",
    lvGeo.w <= 1078 && Math.abs(lvGeo.left - lvGeo.right) < 4,
    `w${lvGeo.w} L${lvGeo.left} R${lvGeo.right}`);

  // 18 ── questions-full-page §1: ONE connected LEDGER, not floating cards
  ok("ONE connected ledger container", (await page.locator(".qz-s3-ledger").count()) === 1);
  ok("one ledger row per question (3 rows / 3 cards)",
    (await page.locator(".qz-s3-ledger .qz-s3-ledgerrow").count()) === 3 &&
    (await page.locator(".qz-s3-ledger .qz-s3-card").count()) === 3);
  const rowGeo = await page.locator(".qz-s3-ledger .qz-s3-card").evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        radius: cs.borderRadius, bottom: cs.borderBottomWidth,
        side: cs.borderLeftWidth, top: r.top, bot: r.bottom,
      };
    }));
  ok("rows are square-cornered + side-borderless (the container owns the frame)",
    rowGeo.every((g) => g.radius === "0px" && g.side === "0px"),
    rowGeo.map((g) => `${g.radius}/${g.side}`).join(" "));
  ok("1px hairline between rows, none after the last",
    rowGeo.slice(0, -1).every((g) => g.bottom === "1px") && rowGeo.at(-1).bottom === "0px",
    rowGeo.map((g) => g.bottom).join(" "));
  ok("rows sit FLUSH (inserters ride the hairline — zero gaps)",
    rowGeo.slice(1).every((g, i) => Math.abs(g.top - rowGeo[i].bot) <= 1.5),
    rowGeo.slice(1).map((g, i) => (g.top - rowGeo[i].bot).toFixed(1)).join(" "));

  // §1.1 — the right column is defined ONCE (--rcol: 226px): header AND body
  // grids end in the same 226px track, and the settings divider (border-left
  // of .qz-s3-card-type / .qz-s3-card-set) sits on ONE vertical line.
  const colGeo = await page.locator(".qz-s3-ledger .qz-s3-card").evaluateAll((els) =>
    els.map((el) => {
      const lastTrack = (n) => {
        const t = getComputedStyle(n).gridTemplateColumns.trim().split(/\s+/);
        return parseFloat(t[t.length - 1]);
      };
      const typeL = el.querySelector(".qz-s3-card-type")?.getBoundingClientRect().left ?? NaN;
      const setL = el.querySelector(".qz-s3-card-set")?.getBoundingClientRect().left ?? NaN;
      return {
        head: lastTrack(el.querySelector(".qz-s3-card-head")),
        body: lastTrack(el.querySelector(".qz-s3-card-body")),
        delta: Math.abs(typeL - setL),
      };
    }));
  ok("right column is the spec's 226px on EVERY head + body grid",
    colGeo.every((g) => Math.abs(g.head - 226) < 1 && Math.abs(g.body - 226) < 1),
    colGeo.map((g) => `${g.head}/${g.body}`).join(" "));
  ok("§1.1 — settings divider runs ONE vertical line down the ledger",
    colGeo.every((g) => g.delta < 1), colGeo.map((g) => g.delta.toFixed(1)).join(" "));

  // N+1 ＋ inserters INSIDE the ledger (leading + one per row), riding the
  // dividers; the capture terminal stays OUTSIDE the ledger, below it.
  ok("N+1 inserters inside the ledger (4 for 3 questions)",
    (await page.locator(".qz-s3-ledger .qz-s3-divider").count()) === 4);
  ok("the leading inserter is the ledger's first child",
    await page.locator(".qz-s3-ledger > :first-child").evaluate(
      (el) => el.classList.contains("qz-s3-divider")));
  ok("capture terminal OUTSIDE the ledger (map's last module)",
    (await page.locator(".qz-s3-ledger .qz-s3-capmod").count()) === 0 &&
    (await page.locator(".qz-s3-logic .qz-s3-capmod").count()) === 1);

  // decider guards carried into the ledger: solid-accent numchip (no gold),
  // hover-reveal delete disabled on the deciding row.
  const chipBgs = await page.locator(".qz-s3-ledger .qz-s3-card .qz-s3-numchip").evaluateAll(
    (els) => els.map((el) => getComputedStyle(el).backgroundColor));
  ok("decider numchip is SOLID ACCENT (no gold anywhere)",
    chipBgs.includes("rgb(109, 90, 230)") && !chipBgs.some((c) => c === "rgb(140, 109, 31)"),
    chipBgs.join(" | "));
  ok("decider row's ledger delete (.qz-s3-cdel) is DISABLED",
    await page.locator(".qz-s3-ledger .qz-s3-card").first().locator(".qz-s3-cdel").isDisabled());
  await page.screenshot({ path: `${SHOTS}/6-logic-ledger.png`, fullPage: true });

  // 19 ── the bar's ‹ back = the goto-stage intent (backwards-only) → the
  // Questions stage again, so the walk proves both directions of the seam.
  await page.locator(".qz-topbar-back").click();
  await page.waitForSelector(".qz-qs-panel", { timeout: 15000 });
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
