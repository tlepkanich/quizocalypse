// FAST program funnel-walk verify — LOCAL production build (BASE env), fixture
// draft cmr7khgd50001vkhscvox8dgt (decider, parked at grouping).
//
// Walks the REAL funnel affordances end-to-end and asserts the FAST behaviors:
//   1. At the grouping stage, the loader fires the web-research prefetch —
//      Shop.webResearch appears while the draft is STILL at grouping.
//   2. continue-buckets → "typing": gen_progress transitions are observable
//      via the polled loader and the cached research SKIPS the "research"
//      checkpoint (straight to "types"); stage flips to "types".
//   3. shape-continue → "templating": gen_progress "templates" → "questions",
//      then stage "question_builder"; gen_progress is CLEARED on the flip.
//   4. retry-gen from a (simulated) stalled typing stage REUSES the cached
//      research — no second Shop.webResearch write (same `at`).
// Timings are logged (informational). Seed/restore discipline: draft doc,
// Category rows, Shop.webResearch and Shop.brandIdentity all restored.
//
// Run:  set -a; source .env; set +a; BASE=http://localhost:3457 \
//       node e2e/fast-verify.mjs
import { chromium } from "playwright";
import { PrismaClient, Prisma } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const OUT = "/tmp/fast-verify";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient();
const out = { checks: {}, timings: {}, progressSeen: { typing: [], templating: [], retry: [] } };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const shopId = quiz.shopId;
const shopBefore = await prisma.shop.findUnique({
  where: { id: shopId },
  select: { webResearch: true, brandIdentity: true },
});
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(
  `${OUT}/backup.json`,
  JSON.stringify({ draftJson: quiz.draftJson, categories: originalCats, shop: shopBefore }, null, 2),
);
console.log(
  `snapshot written (stage=${quiz.draftJson?.build_session?.stage ?? "?"}, ${originalCats.length} categories)`,
);

let mutated = false;
async function restore() {
  if (!mutated) return;
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId: sid, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId: sid, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      webResearch: shopBefore.webResearch === null ? Prisma.DbNull : shopBefore.webResearch,
      brandIdentity: shopBefore.brandIdentity === null ? Prisma.DbNull : shopBefore.brandIdentity,
    },
  });
  mutated = false;
  console.log("fixture restored (doc + categories + shop.webResearch + shop.brandIdentity)");
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const funnelData = `${BASE}/studio/onboarding/${QUIZ}?_data=routes%2Fstudio_.onboarding_.%24quizId`;
const readFunnel = async () => {
  const r = await ctx.request.get(funnelData);
  if (!r.ok()) throw new Error(`funnel loader ${r.status()}`);
  return r.json();
};
const postIntent = (form) => ctx.request.post(funnelData, { form });

