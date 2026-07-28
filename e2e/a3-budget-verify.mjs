// BIC-2 A3 budget-ceiling verify — LOCAL production build (BASE env).
// Fixtures: published legacy quiz cmpuov6yc0001vkk3rva5wad4 (rec-copy /
// why-copy / path-quality surfaces) + funnel draft cmr7khgd50001vkhscvox8dgt
// (decider, parked at grouping — the fast-verify fixture) for the gen-job kick.
//
// Asserts:
//   1. rec-copy over-limit  → cheap 200 {ok:false, code:"budget"} (never 5xx)
//   2. rec-copy under-limit → passes the budget gate to the next gate
//      (legacy published doc → "not_decider")
//   3. why-copy over-limit  → 402 {code:"ai_budget"} friendly copy
//   4. path-quality over-limit → 402 {code:"ai_budget"}
//   5. funnel gen kick (continue-buckets — the FLOW-2 headless chain)
//      over-limit → the blank-Questions landing with the limit copy (stage
//      "question_builder", never Shape), ZERO AiUsage delta (no AI spend)
//   6. ONE real cheap generation: under-limit shape-regenerate kick runs
//      research+types for real (single pass, terminal at "types") and the
//      AiUsage row increments with real token counts (recording proven
//      end-to-end). Set SKIP_REAL_GEN=1 to skip.
// Seed/restore: fixture draftJson, Shop.webResearch/brandIdentity, and every
// AiUsage row for the shop are restored/deleted at the end.
//
// Run:  set -a; source .env; set +a; BASE=http://localhost:3457 \
//       node e2e/a3-budget-verify.mjs
import { PrismaClient, Prisma } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3457";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const PUB = "cmpuov6yc0001vkk3rva5wad4"; // published legacy quiz (local DB)
const FUNNEL = "cmr7khgd50001vkhscvox8dgt"; // decider draft parked at grouping
// (The Shape-banner budget copy const retired with FLOW-2 — the over-limit
// decider kick now lands the blank-Questions limit notice, asserted inline.)

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}

const prisma = new PrismaClient();
const results = {};
let pass = 0;
let fail = 0;
const ok = (name, v, extra = "") => {
  results[name] = v;
  v ? pass++ : fail++;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = new Date().toISOString().slice(0, 10);

// ── snapshot ─────────────────────────────────────────────────────────────────
const funnelQuiz = await prisma.quiz.findUnique({ where: { id: FUNNEL } });
if (!funnelQuiz) {
  console.error("funnel fixture not found");
  process.exit(1);
}
const shopId = funnelQuiz.shopId;
const shopBefore = await prisma.shop.findUnique({
  where: { id: shopId },
  select: { webResearch: true, brandIdentity: true },
});
const usageBefore = await prisma.aiUsage.findMany({ where: { shopId } });

// continue-buckets requires confirmed Category rows; the parked fixture has
// none — seed two throwaway buckets from real products, delete on restore.
const someProducts = await prisma.product.findMany({
  where: { shopId },
  select: { productId: true, tags: true },
  take: 6,
});
const probeCatIds = [];
async function seedCategories() {
  for (const [i, group] of [someProducts.slice(0, 3), someProducts.slice(3, 6)].entries()) {
    const cat = await prisma.category.create({
      data: {
        shopId,
        quizId: FUNNEL,
        name: `A3 probe bucket ${i + 1}`,
        description: "",
        tags: [...new Set(group.flatMap((p) => p.tags))].slice(0, 5),
        productIds: group.map((p) => p.productId),
        source: "manual",
        discoveryRunId: "a3-probe",
      },
    });
    probeCatIds.push(cat.id);
  }
}

async function restore() {
  if (probeCatIds.length) {
    await prisma.category.deleteMany({ where: { id: { in: probeCatIds } } });
  }
  await prisma.quiz.update({
    where: { id: FUNNEL },
    data: { draftJson: funnelQuiz.draftJson },
  });
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      webResearch:
        shopBefore.webResearch === null ? Prisma.DbNull : shopBefore.webResearch,
      brandIdentity:
        shopBefore.brandIdentity === null ? Prisma.DbNull : shopBefore.brandIdentity,
    },
  });
  await prisma.aiUsage.deleteMany({ where: { shopId } });
  for (const row of usageBefore) {
    await prisma.aiUsage.create({ data: row });
  }
  console.log("restored: draft, shop research/identity, AiUsage rows");
}

const seedOverLimit = () =>
  prisma.aiUsage.upsert({
    where: { shopId_day: { shopId, day } },
    // 1M output tokens ≈ $15 — over both the $2 runtime and $10 merchant defaults.
    create: { shopId, day, inputTokens: 0, outputTokens: 1_000_000, calls: 1 },
    update: { inputTokens: 0, outputTokens: 1_000_000, calls: 1 },
  });
const clearUsage = () => prisma.aiUsage.deleteMany({ where: { shopId } });

// ── studio auth: ?key= → cookie ──────────────────────────────────────────────
const authRes = await fetch(`${BASE}/studio?key=${encodeURIComponent(KEY)}`, {
  redirect: "manual",
});
const setCookie = authRes.headers.get("set-cookie") ?? "";
const cookie = setCookie.split(";")[0];
ok("studio auth cookie obtained", authRes.status === 302 && cookie.length > 0);

