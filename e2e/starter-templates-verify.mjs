// PORT-10 probe — global industry "starter" templates. UPDATED for FLOW-3:
// the starter rail RELOCATED from the Shape stage to the /studio/templates
// front door. LOCAL prod build + LOCAL DB, seeded with the 8 starters
// (node scripts/seed-templates.mjs) and the fixture cmr7khgd50001vkhscvox8dgt
// (decider draft). Run with ANTHROPIC_API_KEY= EMPTY (the templates page kicks
// a candidate-generation job on first visit — with no key it fails fast to the
// four-outcome banner, which is fine here; flow3-verify.mjs owns that surface).
//
// Asserts: (1) the 8 global rows are seeded; (2) Shape (a draft parked at
// stage "types") no longer shows the starter rail; (3) /studio/templates shows
// the 8 labeled starter pills; (4) picking one enters the funnel pre-marked
// (template_first.picked="template" + the industry payload + neutralized
// bucket ids — picked_template itself now lands at the flow3-confirm).
// Restores the fixture draft byte-for-byte and deletes/restores the templates
// page's claimed draft in `finally`. Screenshots in SHOT_DIR (/tmp/tpl-shots).
//
// Run:  set -a; source .env; set +a; node e2e/starter-templates-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const DIR = process.env.SHOT_DIR ?? "/tmp/tpl-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });

const mask = (s) => String(s).replaceAll(KEY, "***");
const results = [];
const check = (name, ok, extra = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${mask(extra)}` : ""}`);

const EXPECTED_SLUGS = [
  "starter-apparel-fit",
  "starter-durables-narrower",
  "starter-gift-finder",
  "starter-instant-shade-match",
  "starter-pet-food-plan",
  "starter-skincare-formulation",
  "starter-subscription-onboarding",
  "starter-supplements-routine",
];

const prisma = new PrismaClient();
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found in the LOCAL DB");
  process.exit(1);
}
const globalRows = await prisma.savedTemplate.findMany({ where: { shopId: null } });
check(
  "8 global starter rows seeded (shopId=NULL)",
  globalRows.length === 8 &&
    EXPECTED_SLUGS.every((s) => globalRows.some((r) => r.slug === s)),
  `found ${globalRows.length}`,
);
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
console.log(
  `snapshot taken (stage=${quiz.draftJson?.build_session?.stage ?? "?"}, ${originalCats.length} categories)`,
);

// The /studio/templates loader may CLAIM a pre-existing pristine step1 draft —
// snapshot them all so the claimed one restores byte-for-byte (only a
// genuinely new draft is deleted). The flow1/flow3-verify discipline.
const preExisting = new Map(
  (
    await prisma.quiz.findMany({
      where: { buildState: "step1" },
      select: { id: true, name: true, draftJson: true },
    })
  ).map((q) => [q.id, { name: q.name, draftJson: q.draftJson }]),
);
const preExistingCats = await prisma.category.findMany({
  where: { quizId: { in: [...preExisting.keys()] } },
});

// Park the fixture draft at the decider Shape (stage "types") with two
// authored types — still reachable by legacy in-flight drafts.
const probeTypes = [
  {
    id: "probe-type-a",
    experience_type: "product_match",
    name: "Probe Terrain Finder",
    achieves: "Match riders to the right board",
    question_range: { min: 4, max: 7 },
    best_practice_note: "",
    rationale: "probe",
    web_research_excerpt: "",
  },
  {
    id: "probe-type-b",
    experience_type: "product_match",
    name: "Probe Setup Builder",
    achieves: "Build a full setup",
    question_range: { min: 5, max: 8 },
    best_practice_note: "",
    rationale: "probe",
    web_research_excerpt: "",
  },
];
await prisma.quiz.update({
  where: { id: QUIZ },
  data: {
    draftJson: {
      ...quiz.draftJson,
      build_session: { stage: "types", quiz_types: probeTypes, web_research_summary: "probe" },
    },
  },
});

