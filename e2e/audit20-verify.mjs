// AUDIT-20 re-audit probe — ai-fallbacks (docs/design/ai-fallbacks) + app-chrome
// merchant states on the LOCAL prod build + the LOCAL fixture
// cmr7khgd50001vkhscvox8dgt (decider draft). Covers the two deltas closed in
// this pass plus the audit-record screenshots of the neighboring states:
//   1. Shape "research skipped" quiet trace (mock §2): strip renders ONLY when
//      web_research_summary === "" (never for null/legacy or non-empty),
//      dismissible ✕, "Regenerate with research" action.
//   2. Funnel FAILED (gen_error banner + template escape) and STALLED
//      (halted ring + Try again) generating states — already-exact records.
//   3. Publish-degrade quiet strip (mock §2): run the server WITHOUT
//      ANTHROPIC_API_KEY so the publish-time benefit/tooltip passes fail →
//      the real publish intent from the builder UI surfaces the QUIET
//      dismissible "Published without some AI copy" strip (NOT the warn
//      caveat banner), with the "Generate them now" re-publish action.
//
// The publish scene REQUIRES the server to have no Anthropic key:
//   ANTHROPIC_API_KEY= SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x \
//     SHOPIFY_APP_URL=http://localhost:3000 PORT=3000 npm run start
// Restores draft doc + Category rows + publish state (status/publishedJson/
// version + QuizVersion rows) byte-for-byte in `finally`.
//
// Run:  set -a; source .env; set +a; node e2e/audit20-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const DIR = process.env.SHOT_DIR ?? "/tmp/ac-shots";
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
const pubSnapshot = { status: quiz.status, version: quiz.version, hadPublished: quiz.publishedJson != null };
const originalVersionIds = (
  await prisma.quizVersion.findMany({ where: { quizId: QUIZ }, select: { id: true } })
).map((v) => v.id);
console.log(
  `snapshot taken (stage=${quiz.draftJson?.build_session?.stage ?? "?"}, status=${quiz.status} v${quiz.version}, ${originalCats.length} categories)`,
);

const PROBE_TYPES = [
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
];

const setSession = async (session) => {
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: { ...quiz.draftJson, build_session: session } },
  });
};

