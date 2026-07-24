// PORT-10 probe — global industry "starter" templates in the Shape stage.
// LOCAL prod build + the LOCAL fixture cmr7khgd50001vkhscvox8dgt (decider
// draft). Requires the local DB to be seeded (node scripts/seed-templates.mjs)
// and the server to run with ANTHROPIC_API_KEY= EMPTY (the pick kicks a real
// question build — with no key it fails fast to a gen_error, which is exactly
// what we wait for before restoring). Seeds build_session stage "types" via
// prisma, opens "Other ways to start", asserts the 8 labeled starters render,
// picks one, asserts picked_template + the industry payload landed in the
// draft, then restores the draft doc + Category rows byte-for-byte in
// `finally`. Screenshots land in SHOT_DIR (default /tmp/tpl-shots).
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

// Park the draft at the decider Shape (stage "types") with two authored types.
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
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/studio/onboarding/${QUIZ}?key=${KEY}`, {
      waitUntil: "domcontentloaded",
    });
  } catch (e) {
    throw new Error(mask(e.message));
  }
  await page.waitForSelector(".qz-shape-page", { timeout: 15000 });

  // Open "Other ways to start" — the starters live inside the details element.
  await page.locator(".qz-shape-other summary").click();
  await page.waitForSelector("[data-starter-rail]", { timeout: 5000 });

  const header = (await page.locator(".qz-shape-other-body").textContent()) ?? "";
  check(
    "starter section header + copy",
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
  check(
    "no shop-saved rail on a shop with no saved templates",
    (await page.locator(".qz-shape-savedrail:not([data-starter-rail])").count()) === 0,
  );
  await page.screenshot({ path: `${DIR}/starters-rail.png`, fullPage: true });

  // Pick the Gift finder starter → the decider use-saved-template branch writes
  // picked_template, then kicks the early question build (which fails fast here:
  // the server runs with ANTHROPIC_API_KEY= empty).
  await page
    .locator("[data-starter-rail] .qz-shape-savedpill", { hasText: "Gift finder" })
    .click();

  // picked_template lands in the draft (written BEFORE the build kick).
  let picked = null;
  let rich = null;
  for (let i = 0; i < 30; i++) {
    const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
    picked = row?.draftJson?.build_session?.picked_template ?? null;
    rich = (row?.draftJson?.build_session?.rich_templates ?? [])[0] ?? null;
    if (picked) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(
    "picked_template lands in the draft",
    picked?.template_id === "starter-gift-finder",
    JSON.stringify(picked?.template_id ?? null),
  );
  check(
    "the session's rich template carries the industry payload",
    rich?.industry?.category === "gifting" &&
      Array.isArray(rich?.industry?.questions) &&
      rich.industry.questions.length > 0,
  );
  check(
    "recommended_bucket_ids neutralized for this draft",
    Array.isArray(rich?.recommended_bucket_ids) && rich.recommended_bucket_ids.length === 0,
  );
  await page.screenshot({ path: `${DIR}/starter-picked-building.png` });

  // Wait for the detached build to SETTLE (no-key fail-fast → gen_error, stage
  // back to "types") so a late job write can't stomp the restore below.
  let settled = false;
  for (let i = 0; i < 45; i++) {
    const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
    const s = row?.draftJson?.build_session ?? {};
    if (s.gen_error || (s.stage && s.stage !== "templating")) {
      settled = true;
      check("detached build settled (gen_error / stage flip)", true, `stage=${s.stage}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!settled) check("detached build settled (gen_error / stage flip)", false, "still templating after 45s");
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