const browser = await chromium.launch();
let claimedId = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // ── 1 · Shape no longer carries the starter rail (FLOW-3 relocation) ───────
  try {
    await page.goto(`${BASE}/studio/onboarding/${QUIZ}?key=${KEY}`, {
      waitUntil: "domcontentloaded",
    });
  } catch (e) {
    throw new Error(mask(e.message));
  }
  await page.waitForSelector(".qz-shape-page", { timeout: 15000 });
  await page.locator(".qz-shape-other summary").click();
  await page.waitForSelector(".qz-shape-other-body", { timeout: 5000 });
  const otherBody = (await page.locator(".qz-shape-other-body").textContent()) ?? "";
  check(
    "Shape's starter rail is GONE (relocated to /studio/templates)",
    (await page.locator("[data-starter-rail]").count()) === 0 &&
      !otherBody.includes("Start from an industry template"),
  );
  check(
    "Shape's other escapes remain (goal + manual)",
    otherBody.includes("Write your own goal") && otherBody.includes("Build manually"),
  );
  check(
    "no shop-saved rail on a shop with no saved templates",
    (await page.locator(".qz-shape-savedrail").count()) === 0,
  );
  await page.screenshot({ path: `${DIR}/shape-no-starters.png`, fullPage: true });

  // ── 2 · The starters live on /studio/templates now ─────────────────────────
  await page.goto(`${BASE}/studio/templates`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-tf-page", { timeout: 15000 });
  claimedId = await page.locator(".qz-tf-page").getAttribute("data-quiz-id");
  if (claimedId && !preExisting.has(claimedId)) {
    await prisma.quiz.update({
      where: { id: claimedId },
      data: { name: `tpl-probe-${Date.now()}` },
    });
  }
  const header = (await page.locator(".qz-tf-page").textContent()) ?? "";
  check(
    "starter section header + copy on the templates page",
    header.includes("Start from an industry template") &&
      header.includes("Proven quiz structures by vertical"),
  );
  const starterPills = page.locator("[data-starter-rail] .qz-shape-savedpill");
  check("8 starter pills render", (await starterPills.count()) === 8, `${await starterPills.count()}`);
  const pillTexts = await starterPills.allTextContents();
  check(
    "pills are ✦-labeled with a vertical tag",
    pillTexts.every((t) => t.trim().startsWith("✦")) &&
      pillTexts.some((t) => t.includes("Gift finder") && t.includes("Gifting")) &&
      pillTexts.some((t) => t.includes("Custom-formulation diagnostic") && t.includes("Beauty")) &&
      pillTexts.some((t) => t.includes("Subscription onboarding") && t.includes("Subscription")),
    JSON.stringify(pillTexts),
  );
  await page.screenshot({ path: `${DIR}/starters-rail.png`, fullPage: true });

  // ── 3 · Picking a starter enters the funnel pre-marked ─────────────────────
  await page
    .locator("[data-starter-rail] .qz-shape-savedpill", { hasText: "Gift finder" })
    .click();
  await page.waitForURL(/\/studio\/onboarding\//, { timeout: 30000 });
  const row = await prisma.quiz.findUnique({
    where: { id: claimedId },
    select: { draftJson: true },
  });
  const s = row?.draftJson?.build_session ?? {};
  const rich = (s.rich_templates ?? [])[0] ?? null;
  check(
    "pick enters the funnel pre-marked (template_first.picked = template)",
    s.template_first?.picked === "template" && s.stage === "grouping",
    `picked=${s.template_first?.picked} stage=${s.stage}`,
  );
  check(
    "the session's rich template carries the industry payload",
    rich?.id === "starter-gift-finder" &&
      rich?.industry?.category === "gifting" &&
      Array.isArray(rich?.industry?.questions) &&
      rich.industry.questions.length > 0,
  );
  check(
    "recommended_bucket_ids neutralized for this draft",
    Array.isArray(rich?.recommended_bucket_ids) && rich.recommended_bucket_ids.length === 0,
  );
  await page.screenshot({ path: `${DIR}/starter-picked-recs.png`, fullPage: true });
} finally {
  // Restore the fixture draft doc + Category rows byte-for-byte.
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  // Restore or delete the templates page's claimed draft.
  if (claimedId && claimedId !== QUIZ) {
    await prisma.category.deleteMany({ where: { quizId: claimedId } }).catch(() => {});
    const prior = preExisting.get(claimedId);
    if (prior) {
      await prisma.quiz
        .update({
          where: { id: claimedId },
          data: { name: prior.name, draftJson: prior.draftJson, buildState: "step1" },
        })
        .catch(() => {});
      for (const c of preExistingCats.filter((c) => c.quizId === claimedId)) {
        const { id: _drop, createdAt: _c, updatedAt: _u, ...data } = c;
        await prisma.category.create({ data }).catch(() => {});
      }
      console.log(`claimed pre-existing draft ${claimedId} restored`);
    } else {
      await prisma.quiz.delete({ where: { id: claimedId } }).catch(() => {});
      console.log(`probe draft ${claimedId} deleted`);
    }
  }
  await prisma.$disconnect();
  await browser.close();
  console.log("fixture restored (draft doc + categories)");
}

for (const line of results) console.log(line);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