const browser = await chromium.launch();
let ctx;
try {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // ── 1 · Shape "research skipped" quiet trace ──────────────────────────────
  await setSession({ stage: "types", quiz_types: PROBE_TYPES, web_research_summary: "" });
  try {
    await page.goto(`${BASE}/studio/onboarding/${QUIZ}?key=${KEY}`, {
      waitUntil: "domcontentloaded",
    });
  } catch (e) {
    throw new Error(mask(e.message));
  }
  await page.waitForSelector(".qz-shape-page", { timeout: 15000 });
  const strip = page.locator(".qz-shape-page .qz-banner-quiet");
  check("research trace: quiet strip renders", (await strip.count()) === 1);
  check(
    "research trace: title + glyph + tokens",
    await strip
      .evaluate((el) => {
        const glyph = el.querySelector(".qz-banner-glyph");
        const title = el.querySelector(".qz-banner-title");
        const cs = getComputedStyle(el);
        return (
          glyph?.textContent === "✦" &&
          (title?.textContent ?? "").includes("Suggested without live research") &&
          cs.backgroundColor !== "rgba(0, 0, 0, 0)"
        );
      })
      .catch(() => false),
  );
  const regenBtn = strip.locator("button", { hasText: "Regenerate with research" });
  check("research trace: regenerate action present", (await regenBtn.count()) === 1);
  await page.screenshot({ path: `${DIR}/1-shape-research-trace.png`, fullPage: true });

  // Dismiss ✕ hides it (interactive proof, not a DOM marker).
  await strip.locator(".qz-banner-x").click();
  await page.waitForTimeout(200);
  check("research trace: ✕ dismisses", (await strip.count()) === 0);
  await page.screenshot({ path: `${DIR}/2-shape-trace-dismissed.png`, fullPage: true });

  // Non-empty summary → no strip. Absent summary (legacy) → no strip.
  await setSession({
    stage: "types",
    quiz_types: PROBE_TYPES,
    web_research_summary: "Quiz best practices: keep it to 5 questions…",
  });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-shape-page", { timeout: 15000 });
  check("research ok: no strip", (await page.locator(".qz-banner-quiet").count()) === 0);
  await setSession({ stage: "types", quiz_types: PROBE_TYPES });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-shape-page", { timeout: 15000 });
  check("legacy null summary: no strip", (await page.locator(".qz-banner-quiet").count()) === 0);

  // ── 2 · Funnel FAILED + STALLED generating states (audit record) ─────────
  await setSession({
    stage: "types",
    quiz_types: PROBE_TYPES,
    gen_error: "AI couldn't finish the question flow. Try again or start from a template.",
  });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-shape-page", { timeout: 15000 });
  check(
    "failed: gen_error banner + template escape",
    (await page.locator(".qz-banner-warn", { hasText: "AI generation didn't finish" }).count()) === 1 &&
      (await page.locator("a", { hasText: "Start from a template" }).count()) >= 1,
  );
  await page.screenshot({ path: `${DIR}/3-funnel-failed.png`, fullPage: true });

  await setSession({ stage: "typing", quiz_types: [] });
  // Backdate updatedAt past the 200s stall threshold — pg stores timezone-naive
  // timestamps read as UTC, so write a NAIVE iso string via ::timestamp.
  const stale = new Date(Date.now() - 260_000).toISOString().replace("Z", "");
  await prisma.$executeRaw`UPDATE "Quiz" SET "updatedAt" = ${stale}::timestamp WHERE "id" = ${QUIZ}`;
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-gen", { timeout: 15000 });
  check(
    "stalled: halted ring + Try again + template escape",
    (await page.locator(".qz-gen-haltglyph").count()) === 1 &&
      (await page.locator(".qz-gen-title", { hasText: "taking longer than it should" }).count()) === 1 &&
      (await page.locator(".qz-gen-actions button", { hasText: "Try again" }).count()) === 1,
  );
  await page.screenshot({ path: `${DIR}/4-funnel-stalled.png`, fullPage: true });

  // ── 3 · Publish-degrade quiet strip (server runs with NO Anthropic key) ──
  // Restore the original draft (stage grouping) so the builder sees the real
  // doc: 1 result w/ no why_bullets + 2 questions w/ no tooltips → publish's
  // AI passes run, throw (no key), and flip aiCopyDegraded.
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await page.goto(`${BASE}/studio/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 20000 });
  const publishBtn = page.locator("button", { hasText: /^(◆ )?Publish$/ }).first();
  check("builder: Publish clickable", (await publishBtn.count()) === 1 && (await publishBtn.isEnabled()));
  await publishBtn.click();
  const pubStrip = page.locator(".qz-banner-quiet");
  await pubStrip.waitFor({ timeout: 30000 });
  check(
    "publish degrade: QUIET strip with title + glyph",
    await pubStrip
      .first()
      .evaluate((el) => {
        const title = el.querySelector(".qz-banner-title")?.textContent ?? "";
        return (
          title.includes("Published without some AI copy") &&
          el.querySelector(".qz-banner-glyph")?.textContent === "✦"
        );
      })
      .catch(() => false),
  );
  check(
    "publish degrade: regenerate action present",
    (await pubStrip.locator("button", { hasText: "Generate them now" }).count()) >= 1,
  );
  check(
    "publish degrade: NOT the warn caveat banner",
    (await page.locator(".qz-banner-warn", { hasText: "Published with a caveat" }).count()) === 0,
  );
  check(
    "publish degrade: success banner still shows (published, not blocked)",
    (await page.locator(".qz-banner-ok", { hasText: "Published v" }).count()) >= 1,
  );
  await page.screenshot({ path: `${DIR}/5-publish-degrade-strip.png`, fullPage: true });
  await pubStrip.first().locator(".qz-banner-x").click();
  await page.waitForTimeout(200);
  check("publish degrade: ✕ dismisses", (await page.locator(".qz-banner-quiet").count()) === 0);
  await page.screenshot({ path: `${DIR}/6-publish-strip-dismissed.png`, fullPage: true });
} finally {
  // Restore draft doc + Category rows + publish state byte-for-byte.
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: {
      draftJson: quiz.draftJson,
      status: pubSnapshot.status,
      version: pubSnapshot.version,
      ...(pubSnapshot.hadPublished ? {} : { publishedJson: Prisma.DbNull }),
    },
  });
  await prisma.quizVersion.deleteMany({
    where: { quizId: QUIZ, id: { notIn: originalVersionIds.length ? originalVersionIds : ["-"] } },
  });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  await prisma.$disconnect();
  await browser.close();
  console.log("fixture restored (draft doc + categories + publish state)");
}

for (const line of results) console.log(line);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
