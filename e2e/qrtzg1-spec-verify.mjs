// QRTZ-G1 probe — speculative question-gen prefetch (buckets-stage settle),
// LOCAL production build + LOCAL DB, fixture draft cmr7khgd50001vkhscvox8dgt
// (decider, parked at grouping). Seed/restore discipline: draft doc + name +
// buildState, Category rows, Shop.webResearch + brandIdentity, and the
// shop's AiUsage day-row are all snapshotted and restored in `finally`.
//
// Proves the QRTZ-G1 contract:
//   • SETTLE → the real buckets page (client effect, ~5s debounce) writes the
//     build_session.speculative marker — the visible stage NEVER leaves
//     "grouping" and the merchant-visible draft (nodes, name) is untouched.
//   • one-at-a-time / cache: a same-signature settle ping answers "cached";
//     a pool change supersedes (new signature, "started"); a failed
//     speculation tombstones its signature (silent — no gen_error) and is
//     never auto-retried; an over-budget ping is silently "skipped".
//   • CONTINUE:
//       fail mode  — a tombstoned/mismatched marker runs the normal path and
//                    clears the marker.
//       happy mode — a READY marker applies instantly: stage flips to
//                    question_builder with generated question nodes in ONE
//                    intent round-trip (asserted <8s — a real build takes
//                    ~75s+) and NO further AI calls (AiUsage delta 0).
//
// Two modes (run each against its own server):
//   PROBE_MODE=fail  — server started WITH A BLANK ANTHROPIC KEY ($0):
//       ANTHROPIC_API_KEY= SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x \
//         SHOPIFY_APP_URL=http://localhost:3457 PORT=3457 npm run start
//   PROBE_MODE=happy — server started WITH the real key (real AI spend: one
//     speculative types→templates→question-build chain, ~3 calls).
//
// Run:  set -a; source .env; set +a; BASE=http://localhost:3457 \
//       PROBE_MODE=fail node e2e/qrtzg1-spec-verify.mjs
import { chromium } from "playwright";
import { PrismaClient, Prisma } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const MODE = process.env.PROBE_MODE ?? "fail";
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const OUT = "/tmp/qrtzg1-verify";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient();
const out = { mode: MODE, checks: {}, timings: {} };
let failures = 0;
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  if (!v) failures++;
  console.log(`${v ? "✓" : "✗"} [${MODE}] ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found (local DB only)");
  process.exit(1);
}
const shopId = quiz.shopId;
const shopBefore = await prisma.shop.findUnique({
  where: { id: shopId },
  select: { webResearch: true, brandIdentity: true },
});
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
const usageBefore = await prisma.aiUsage.findUnique({
  where: { shopId_day: { shopId, day: today } },
});
writeFileSync(
  `${OUT}/backup.json`,
  JSON.stringify(
    { quiz: { name: quiz.name, buildState: quiz.buildState, draftJson: quiz.draftJson }, categories: originalCats, shop: shopBefore, usage: usageBefore },
    null,
    2,
  ),
);
console.log(`snapshot written (${originalCats.length} categories, usage row ${usageBefore ? "present" : "absent"})`);

let mutated = false;
async function restore() {
  if (!mutated) return;
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { name: quiz.name, buildState: quiz.buildState, draftJson: quiz.draftJson },
  });
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
  await restoreUsage();
  mutated = false;
  console.log("fixture restored (doc + name + categories + shop + AiUsage)");
}
async function restoreUsage() {
  if (usageBefore) {
    await prisma.aiUsage.update({
      where: { shopId_day: { shopId, day: today } },
      data: {
        inputTokens: usageBefore.inputTokens,
        outputTokens: usageBefore.outputTokens,
        calls: usageBefore.calls,
      },
    }).catch(() => {});
  } else {
    await prisma.aiUsage.deleteMany({ where: { shopId, day: today } }).catch(() => {});
  }
}

const readDraft = async () => {
  const q = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { name: true, draftJson: true } });
  return { name: q?.name, doc: q?.draftJson ?? {}, session: q?.draftJson?.build_session ?? {} };
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const funnelData = `${BASE}/studio/onboarding/${QUIZ}?_data=routes%2Fstudio_.onboarding_.%24quizId`;
const readFunnel = async () => {
  const r = await ctx.request.get(funnelData);
  if (!r.ok()) throw new Error(`funnel loader ${r.status()}`);
  return r.json();
};
const postIntent = async (form) => {
  const r = await ctx.request.post(funnelData, { form });
  return r.json();
};

try {
  mutated = true;

  // Seed: brand identity (deterministic derived goal + research positioning),
  // a clean grouping-stage draft, no categories yet.
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

  // ── 1. pick a pool via the real intents, then let the PAGE settle ─────────
  const fd0 = await readFunnel();
  ok("fixture at grouping stage", fd0.stage === "grouping", fd0.stage);
  const collections = fd0.catalog.collections.slice(0, 3);
  ok("catalog exposes ≥3 collections", collections.length === 3);
  for (const c of collections.slice(0, 2)) {
    const r = await postIntent({ intent: "toggle-bucket", type: "collection", key: c.key, on: "true" });
    if (!r.ok) throw new Error(`toggle-bucket failed for ${c.key}`);
  }

  // The REAL settle affordance: mount the buckets page with a non-empty pool
  // and simply wait out the debounce — the client effect must ping speculate.
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  const tSettle = Date.now();
  let spec = null;
  for (let i = 0; i < 20 && !spec; i++) {
    await sleep(1000);
    spec = (await readDraft()).session.speculative ?? null;
  }
  out.timings.settleToMarkerMs = Date.now() - tSettle;
  ok(
    "settle → speculative marker written by the page (no manual ping)",
    Boolean(spec) && /^v1-[0-9a-f]{16}$/.test(spec?.signature ?? ""),
    spec ? `${spec.status} ${spec.signature} in ${out.timings.settleToMarkerMs}ms` : "no marker",
  );
  const d1 = await readDraft();
  ok("stage untouched by speculation (still grouping)", d1.session.stage === "grouping", d1.session.stage);
  const sig1 = spec?.signature ?? "";
  // Node baseline AFTER the marker write: writeDoc's Quiz.parse round-trip
  // normalizes node JSON (schema defaults), so the honest "chain never
  // touched the nodes" compare starts from the first post-parse state.
  const baselineNodes = JSON.stringify(d1.doc.nodes ?? []);

  // ── 2. same-signature ping = cache hit, never a second job ────────────────
  const rSame = await postIntent({ intent: "speculate" });
  ok("same-signature ping answers cached (one at a time)", rSame.ok === true && rSame.spec === "cached", rSame.spec);

  if (MODE === "fail") {
    // ── 3. the chain fails ($0 key) → SILENT tombstone ──────────────────────
    let tomb = null;
    for (let i = 0; i < 60 && !tomb; i++) {
      await sleep(1000);
      const s = (await readDraft()).session;
      if (s.speculative?.status === "failed") tomb = s.speculative;
    }
    const dFail = await readDraft();
    ok("failed speculation tombstones its signature", tomb?.signature === sig1, tomb?.status);
    ok("failure is SILENT — no gen_error, stage still grouping",
      !dFail.session.gen_error && dFail.session.stage === "grouping",
      `gen_error=${dFail.session.gen_error ?? "none"}, stage=${dFail.session.stage}`);
    ok("draft nodes untouched by the failed chain", JSON.stringify(dFail.doc.nodes ?? []) === baselineNodes);
    ok("quiz name untouched by speculation", dFail.name === quiz.name, dFail.name);

    // ── 4. tombstone honored — same signature never re-runs ─────────────────
    const rTomb = await postIntent({ intent: "speculate" });
    ok("tombstoned signature never re-speculates", rTomb.spec === "cached", rTomb.spec);

    // ── 5. pool change SUPERSEDES (new signature starts) ────────────────────
    const c3 = collections[2];
    const rTog = await postIntent({ intent: "toggle-bucket", type: "collection", key: c3.key, on: "true" });
    if (!rTog.ok) throw new Error("toggle-bucket #3 failed");
    const rNew = await postIntent({ intent: "speculate" });
    const specNew = (await readDraft()).session.speculative;
    ok(
      "pool change supersedes — new signature, fresh start",
      rNew.spec === "started" && Boolean(specNew) && specNew.signature !== sig1,
      `${rNew.spec} ${specNew?.signature}`,
    );
    let tomb2 = null;
    for (let i = 0; i < 60 && !tomb2; i++) {
      await sleep(1000);
      const s = (await readDraft()).session;
      if (s.speculative?.status === "failed") tomb2 = s.speculative;
    }
    ok("superseding chain also settles to a tombstone", Boolean(tomb2));

    // ── 6. over-budget ping is silently skipped (same guard as every job) ───
    await prisma.aiUsage.upsert({
      where: { shopId_day: { shopId, day: today } },
      create: { shopId, day: today, inputTokens: 90_000_000, outputTokens: 9_000_000, calls: 1 },
      update: { inputTokens: 90_000_000, outputTokens: 9_000_000, calls: 1 },
    });
    const rTogOff = await postIntent({ intent: "toggle-bucket", type: "collection", key: c3.key, on: "false" });
    if (!rTogOff.ok) throw new Error("toggle-bucket off failed");
    const rBudget = await postIntent({ intent: "speculate" });
    const specAfterBudget = (await readDraft()).session.speculative;
    ok(
      "over-budget ping silently skipped — marker unchanged",
      rBudget.ok === true && rBudget.spec === "skipped" && specAfterBudget?.signature === tomb2?.signature,
      `${rBudget.spec}`,
    );
    await restoreUsage();

    // ── 7. Continue with a mismatched/failed marker = the NORMAL path ───────
    const rCont = await postIntent({ intent: "continue-buckets" });
    ok("continue-buckets accepted (fresh path)", rCont.ok === true);
    const dCont = await readDraft();
    ok("fresh Continue clears the marker", dCont.session.speculative === undefined);
    ok("fresh Continue left grouping (normal chain engaged)", dCont.session.stage !== "grouping", dCont.session.stage);
    // Zombie-write guard: the kicked normal chain fails detached ($0 key) and
    // lands blank-Questions AFTER this point — wait for it to settle so its
    // write can never race the `finally` restore (probe-discipline).
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const s = (await readDraft()).session;
      if (s.stage === "question_builder" || s.stage === "types") break;
    }
  } else {
    // ── 3. happy: the chain lands READY while the merchant "browses" ────────
    let ready = null;
    let stageDrift = null;
    const tChain = Date.now();
    for (let i = 0; i < 240 && !ready; i++) {
      await sleep(1500);
      const s = (await readDraft()).session;
      if (s.stage !== "grouping") stageDrift = s.stage;
      if (s.speculative?.status === "ready") ready = s.speculative;
      if (s.speculative?.status === "failed") break;
    }
    out.timings.speculativeChainMs = Date.now() - tChain;
    ok("speculative chain lands READY", Boolean(ready), `${out.timings.speculativeChainMs}ms`);
    ok("stage NEVER left grouping during speculation", stageDrift === null, stageDrift ?? "held");
    ok(
      "ready marker holds the full result (doc + picked template)",
      Boolean(ready?.doc) && Boolean(ready?.picked_template) && (ready?.doc?.nodes ?? []).some((n) => n.type === "question"),
      `${(ready?.doc?.nodes ?? []).filter((n) => n.type === "question").length} held questions`,
    );
    const dHeld = await readDraft();
    ok("draft nodes untouched while result is held", JSON.stringify(dHeld.doc.nodes ?? []) === baselineNodes);
    ok("quiz name untouched while result is held", dHeld.name === quiz.name, dHeld.name);

    // ── 4. Continue applies instantly — no second build ─────────────────────
    const usagePre = await prisma.aiUsage.findUnique({ where: { shopId_day: { shopId, day: today } } });
    const callsPre = usagePre?.calls ?? 0;
    const tCont = Date.now();
    const rCont = await postIntent({ intent: "continue-buckets" });
    out.timings.continueMs = Date.now() - tCont;
    const dApplied = await readDraft();
    const qNodes = (dApplied.doc.nodes ?? []).filter((n) => n.type === "question").length;
    ok("continue-buckets accepted", rCont.ok === true);
    ok(
      "questions present WITHOUT a second build (instant apply)",
      dApplied.session.stage === "question_builder" && dApplied.session.built === true && qNodes > 0,
      `stage=${dApplied.session.stage} built=${dApplied.session.built} questions=${qNodes} in ${out.timings.continueMs}ms`,
    );
    ok("apply was near-instant (<8s — a real build takes ~75s+)", out.timings.continueMs < 8000, `${out.timings.continueMs}ms`);
    ok("marker cleared on apply", dApplied.session.speculative === undefined);
    ok("gen bookkeeping clean (no gen_error / gen_progress)",
      !dApplied.session.gen_error && !("gen_progress" in dApplied.session));
    ok(
      "session carries the chain's artifacts (retry/Back parity with the normal chain)",
      (dApplied.session.quiz_types?.length ?? 0) >= 1 &&
        Boolean(dApplied.session.picked_type_id) &&
        Boolean(dApplied.session.picked_template) &&
        dApplied.session.ai_generate === true,
    );
    const fdApplied = await readFunnel();
    ok("loader serves the applied stage", fdApplied.stage === "question_builder", fdApplied.stage);

    await sleep(5000);
    const usagePost = await prisma.aiUsage.findUnique({ where: { shopId_day: { shopId, day: today } } });
    ok(
      "NO AI calls after Continue (the speculation already paid for them)",
      (usagePost?.calls ?? 0) === callsPre,
      `calls ${callsPre} → ${usagePost?.calls ?? 0}`,
    );
    ok(
      "speculative spend WAS recorded against the shop (budget accounting)",
      callsPre > (usageBefore?.calls ?? 0),
      `calls ${usageBefore?.calls ?? 0} → ${callsPre}`,
    );
  }
} catch (err) {
  failures++;
  console.error("PROBE ERROR:", err);
} finally {
  await restore();
  await browser.close();
  writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(out, null, 2));
  await prisma.$disconnect();
  const total = Object.keys(out.checks).length;
  const passed = Object.values(out.checks).filter(Boolean).length;
  console.log(`\n${passed}/${total} checks passed (${MODE} mode)`);
  process.exit(failures > 0 ? 1 : 0);
}