try {
  mutated = true;

  // Seed a realistic brand identity (local dev shop has none) + clear the
  // research cache so the prefetch write is observable. Reset the draft to a
  // clean grouping stage with no leftover session artifacts.
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      webResearch: Prisma.DbNull,
      brandIdentity: {
        schema_version: 1,
        summary:
          "A premium snowboard brand for dedicated riders: all-mountain and freestyle boards plus wax and accessories, focused on matching riders to the right deck.",
        design: {},
        positioning: {
          industry: "Winter sports equipment",
          vertical: "snowboarding",
          target_demographic: ["riders 18-40", "gift buyers"],
          price_tier: "premium",
        },
        updated_at: new Date().toISOString(),
      },
    },
  });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: {
      buildState: "step1",
      draftJson: { ...quiz.draftJson, build_session: { stage: "grouping" } },
    },
  });

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

  // ── 1. grouping loader fires the research prefetch ─────────────────────────
  const fd0 = await readFunnel();
  ok("fixture at grouping stage", fd0.stage === "grouping", fd0.stage);
  ok("loader exposes genProgress (null at grouping)", fd0.genProgress === null);

  const tPrefetch = Date.now();
  let researchRow = null;
  for (let i = 0; i < 60 && !researchRow; i++) {
    await sleep(2500);
    const s = await prisma.shop.findUnique({ where: { id: shopId }, select: { webResearch: true } });
    if (s?.webResearch && typeof s.webResearch === "object" && s.webResearch.text) {
      researchRow = s.webResearch;
    }
  }
  out.timings.prefetchResearchMs = Date.now() - tPrefetch;
  const fdStill = await readFunnel();
  ok(
    "Shop.webResearch appears while still at grouping (prefetch fired)",
    Boolean(researchRow) && fdStill.stage === "grouping",
    researchRow ? `${researchRow.text.length} chars in ${out.timings.prefetchResearchMs}ms` : "no row",
  );
  const researchAt1 = researchRow?.at ?? null;

  // ── 2. pick buckets via the REAL affordance, then continue-buckets ─────────
  const collections = fd0.catalog.collections.slice(0, 2);
  ok("catalog exposes ≥2 collections for buckets", collections.length === 2);
  for (const c of collections) {
    const r = await postIntent({ intent: "toggle-bucket", type: "collection", key: c.key, on: "true" });
    if (!(await r.json()).ok) throw new Error(`toggle-bucket failed for ${c.key}`);
  }
  const rCont = await postIntent({ intent: "continue-buckets" });
  ok("continue-buckets accepted", (await rCont.json()).ok === true);

  // typing: poll the loader like the UI does; record gen_progress transitions.
  const tTyping = Date.now();
  let fd = await readFunnel();
  while (fd.stage === "typing" && Date.now() - tTyping < 180_000) {
    if (fd.genProgress && out.progressSeen.typing.at(-1) !== fd.genProgress) {
      out.progressSeen.typing.push(fd.genProgress);
    }
    await sleep(1500);
    fd = await readFunnel();
  }
  out.timings.typingMs = Date.now() - tTyping;
  ok("typing → types", fd.stage === "types", `${out.timings.typingMs}ms, progress=[${out.progressSeen.typing}]`);
  ok(
    "cached research SKIPS the research checkpoint",
    !out.progressSeen.typing.includes("research"),
    `saw [${out.progressSeen.typing}]`,
  );
  ok("types checkpoint observed", out.progressSeen.typing.includes("types"), `saw [${out.progressSeen.typing}]`);
  const researchAfterTyping = (
    await prisma.shop.findUnique({ where: { id: shopId }, select: { webResearch: true } })
  )?.webResearch;
  ok(
    "typing job reused the cached research (no rewrite)",
    researchAfterTyping?.at === researchAt1,
    `at=${researchAfterTyping?.at}`,
  );

  // ── 3. shape-continue → templating → question_builder ──────────────────────
  const typeId = fd.quizTypes?.[0]?.id;
  ok("types arrived (≥2 cards)", (fd.quizTypes?.length ?? 0) >= 2, `${fd.quizTypes?.length} cards`);
  const rShape = await postIntent({ intent: "shape-continue", typeId, scoring: "direct" });
  ok("shape-continue accepted", (await rShape.json()).ok === true);

  const tTempl = Date.now();
  fd = await readFunnel();
  while (fd.stage === "templating" && Date.now() - tTempl < 300_000) {
    if (fd.genProgress && out.progressSeen.templating.at(-1) !== fd.genProgress) {
      out.progressSeen.templating.push(fd.genProgress);
    }
    await sleep(1500);
    fd = await readFunnel();
  }
  out.timings.templatingMs = Date.now() - tTempl;
  ok(
    "templating → question_builder",
    fd.stage === "question_builder",
    `${out.timings.templatingMs}ms, progress=[${out.progressSeen.templating}]`,
  );
  ok(
    "templates→questions checkpoints observed",
    out.progressSeen.templating.includes("templates") && out.progressSeen.templating.includes("questions"),
    `saw [${out.progressSeen.templating}]`,
  );
  ok("gen_progress cleared on the stage flip", fd.genProgress === null);
  const builtDoc = (await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } }))?.draftJson;
  ok(
    "gen_progress key ABSENT in the persisted session (round-trips absent)",
    !("gen_progress" in (builtDoc?.build_session ?? {})),
  );
  ok(
    "built draft is a valid decider doc with question nodes",
    builtDoc?.logic_model === "decider" &&
      (builtDoc?.nodes ?? []).some((n) => n.type === "question"),
    `${(builtDoc?.nodes ?? []).filter((n) => n.type === "question").length} questions`,
  );

  // ── 4. retry-gen after a simulated typing stall reuses the cache ───────────
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: {
      draftJson: {
        ...builtDoc,
        build_session: { ...builtDoc.build_session, stage: "typing" },
      },
    },
  });
  const rRetry = await postIntent({ intent: "retry-gen" });
  ok("retry-gen accepted", (await rRetry.json()).ok === true);
  const tRetry = Date.now();
  fd = await readFunnel();
  while (fd.stage === "typing" && Date.now() - tRetry < 120_000) {
    if (fd.genProgress && out.progressSeen.retry.at(-1) !== fd.genProgress) {
      out.progressSeen.retry.push(fd.genProgress);
    }
    await sleep(1500);
    fd = await readFunnel();
  }
  out.timings.retryTypingMs = Date.now() - tRetry;
  ok("retry-gen re-ran typing → types", fd.stage === "types", `${out.timings.retryTypingMs}ms`);
  const researchAfterRetry = (
    await prisma.shop.findUnique({ where: { id: shopId }, select: { webResearch: true } })
  )?.webResearch;
  ok(
    "retry reused cached research — NO second Shop.webResearch write",
    researchAfterRetry?.at === researchAt1,
    `at unchanged (${out.timings.retryTypingMs}ms ≈ types-only, no 40s research)`,
  );
  ok(
    "retry skipped the research checkpoint too",
    !out.progressSeen.retry.includes("research"),
    `saw [${out.progressSeen.retry}]`,
  );
} catch (err) {
  ok("probe ran to completion", false, String(err).slice(0, 300));
} finally {
  await restore();
  await browser.close();
  await prisma.$disconnect();
  writeFileSync(`${OUT}/result.json`, JSON.stringify(out, null, 2));
  const fails = Object.entries(out.checks).filter(([, v]) => !v);
  console.log(`\ntimings: ${JSON.stringify(out.timings)}`);
  console.log(fails.length ? `FAIL (${fails.length})` : "ALL CHECKS PASSED");
  process.exit(fails.length ? 1 : 0);
}