const recCopy = () =>
  fetch(`${BASE}/q/${PUB}/rec-copy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "a3probe12345", answerIds: [] }),
  });
const apiPost = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
const funnelIntent = (fields) =>
  fetch(`${BASE}/studio/onboarding/${FUNNEL}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
const readSession = async () => {
  const q = await prisma.quiz.findUnique({
    where: { id: FUNNEL },
    select: { draftJson: true },
  });
  return q?.draftJson?.build_session ?? {};
};

try {
  // ── 1/2: rec-copy (public) ─────────────────────────────────────────────────
  await seedOverLimit();
  const over = await recCopy();
  const overBody = await over.json();
  ok(
    "rec-copy over-limit → 200 {ok:false, code:'budget'}",
    over.status === 200 && overBody.ok === false && overBody.code === "budget",
    JSON.stringify(overBody),
  );

  await clearUsage();
  const under = await recCopy();
  const underBody = await under.json();
  ok(
    "rec-copy under-limit → passes budget gate (next gate: not_decider)",
    underBody.code === "not_decider",
    JSON.stringify(underBody),
  );

  // ── 3/4: merchant endpoints ────────────────────────────────────────────────
  await seedOverLimit();
  const why = await apiPost("/api/generate-why-copy", { quizId: PUB });
  const whyBody = await why.json();
  ok(
    "why-copy over-limit → 402 ai_budget + friendly copy",
    why.status === 402 &&
      whyBody.code === "ai_budget" &&
      /try again tomorrow/.test(whyBody.error ?? ""),
    JSON.stringify(whyBody),
  );

  const pq = await apiPost("/api/path-quality", { quizId: PUB });
  const pqBody = await pq.json();
  ok(
    "path-quality over-limit → 402 ai_budget",
    pq.status === 402 && pqBody.code === "ai_budget",
    JSON.stringify(pqBody),
  );

  // ── 5: funnel typing kick over-limit ───────────────────────────────────────
  // FLOW-2 (funnel-reconfig Phase 3) — continue-buckets on a decider draft
  // runs the HEADLESS chain: a budget refusal lands the blank-Questions notice
  // (limit-copy variant), never the Shape gen_error banner.
  await seedCategories();
  const usageSeeded = await prisma.aiUsage.findUnique({
    where: { shopId_day: { shopId, day } },
  });
  const kick = await funnelIntent({ intent: "continue-buckets" });
  ok("continue-buckets accepted", kick.status < 400, `status ${kick.status}`);
  let session = {};
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    session = await readSession();
    if (session.gen_error) break;
  }
  ok(
    "over-limit kick → blank-Questions landing with the budget copy",
    /AI generation limit for this shop is reached/.test(session.gen_error ?? "") &&
      /blank/i.test(session.gen_error ?? ""),
    JSON.stringify({ stage: session.stage, gen_error: session.gen_error }),
  );
  ok(
    "over-limit kick → lands on Questions (stage 'question_builder', never Shape)",
    session.stage === "question_builder" && session.built === true,
  );
  const usageAfterRefusal = await prisma.aiUsage.findUnique({
    where: { shopId_day: { shopId, day } },
  });
  ok(
    "refused kick spent NOTHING (AiUsage row unchanged)",
    usageAfterRefusal.inputTokens === usageSeeded.inputTokens &&
      usageAfterRefusal.outputTokens === usageSeeded.outputTokens &&
      usageAfterRefusal.calls === usageSeeded.calls,
  );

  // ── 6: ONE real cheap generation (recording end-to-end) ───────────────────
  // FLOW-2 — continue-buckets would now run the FULL headless chain (types +
  // templates + question build ≈ 3 calls); keep this a single cheap typing
  // pass by kicking shape-regenerate instead (same startStep2Types recording
  // scope, non-headless → terminal at stage "types").
  if (process.env.SKIP_REAL_GEN === "1") {
    console.log("· SKIP_REAL_GEN=1 — skipping the real typing-kick generation");
  } else {
    // Reset the draft to the grouping snapshot (+ a goal for the regenerate)
    // and clear usage (under limit).
    await prisma.quiz.update({
      where: { id: FUNNEL },
      data: {
        draftJson: {
          ...funnelQuiz.draftJson,
          build_session: {
            ...(funnelQuiz.draftJson?.build_session ?? {}),
            goal: {
              goal_text: "Help shoppers find the right product for how they ride",
              struggle_text: "",
            },
          },
        },
      },
    });
    await clearUsage();
    const t0 = Date.now();
    const realKick = await funnelIntent({ intent: "shape-regenerate" });
    ok("real kick accepted", realKick.status < 400, `status ${realKick.status}`);
    let realSession = {};
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      realSession = await readSession();
      if (realSession.stage === "types" || realSession.gen_error) break;
    }
    ok(
      "real kick completed (stage 'types', no gen_error)",
      realSession.stage === "types" && !realSession.gen_error,
      `${Math.round((Date.now() - t0) / 1000)}s, gen_error=${realSession.gen_error ?? "none"}`,
    );
    const recorded = await prisma.aiUsage.findUnique({
      where: { shopId_day: { shopId, day } },
    });
    ok(
      "AiUsage row incremented with REAL token counts",
      !!recorded &&
        recorded.inputTokens > 0 &&
        recorded.outputTokens > 0 &&
        recorded.calls >= 1,
      recorded
        ? `in=${recorded.inputTokens} out=${recorded.outputTokens} calls=${recorded.calls}`
        : "no row",
    );
  }
} finally {
  await restore();
  await prisma.$disconnect();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
