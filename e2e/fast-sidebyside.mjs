// FAST F4 — THE QUALITY GATE. Side-by-side Sonnet vs Haiku for the funnel's
// two MIDDLE AI passes (generateQuizTypes + generateQuizTemplates), called as
// DIRECT server functions (no route, nothing deployed) with the dev shop's
// REAL brand identity + a realistic bucket set from the live catalog grouping
// detection — the same inputs step2Build's loadStep2Context assembles.
//
// Run:  set -a; source .env; set +a; \
//       node_modules/.bin/vite-node --config vitest.config.ts e2e/fast-sidebyside.mjs
//
// Requires ANTHROPIC_API_KEY (real API spend: 2× types + 2× templates).
// Output: /tmp/fast-sidebyside/report.json + report.md (full verbatim outputs
// + durations) AND the full outputs on stdout for the gate review.
import { PrismaClient, Prisma } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateQuizTypes, generateQuizTemplates } from "../app/lib/claude";
import { parseBrandIdentitySafe } from "../app/lib/brandIdentity";
import { buildScopedIndex, scopeCatalogToChosen } from "../app/lib/catalogIndex";
import { detectGroupingDimension } from "../app/lib/groupingDetect";
import { parseWebResearchRecord } from "../app/lib/shopWebResearch.server";

const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5";
const OUT_DIR = "/tmp/fast-sidebyside";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing — source .env first. Gate NOT run.");
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

const prisma = new PrismaClient();

// ── assemble the REAL inputs (mirrors step2Build.loadStep2Context, no quizId) ─
const shops = await prisma.shop.findMany({
  select: { id: true, shopDomain: true, brandIdentity: true, webResearch: true },
});
let shop = null;
let productCount = 0;
for (const s of shops) {
  const n = await prisma.product.count({ where: { shopId: s.id } });
  // Prefer a shop with a parseable identity; otherwise take the biggest catalog.
  const better =
    n > productCount ||
    (shop && !parseBrandIdentitySafe(shop.brandIdentity) && parseBrandIdentitySafe(s.brandIdentity));
  if (!shop || better) {
    productCount = Math.max(n, productCount);
    shop = { ...s, productCount: n };
  }
}
if (!shop) {
  console.error("No shop found in the local DB.");
  process.exit(1);
}
productCount = shop.productCount;

// Local DB ≠ deploy DB: the local dev shop carries no brand identity. Seed a
// REALISTIC one grounded in the actual local catalog (Shopify snowboard dev
// store) for the duration of the probe, and RESTORE the original value after.
// The gate compares MODELS on identical inputs — both models see this same
// identity, so the comparison stays apples-to-apples.
let seededIdentity = false;
const originalBrandIdentity = shop.brandIdentity ?? null;
if (!parseBrandIdentitySafe(shop.brandIdentity)) {
  const identitySeed = {
    schema_version: 1,
    summary:
      "A premium snowboard brand for dedicated riders: full-size all-mountain and freestyle boards, plus wax and accessories. Positioned at the upper end of the market with a focus on build quality, board tech, and matching riders to the right deck for their terrain and skill level.",
    tags: ["premium", "winter sports", "performance"],
    descriptions: [
      "Premium all-mountain and freestyle snowboards",
      "Gear matched to rider skill and terrain",
      "Built for riders who take their setup seriously",
    ],
    pain_points: ["Too many specs to compare", "Unsure which board fits their skill level"],
    design: { aesthetic: ["bold", "technical"], imagery_density: "rich", formality: "balanced" },
    positioning: {
      industry: "Winter sports equipment",
      vertical: "snowboarding",
      target_demographic: ["riders 18-40", "gift buyers"],
      price_tier: "premium",
    },
    voice: {
      tone_description: "Confident, direct, a little playful — talks to riders like riders.",
      sample_phrases: ["Ride what fits.", "Your board should keep up with you."],
    },
    updated_at: new Date().toISOString(),
  };
  await prisma.shop.update({ where: { id: shop.id }, data: { brandIdentity: identitySeed } });
  shop.brandIdentity = identitySeed;
  seededIdentity = true;
  console.log("(seeded a probe brand identity — will restore after)");
}
console.log(`Dev shop: ${shop.shopDomain} (${productCount} products)`);

const [products, collections] = await Promise.all([
  prisma.product.findMany({ where: { shopId: shop.id } }),
  prisma.collection.findMany({ where: { shopId: shop.id } }),
]);
const scope = scopeCatalogToChosen(products, collections, new Set());
const indexed = buildScopedIndex(scope.products, scope.collections, []);
const identity = parseBrandIdentitySafe(shop.brandIdentity);
const brandSummary = identity?.summary ?? "";
const brandVoiceSample = identity?.voice
  ? [identity.voice.tone_description, ...(identity.voice.sample_phrases ?? [])]
      .filter(Boolean)
      .join(" · ")
  : undefined;
const positioning = {
  industry: identity?.positioning.industry ?? "",
  vertical: identity?.positioning.vertical ?? "",
  price_tier: identity?.positioning.price_tier ?? "",
  demographic: identity?.positioning.target_demographic ?? [],
};
const detect = detectGroupingDimension(
  products.map((p) => ({
    productId: p.productId,
    title: p.title,
    tags: p.tags,
    productType: p.productType,
    collectionIds: p.collectionIds,
  })),
  collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
);
const buckets = detect.proposed.slice(0, 5).map((g) => ({ name: g.name, tags: g.tags }));
const goal = "Help shoppers quickly find the right product for their needs and skill level.";
// Reuse any cached research so BOTH models see identical (realistic) context;
// "" degrades both identically — still apples-to-apples.
const webResearchText = parseWebResearchRecord(shop.webResearch)?.text ?? "";
console.log(
  `Buckets: ${buckets.map((b) => b.name).join(" · ")} | research context: ${webResearchText ? `${webResearchText.length} chars` : "(none)"}`,
);

