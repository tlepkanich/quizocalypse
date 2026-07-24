// AUDIT-18 re-audit probe — Step-1 (Recommendations) + Step-2 (Shape) vs the
// full docs/design sub-file set. LOCAL prod build + the LOCAL fixture
// cmr7khgd50001vkhscvox8dgt (decider draft). Seeds build_session stages via
// prisma (grouping → types with two authored quiz_types), walks the real
// affordances, and restores the draft doc + Category rows byte-for-byte in
// `finally`. Screenshots land in SHOT_DIR (default /tmp/s12-shots).
//
// Run:  set -a; source .env; set +a; node e2e/s12-reaudit-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const DIR = process.env.SHOT_DIR ?? "/tmp/s12-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });

const mask = (s) => String(s).replaceAll(KEY, "***");
const results = [];
const check = (name, ok, extra = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${mask(extra)}` : ""}`);

const prisma = new PrismaClient();
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found in the LOCAL DB");
  process.exit(1);
}
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
console.log(
  `snapshot taken (stage=${quiz.draftJson?.build_session?.stage ?? "?"}, ${originalCats.length} categories)`,
);

const setStage = async (session) => {
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: { ...quiz.draftJson, build_session: session } },
  });
};

const browser = await chromium.launch();
let ctx;
try {
  // ── Step 1 — grouping ──────────────────────────────────────────────────────
  await setStage({ stage: "grouping" });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/studio/onboarding/${QUIZ}?key=${KEY}`, {
      waitUntil: "domcontentloaded",
    });
  } catch (e) {
    throw new Error(mask(e.message));
  }
  await page.waitForSelector(".qz-rb", { timeout: 15000 });

  // Stepper: the mock progress line — label BELOW the dot, 2px flexed links.
  const geom = await page.evaluate(() => {
    const dot = document.querySelector(".qz-topbar-nav .qz-stepnav-pill.is-current .qz-stepnav-dot");
    const name = document.querySelector(".qz-topbar-nav .qz-stepnav-pill.is-current .qz-stepnav-name");
    const link = document.querySelector(".qz-topbar-nav .qz-stepnav-link");
    const nav = document.querySelector(".qz-topbar-nav .qz-stepnav");
    if (!dot || !name || !link || !nav) return null;
    const d = dot.getBoundingClientRect();
    const n = name.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    return {
      labelBelowDot: n.top >= d.bottom,
      dotSize: Math.round(d.width),
      linkHeight: Math.round(l.height),
      linkWide: l.width > 60,
      linkNearDotCenter: Math.abs((l.top + l.height / 2) - (d.top + d.height / 2)) < 4,
      navWide: nav.getBoundingClientRect().width > 900,
    };
  });
  check("stepper geometry read", geom !== null);
  if (geom) {
    check("label sits BELOW the dot", geom.labelBelowDot, JSON.stringify(geom));
    check("24px dot", geom.dotSize === 24);
    check("2px connectors", geom.linkHeight === 2);
    check("connectors flex full-width", geom.linkWide && geom.navWide);
    check("connector aligned to dot center", geom.linkNearDotCenter);
  }
  check(
    "5 steps, current = Recommendations",
    (await page.locator(".qz-topbar-nav .qz-stepnav-pill").count()) === 5 &&
      ((await page.locator(".qz-topbar-nav .qz-stepnav-pill.is-current").textContent()) ?? "").includes(
        "Recommendations",
      ),
  );

  // AI tip — first visit renders EXPANDED (fresh context, no seen flag).
  const tipOpen = (await page.locator(".qz-rb-ai-tip").count()) === 1;
  check("first visit: tip expanded", tipOpen);
  if (tipOpen) {
    check("mono AI TIP label", (await page.locator(".qz-rb-ai-label").textContent()) === "AI TIP");
    check(
      "Based-on chips",
      ((await page.locator(".qz-rb-ai-based").textContent()) ?? "").startsWith("Based on"),
    );
    await page.screenshot({ path: `${DIR}/s1-tip-expanded.png`, clip: { x: 0, y: 0, width: 1440, height: 480 } });
    // Hide → the ✦ AI TIP mini pill; pill click → expands again.
    await page.locator(".qz-rb-ai-hide").click();
    check("Hide collapses to the pill", (await page.locator(".qz-rb-ai-pill").count()) === 1);
    const spark = await page
      .locator(".qz-rb-ai-spark")
      .evaluate((el) => ({ w: el.getBoundingClientRect().width, bg: getComputedStyle(el).backgroundColor }));
    check("pill icon is a 22px wash tile", Math.round(spark.w) === 22, JSON.stringify(spark));
    await page.screenshot({ path: `${DIR}/s1-tip-pill.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } });
    await page.locator(".qz-rb-ai-pill").click();
    check("pill click re-expands", (await page.locator(".qz-rb-ai-tip").count()) === 1);
    // Second visit (same context, seen flag set) → collapsed.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-rb", { timeout: 15000 });
    check("second visit: tip collapsed to pill", (await page.locator(".qz-rb-ai-pill").count()) === 1);
  }

  // Underrow = quiet accent-ink text links, not ghost buttons.
  check(
    "underrow quiet links",
    (await page.locator(".qz-rb-underrow .qz-rb-underlink").count()) === 2 &&
      (await page.locator(".qz-rb-underrow .qz-btn").count()) === 0,
  );

  // Exactly ONE selection → the amber warning (gold tokens).
  // Normalize: deselect everything first via the rail ✕s, then pick one row.
  while ((await page.locator(".qz-rb-rail-row .qz-rb-chip-x").count()) > 0) {
    await page.locator(".qz-rb-rail-row .qz-rb-chip-x").first().click();
    // A referenced-removal confirm may interpose — accept it.
    const confirm = page.locator(".qz-modal button", { hasText: /^(Remove|Continue)$/ });
    if (await confirm.count()) await confirm.first().click();
    await page.waitForTimeout(350);
  }
  await page.locator('.qz-rb-card[aria-pressed="false"]').first().click();
  await page.waitForSelector(".qz-rb-warn", { timeout: 8000 });
  const warn = await page
    .locator(".qz-rb-warn")
    .evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  // --qz-gold-wash #FDF6E0 / --qz-gold #8C6D1F
  check("single-selection warn is amber", warn.bg === "rgb(253, 246, 224)" && warn.color === "rgb(140, 109, 31)", JSON.stringify(warn));

  // Count-pill → centered modal with the "N products in this …" meta line.
  await page.locator(".qz-rb-tab", { hasText: "Collections" }).click().catch(() => {});
  const lock = page.locator(".qz-modal button", { hasText: "Switch types" });
  if (await lock.count()) await lock.click(); // homogeneity confirm if tab changed type
  await page.waitForTimeout(400);
  const countLink = page.locator(".qz-rb-count-link").first();
  if (await countLink.count()) {
    await countLink.click();
    await page.waitForSelector(".qz-rb-modal-meta", { timeout: 5000 });
    const meta = (await page.locator(".qz-rb-modal-meta").textContent()) ?? "";
    check("modal meta line", /\d+ products? in this (collection|tag)/.test(meta), meta);
    await page.screenshot({ path: `${DIR}/s1-products-modal.png` });
    await page.locator(".qz-modal button", { hasText: "Done" }).click();
  } else {
    check("modal meta line", false, "no count pill found on the Collections tab");
  }
  await page.screenshot({ path: `${DIR}/s1-page.png`, fullPage: true });

  // ── Step 2 — shape (stage "types" + two authored quiz_types) ──────────────
  await setStage({
    stage: "types",
    quiz_types: [
      {
        id: "probe-match",
        experience_type: "product_match",
        name: "Find Your Perfect Board",
        achieves: "The right board in a few quick taps",
        question_range: { min: 4, max: 6 },
        best_practice_note: "",
        rationale: "Your catalog has the range to match with confidence",
        web_research_excerpt: "",
      },
      {
        id: "probe-personality",
        experience_type: "personality",
        name: "What's Your Rider Type?",
        achieves: "Turn a personality read into a gear match",
        question_range: { min: 5, max: 7 },
        best_practice_note: "",
        rationale: "Best when shoppers don't know the specs yet",
        web_research_excerpt: "",
      },
    ],
  });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-shape-page", { timeout: 15000 });

  check(
    "shape title only",
    ((await page.locator(".qz-shape-page > .qz-h2").textContent()) ?? "").trim() ===
      "Choose the optimal quiz type",
  );
  check("two type cards", (await page.locator(".qz-shape-card").count()) === 2);
  check(
    "ribbon on the top pick only",
    (await page.locator(".qz-shape-ribbon").count()) === 1 &&
      ((await page.locator(".qz-shape-ribbon").textContent()) ?? "").includes("Recommended"),
  );
  check(
    "stepper: Recommendations done ✓, Shape current",
    (await page.locator(".qz-topbar-nav .qz-stepnav-pill.is-done .qz-stepnav-check").count()) === 1 &&
      ((await page.locator(".qz-topbar-nav .qz-stepnav-pill.is-current").textContent()) ?? "").includes("Shape"),
  );
  const film = await page.locator(".qz-shape-film").first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(el).borderRadius };
  });
  check(
    "film holds the 3/4 frame (272×~363, r26)",
    film.w === 272 && Math.abs(film.h - 363) <= 2 && film.radius === "26px",
    JSON.stringify(film),
  );
  check(
    "brand fonts stylesheet mounted for the films",
    (await page.locator('.qz-shape-page link[rel="stylesheet"][href*="fonts.googleapis"]').count()) === 1,
  );
  const lines = await page.locator(".qz-shape-card").first().locator(".qz-shape-line b").allTextContents();
  check("GOAL/WHY rows", JSON.stringify(lines.map((s) => s.trim())) === JSON.stringify(["Goal", "Why"]), JSON.stringify(lines));
  check(
    "questions meta",
    ((await page.locator(".qz-shape-meta").first().textContent()) ?? "").includes("4–6 questions"),
  );
  // Commit-on-card: Use this → Continue → build your questions (no submit).
  const pick0 = page.locator(".qz-shape-pick").first();
  check("unselected button = Use this", ((await pick0.textContent()) ?? "").trim() === "Use this");
  await pick0.click();
  check(
    "selected button = Continue → build your questions",
    ((await pick0.textContent()) ?? "").trim() === "Continue → build your questions" &&
      (await page.locator(".qz-shape-card.is-active").count()) === 1,
  );
  // Radio semantics — picking the other card moves the selection.
  await page.locator(".qz-shape-pick").nth(1).click();
  check(
    "radio semantics across cards",
    ((await page.locator(".qz-shape-pick").nth(1).textContent()) ?? "").trim() ===
      "Continue → build your questions" &&
      ((await pick0.textContent()) ?? "").trim() === "Use this",
  );
  // Personality card's film: persona block on the results screen.
  check(
    "personality film carries the persona block",
    (await page.locator(".qz-shape-card").nth(1).locator(".qz-shape-persona").count()) === 1,
  );
  // Other ways to start + the quiet under-row.
  await page.locator(".qz-shape-other summary").click();
  const opts = await page.locator(".qz-shape-oopt .qz-shape-on").allTextContents();
  check(
    "Other-ways options",
    opts.some((t) => t.includes("Write your own goal")) && opts.some((t) => t.includes("Build manually")),
    JSON.stringify(opts),
  );
  check(
    "under-row escapes",
    ((await page.locator(".qz-shape-underrow").textContent()) ?? "").includes("Regenerate suggestions"),
  );
  await page.screenshot({ path: `${DIR}/s2-shape.png`, fullPage: true });

  // Leave-setup confirm on ← Homepage (mock copy, EXACT).
  await page.locator("button", { hasText: "← Homepage" }).click();
  await page.waitForSelector(".qz-modal", { timeout: 5000 });
  const leaveCopy = (await page.locator(".qz-modal").textContent()) ?? "";
  check(
    "Leave setup? modal copy",
    leaveCopy.includes("Leave setup?") &&
      leaveCopy.includes("Your quiz is saved as a draft — you can pick up right here anytime.") &&
      leaveCopy.includes("Stay here") &&
      leaveCopy.includes("Go to homepage"),
  );
  await page.screenshot({ path: `${DIR}/s2-leave-confirm.png` });
  await page.locator(".qz-modal button", { hasText: "Stay here" }).click();
  check("Stay here closes without navigating", page.url().includes("/studio/onboarding/"));
} finally {
  // Restore the draft doc + Category rows byte-for-byte.
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  await prisma.$disconnect();
  await browser.close();
  console.log("fixture restored (draft doc + categories)");
}

for (const line of results) console.log(line);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
