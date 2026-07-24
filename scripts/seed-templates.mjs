// PORT-10 — seed the 8 global industry "starter" templates.
//
// Reads the single source of truth (docs/design/strategy/quiz-templates/
// *.template.json — checked into the repo and shipped in the deploy image),
// converts each to a RichTemplateOption payload (the industry metadata stored
// faithfully under `industry`), and UPSERTS a shopId=NULL SavedTemplate row
// keyed by the stable slug `starter-<template id>`. Idempotent: re-runs update
// the same rows in place (no duplicates, ids/createdAt preserved).
//
// Run locally:      set -a; source .env; set +a; node scripts/seed-templates.mjs
// Run on deploy:    fly ssh console -a quizocalypse-studio -C "node /app/scripts/seed-templates.mjs"
//                   (DATABASE_URL is already in the machine env; owner/CI runs
//                   this once after `migrate deploy` picks up
//                   20260724120000_global_saved_templates)
//
// Conversion is exported (industryTemplateToRich / loadIndustryTemplates) so
// app/lib/industryTemplates.test.ts can zod-validate every generated payload
// without touching a DB.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "design",
  "strategy",
  "quiz-templates",
);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// result_shape → a sensible default products-per-result (merchant-tunable).
const MAX_PRODUCTS_BY_SHAPE = {
  single_bespoke_output: 2,
  ranked_shortlist: 4,
  profile_plus_first_box: 3,
};

const GATE_LABEL = {
  at_result: "Email at the result reveal",
  before_results: "Email just before results",
  deferred_to_action: "No gate — email deferred to action",
  mid_flow: "Account created mid-flow",
  front: "Email up front",
};

// One *.template.json → a RichTemplateOption payload. The battle-card fields
// (dials, rec_defaults, question_count) get conservative defaults the merchant
// can tune; the FULL template rides along faithfully under `industry` (§I2 v1:
// maps_to keyword bindings stored, consumed as prompt guidance only).
export function industryTemplateToRich(tpl) {
  const featureNotes = [
    `${tpl.length.min}–${tpl.length.max} questions (${tpl.length.band})`,
    `Result: ${String(tpl.result_shape).replaceAll("_", " ")}`,
  ];
  const gateLabel = GATE_LABEL[tpl.gate?.placement];
  if (gateLabel) featureNotes.push(gateLabel);
  return {
    id: `starter-${tpl.id}`,
    experience_type: "product_match",
    title: tpl.name,
    angle: tpl.use_when ?? tpl.name,
    rationale: tpl.gate?.rationale ?? "",
    sample_questions: tpl.questions.slice(0, 3).map((q) => q.prompt),
    feature_notes: featureNotes.slice(0, 3),
    dials: { imagery: "medium", graphics: "medium", word_forward: "medium", lines: "rounded" },
    rec_defaults: {
      max_products: MAX_PRODUCTS_BY_SHAPE[tpl.result_shape] ?? 3,
      oos_behavior: "show_with_badge",
      fallback_collection_id: "",
    },
    recommended_bucket_ids: [],
    // The band MIN is the build's target count (conservative; the merchant can
    // widen). RichTemplateOption admits 3–40.
    question_count: clamp(tpl.length.min, 3, 40),
    industry: {
      category: tpl.category,
      ...(tpl.variant ? { variant: tpl.variant } : {}),
      ...(tpl.use_when ? { use_when: tpl.use_when } : {}),
      length: tpl.length,
      gate: tpl.gate,
      result_shape: tpl.result_shape,
      arc: tpl.arc,
      branching: tpl.branching,
      questions: tpl.questions,
      recommendation: {
        architecture: tpl.recommendation.architecture,
        tie_break: tpl.recommendation.tie_break,
        empty_fallback: tpl.recommendation.empty_fallback,
      },
      ...(tpl.personalization_hooks ? { personalization_hooks: tpl.personalization_hooks } : {}),
      ...(tpl.sources ? { sources: tpl.sources } : {}),
    },
  };
}

// Read + convert every checked-in template. Sorted by filename for stable runs.
export function loadIndustryTemplates(dir = TEMPLATE_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".template.json"))
    .sort();
  return files.map((f) => {
    const tpl = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const payload = industryTemplateToRich(tpl);
    return { slug: payload.id, name: tpl.name, payload, file: f };
  });
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const templates = loadIndustryTemplates();
    if (templates.length === 0) throw new Error(`no templates found in ${TEMPLATE_DIR}`);
    for (const t of templates) {
      const row = await prisma.savedTemplate.upsert({
        where: { slug: t.slug },
        update: { name: t.name, payload: t.payload },
        create: { slug: t.slug, name: t.name, payload: t.payload, shopId: null },
        select: { id: true, slug: true },
      });
      console.log(`upserted ${row.slug} (${row.id})`);
    }
    const globalCount = await prisma.savedTemplate.count({ where: { shopId: null } });
    console.log(`done — ${templates.length} templates seeded, ${globalCount} global rows total`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run against the DB when executed directly (the vitest import stays pure).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