async function timed(label, fn) {
  const t0 = Date.now();
  const value = await fn();
  const ms = Date.now() - t0;
  console.log(`⏱ ${label}: ${ms}ms`);
  return { value, ms };
}

const typesInput = {
  brandSummary,
  ...(brandVoiceSample ? { brandVoiceSample } : {}),
  positioning,
  goalPrompt: goal,
  buckets,
  catalogSummary: indexed.summary,
  webResearchText,
};

// ── pass 1: quiz TYPES, same inputs, both models ─────────────────────────────
const typesSonnet = await timed("generateQuizTypes[sonnet]", () =>
  generateQuizTypes({ ...typesInput, modelOverride: SONNET }),
);
const typesHaiku = await timed("generateQuizTypes[haiku]", () =>
  generateQuizTypes({ ...typesInput, modelOverride: HAIKU }),
);

// ── pass 2: TEMPLATES for the SAME chosen type (Sonnet's top card) ──────────
const chosenType = typesSonnet.value[0];
const templatesInput = {
  chosenType,
  brandSummary,
  ...(brandVoiceSample ? { brandVoiceSample } : {}),
  positioning: {
    industry: positioning.industry,
    vertical: positioning.vertical,
    price_tier: positioning.price_tier,
  },
  goalPrompt: goal,
  buckets: buckets.map((b, i) => ({ id: `bucket-${i + 1}`, name: b.name, tags: b.tags })),
  catalogSummary: indexed.summary,
};
const templatesSonnet = await timed("generateQuizTemplates[sonnet]", () =>
  generateQuizTemplates({ ...templatesInput, modelOverride: SONNET }),
);
const templatesHaiku = await timed("generateQuizTemplates[haiku]", () =>
  generateQuizTemplates({ ...templatesInput, modelOverride: HAIKU }),
);

// ── report ───────────────────────────────────────────────────────────────────
const report = {
  ranAt: new Date().toISOString(),
  shop: shop.shopDomain,
  productCount,
  buckets,
  goal,
  webResearchChars: webResearchText.length,
  chosenTypeForTemplates: chosenType,
  timingsMs: {
    types: { sonnet: typesSonnet.ms, haiku: typesHaiku.ms },
    templates: { sonnet: templatesSonnet.ms, haiku: templatesHaiku.ms },
  },
  types: { sonnet: typesSonnet.value, haiku: typesHaiku.value },
  templates: { sonnet: templatesSonnet.value, haiku: templatesHaiku.value },
};
writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));

const fmtType = (t) =>
  [
    `- **${t.name}** (${t.experience_type}, ${t.question_range.min}–${t.question_range.max} q)`,
    `  - achieves: ${t.achieves}`,
    t.best_practice_note ? `  - best practice: ${t.best_practice_note}` : null,
    t.rationale ? `  - rationale: ${t.rationale}` : null,
  ]
    .filter(Boolean)
    .join("\n");
const fmtTemplate = (t) =>
  [
    `- **${t.title}** (${t.experience_type}, ${t.question_count} q)`,
    `  - angle: ${t.angle}`,
    t.rationale ? `  - rationale: ${t.rationale}` : null,
    `  - features: ${t.feature_notes.join(" · ")}`,
    `  - dials: imagery=${t.dials.imagery} graphics=${t.dials.graphics} word_forward=${t.dials.word_forward} lines=${t.dials.lines}`,
    `  - rec: max_products=${t.rec_defaults.max_products} oos=${t.rec_defaults.oos_behavior}`,
    `  - sample questions: ${t.sample_questions.join(" / ")}`,
  ]
    .filter(Boolean)
    .join("\n");

const md = [
  `# FAST F4 side-by-side — ${report.ranAt}`,
  `Shop: ${shop.shopDomain} · ${productCount} products · buckets: ${buckets.map((b) => b.name).join(", ")}`,
  "",
  `## Timings`,
  `| pass | sonnet | haiku |`,
  `|---|---|---|`,
  `| types | ${typesSonnet.ms}ms | ${typesHaiku.ms}ms |`,
  `| templates | ${templatesSonnet.ms}ms | ${templatesHaiku.ms}ms |`,
  "",
  `## Quiz types — Sonnet (${SONNET})`,
  ...typesSonnet.value.map(fmtType),
  "",
  `## Quiz types — Haiku (${HAIKU})`,
  ...typesHaiku.value.map(fmtType),
  "",
  `## Templates for "${chosenType.name}" — Sonnet`,
  ...templatesSonnet.value.map(fmtTemplate),
  "",
  `## Templates for "${chosenType.name}" — Haiku`,
  ...templatesHaiku.value.map(fmtTemplate),
  "",
].join("\n");
writeFileSync(`${OUT_DIR}/report.md`, md);

console.log("\n" + md);
console.log(`\nWrote ${OUT_DIR}/report.json + report.md`);

// Restore the fixture exactly as found.
if (seededIdentity) {
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      brandIdentity:
        originalBrandIdentity === null ? Prisma.DbNull : originalBrandIdentity,
    },
  });
  console.log("(restored original brandIdentity)");
}
await prisma.$disconnect();
