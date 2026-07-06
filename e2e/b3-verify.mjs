// BIC-2 B3 + B2c/B2e live-verify — browser Back/Forward inside the quiz,
// lazy answer-image attributes, and next-step image preloads, against a LOCAL
// production build (BASE env, default http://localhost:3000).
//
// Fixture: quiz cmr7khgd50001vkhscvox8dgt (LOCAL DB). The probe snapshots the
// row, seeds a linear PUBLISHED points doc (intro → q1 image_tile ×3 imgs →
// q2 image_tile ×2 imgs → q3 single_select → result), walks it, and restores
// publishedJson/status/version byte-identically. draftJson is never touched.
//
// Asserts: intro→result walk · browser BACK re-opens the previous question
// (trail-jump semantics) · BACK chain reaches the intro · FORWARD re-enters
// the visited journey (trail pills restored) · back from the result re-opens
// the last question · quiz_started and quiz_completed each fire exactly once
// across all traversal · rapid back/forward spam leaves a coherent step ·
// mid-quiz refresh resumes · answer <img> carry loading=lazy decoding=async ·
// head preload links = the NEXT step's images (≤4), swapped per step, never
// duplicated, none re-added for already-seen steps · builder preview leaves
// the host history + head untouched · zero page errors (incl. React
// #418/#423/#425 hydration codes).
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/b3-shots";
mkdirSync(SHOTS, { recursive: true });

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
let failures = 0;
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  if (!v) failures++;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const IMG = (n) => `https://cdn.shopify.com/probe-b3/img-${n}.jpg`;

const probeDoc = {
  quiz_id: QUIZ,
  scope: { collection_ids: [] },
  nodes: [
    {
      id: "intro",
      type: "intro",
      position: { x: 0, y: 0 },
      data: { headline: "B3 probe quiz", button_label: "Start" },
    },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Pick a board style",
        question_type: "image_tile",
        answers: [
          { id: "a1", text: "Alpha", image_url: IMG(1), edge_handle_id: "h1" },
          { id: "a2", text: "Bravo", image_url: IMG(2), edge_handle_id: "h2" },
          { id: "a3", text: "Charlie", image_url: IMG(3), edge_handle_id: "h3" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "Pick a terrain",
        question_type: "image_tile",
        answers: [
          { id: "b1", text: "Park", image_url: IMG(4), edge_handle_id: "h4" },
          { id: "b2", text: "Powder", image_url: IMG(5), edge_handle_id: "h5" },
        ],
      },
    },
    {
      id: "q3",
      type: "question",
      position: { x: 3, y: 0 },
      data: {
        text: "Pick a stance",
        question_type: "single_select",
        answers: [
          { id: "c1", text: "Regular", edge_handle_id: "h6" },
          { id: "c2", text: "Goofy", edge_handle_id: "h7" },
        ],
      },
    },
    {
      id: "r1",
      type: "result",
      position: { x: 4, y: 0 },
      data: { headline: "Your match", fallback_collection_id: "gid://c/fb" },
    },
  ],
  edges: [
    { id: "e1", source: "intro", target: "q1" },
    { id: "e2", source: "q1", target: "q2" },
    { id: "e3", source: "q2", target: "q3" },
    { id: "e4", source: "q3", target: "r1" },
  ],
  product_index: [],
  shop_domain: "probe-b3.example.com",
};

// ── snapshot + seed ─────────────────────────────────────────────────────────
const original = await prisma.quiz.findUnique({
  where: { id: QUIZ },
  select: { publishedJson: true, status: true, version: true },
});
if (!original) {
  console.error("fixture quiz not found in the local DB");
  process.exit(1);
}
writeFileSync(`${SHOTS}/b3-${QUIZ}-backup.json`, JSON.stringify(original, null, 2));
console.log(
  `snapshot written (status=${original.status}, version=${original.version}, published=${!!original.publishedJson})`,
);

let seeded = false;
async function restore() {
  if (!seeded) return;
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: {
      publishedJson: original.publishedJson,
      status: original.status,
      version: original.version,
    },
  });
  seeded = false;
  console.log("fixture restored (publishedJson/status/version)");
}

await prisma.quiz.update({
  where: { id: QUIZ },
  data: { publishedJson: probeDoc, status: "published", version: 991 },
});
seeded = true;
const probeStart = new Date();
console.log("probe doc seeded as published (version 991)");

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e)));

  // Count analytics events from the DB — the runtime flushes with
  // fetch({keepalive:true}), which Playwright's request listener can't see.
  // Rows for this quiz created after `probeStart` belong to the probe and
  // are deleted during restore.
  const eventCount = async (type) =>
    prisma.event.count({
      where: { quizId: QUIZ, eventType: type, ts: { gte: probeStart } },
    });

  const preloadHrefs = () =>
    page
      .locator('head link[rel="preload"][as="image"]')
      .evaluateAll((ls) => ls.map((l) => l.href));
  const stepText = (t) => page.getByText(t, { exact: true }).first();
  const atStep = async (t, timeout = 8000) => {
    await stepText(t).waitFor({ state: "visible", timeout });
  };

  // ── 1. forward walk ───────────────────────────────────────────────────────
  await page.goto(`${BASE}/q/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await atStep("B3 probe quiz");
  ok("intro renders", true);

  // B2e: on the intro the NEXT step is q1 → its 3 answer images preloaded.
  await page.waitForTimeout(300);
  let pre = await preloadHrefs();
  ok(
    "intro: preload links = q1 images (3, ≤4 cap)",
    pre.length === 3 && [1, 2, 3].every((n) => pre.includes(IMG(n))),
    pre.join(","),
  );
  ok("intro: no duplicate preloads", new Set(pre).size === pre.length);

  await page.getByRole("button", { name: "Start" }).click();
  await atStep("Pick a board style");
  await page.screenshot({ path: `${SHOTS}/1-q1.png` });

  // B2c: answer images are lazy.
  const lazy = await page
    .locator(".qz-runtime-content img")
    .evaluateAll((imgs) =>
      imgs
        .filter((i) => i.src.includes("probe-b3"))
        .map((i) => ({ loading: i.loading, decoding: i.decoding })),
    );
  ok(
    "q1: answer imgs have loading=lazy decoding=async",
    lazy.length === 3 && lazy.every((l) => l.loading === "lazy" && l.decoding === "async"),
    JSON.stringify(lazy),
  );

  // B2e: preloads swapped to q2's images; q1's removed.
  await page.waitForTimeout(300);
  pre = await preloadHrefs();
  ok(
    "q1: preload links swapped to q2 images (2)",
    pre.length === 2 && [4, 5].every((n) => pre.includes(IMG(n))),
    pre.join(","),
  );

  await page.getByRole("button", { name: /Bravo/ }).click();
  await atStep("Pick a terrain");
  await page.waitForTimeout(300);
  pre = await preloadHrefs();
  ok("q2: next step has no images → zero preload links", pre.length === 0, pre.join(","));

  await page.getByRole("button", { name: /Park/ }).click();
  await atStep("Pick a stance");
  await page.getByRole("button", { name: /Regular/ }).click();
  await page.getByRole("button", { name: /start over/i }).waitFor({ timeout: 8000 });
  ok("walk reaches the result", true);
  await page.screenshot({ path: `${SHOTS}/2-result.png` });

  // ── 2. browser BACK from the result, then down to the intro ──────────────
  await page.goBack();
  await atStep("Pick a stance");
  ok("BACK from result re-opens the last question", true);

  await page.goBack();
  await atStep("Pick a terrain");
  ok("BACK again → previous question", true);

  await page.goBack();
  await atStep("Pick a board style");
  // Already-seen q2 images are never re-preloaded (session dedupe).
  await page.waitForTimeout(300);
  pre = await preloadHrefs();
  ok("revisited q1: no re-preload of already-seen images", pre.length === 0, pre.join(","));

  await page.goBack();
  await atStep("B3 probe quiz");
  ok("BACK chain reaches the intro", true);

  // ── 3. FORWARD re-enters the visited journey ──────────────────────────────
  await page.goForward();
  await atStep("Pick a board style");
  ok("FORWARD re-enters q1", true);

  await page.goForward();
  await atStep("Pick a terrain");
  const pills = await page
    .locator('[aria-label="Quiz progress"] button, [aria-label="Quiz progress"] span')
    .allTextContents();
  ok(
    "FORWARD to q2 restores the path (trail pill 1 back)",
    pills.some((p) => p.includes("Pick a board style")),
    pills.join(" | "),
  );

  await page.goForward();
  await atStep("Pick a stance");
  await page.goForward();
  await page.getByRole("button", { name: /start over/i }).waitFor({ timeout: 8000 });
  ok("FORWARD chain re-enters the result", true);

  // Analytics never double-fire across all this traversal. Wait out the
  // client's 5s flush interval before counting.
  await page.waitForTimeout(6000);
  const started = await eventCount("quiz_started");
  const completedN = await eventCount("quiz_completed");
  const answered = await eventCount("question_answered");
  ok("quiz_started fired exactly once", started === 1, `count=${started}`);
  ok("quiz_completed fired exactly once", completedN === 1, `count=${completedN}`);
  ok(
    "question_answered fired exactly 3 times (clicks only, no popstate refire)",
    answered === 3,
    `count=${answered}`,
  );

  // ── 4. rapid back/forward spam can't wedge the runtime ───────────────────
  for (let i = 0; i < 3; i++) {
    await page.goBack();
    await page.goForward();
  }
  await page.getByRole("button", { name: /start over/i }).waitFor({ timeout: 8000 });
  ok("rapid back/forward spam lands coherently on the result", true);

  // ── 5. mid-quiz refresh resumes with a sane history state ────────────────
  await page.goBack(); // q3
  await page.goBack(); // q2
  await atStep("Pick a terrain");
  await page.reload({ waitUntil: "domcontentloaded" });
  await atStep("Pick a terrain");
  ok("mid-quiz refresh resumes onto the same step", true);
  const histState = await page.evaluate(() => window.history.state?.qz ?? null);
  ok(
    "post-refresh history state mirrors the resumed position",
    histState?.n === "q2" && histState?.p === 1,
    JSON.stringify(histState),
  );
  // quiz_started is still 1 — resume suppressed the duplicate (5s flush wait).
  await page.waitForTimeout(6000);
  const startedAfterResume = await eventCount("quiz_started");
  ok(
    "resume did not re-fire quiz_started",
    startedAfterResume === 1,
    `count=${startedAfterResume}`,
  );

  await page.close();

  // ── 6. builder preview stays inert (history + head) ──────────────────────
  if (KEY) {
    const admin = await ctx.newPage();
    admin.on("pageerror", (e) => out.pageErrors.push(`[builder] ${e}`));
    await admin.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
    await admin.waitForTimeout(2500);
    const lenBefore = await admin.evaluate(() => window.history.length);
    const stateBefore = await admin.evaluate(() => JSON.stringify(window.history.state?.qz ?? null));
    // Switch the canvas to Interact mode so clicks NAVIGATE the preview
    // runtime (Edit mode intercepts them as inspect), then advance twice.
    await admin
      .getByRole("button", { name: "Interact" })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await admin.waitForTimeout(400);
    let advanced = false;
    for (let i = 0; i < 2; i++) {
      const btn = admin.locator(".qz-runtime-content button").first();
      if (await btn.count()) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        advanced = true;
      }
      await admin.waitForTimeout(500);
    }
    ok("builder preview: interacted (advanced the preview runtime)", advanced);
    const lenAfter = await admin.evaluate(() => window.history.length);
    const stateAfter = await admin.evaluate(() => JSON.stringify(window.history.state?.qz ?? null));
    ok(
      "builder preview: no qz state written to host history",
      stateBefore === stateAfter && stateAfter === "null",
      `${stateBefore} → ${stateAfter}`,
    );
    const adminPre = await admin
      .locator('head link[rel="preload"][as="image"]')
      .evaluateAll((ls) => ls.map((l) => l.href));
    ok(
      "builder preview: host history.length untouched",
      lenAfter === lenBefore,
      `${lenBefore} → ${lenAfter}`,
    );
    ok(
      "builder preview: no image preload links in the admin head",
      adminPre.length === 0,
      adminPre.join(","),
    );
    await admin.screenshot({ path: `${SHOTS}/3-builder.png` });
    await admin.close();
  } else {
    console.log("(!) STUDIO_ACCESS_TOKEN missing — builder-preview checks skipped");
  }

  // ── hydration / page errors ───────────────────────────────────────────────
  const hydration = out.pageErrors.filter((e) => /#4[12][0-9]|Minified React error/.test(e));
  ok("zero hydration errors (#418/#423/#425)", hydration.length === 0, hydration.join(" ; "));
  ok("zero page errors overall", out.pageErrors.length === 0, out.pageErrors.join(" ; "));
} finally {
  await browser.close();
  await restore();
  // Delete the probe's analytics/session residue (quiz-scoped, probe-window).
  const delEvents = await prisma.event.deleteMany({
    where: { quizId: QUIZ, ts: { gte: probeStart } },
  });
  const delSessions = await prisma.quizSession
    .deleteMany({ where: { quizId: QUIZ, startedAt: { gte: probeStart } } })
    .catch(() => ({ count: 0 }));
  console.log(`probe residue deleted: ${delEvents.count} events, ${delSessions.count} sessions`);
  // byte-identical restore proof
  const after = await prisma.quiz.findUnique({
    where: { id: QUIZ },
    select: { publishedJson: true, status: true, version: true },
  });
  const same =
    JSON.stringify(after.publishedJson) === JSON.stringify(original.publishedJson) &&
    after.status === original.status &&
    after.version === original.version;
  ok("fixture restored byte-identically", same);
  await prisma.$disconnect();
}

console.log(
  `\n${Object.values(out.checks).filter(Boolean).length}/${Object.keys(out.checks).length} checks passed`,
);
process.exit(failures === 0 ? 0 : 1);
