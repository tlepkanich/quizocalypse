// FIX-3 probe — the merchant's Background color must be the visible page
// background on published MINIMAL-chrome docs (the default publish bake for
// decider docs since FIX-1). Pre-fix, .qz-runtime-page hard-coded #FAFAFA at
// 100vh (runtimeStyles.ts styles.page), sitting over the runtime root's
// var(--qz-color-bg) — the builder canvas strips that backdrop
// (quizocalypse.css QB-10 `background: transparent !important`) so the preview
// showed the merchant color while the published page showed near-white grey.
//
// Phase A (minimal): sets a distinctive cream colors.background (#FBF6EF) on
// the LOCAL fixture's draft, publishes through the REAL builder Publish
// button, then asserts getComputedStyle(.qz-runtime-page).backgroundColor is
// the cream — not rgb(250,250,250) — at 390×844 and 1280×800.
// Phase B (classic): republishes with design_tokens.chrome="classic" and
// asserts the page KEEPS #FAFAFA + dumps the runtime root's outerHTML and the
// page's full computed background to CLASSIC_OUT for a pre/post-fix byte diff
// (the classic-chrome regression lock).
//
// Server must run WITHOUT an Anthropic key so publish's AI passes degrade:
//   ANTHROPIC_API_KEY= SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x \
//     SHOPIFY_APP_URL=http://localhost:3100 PORT=3100 npm run start
//
// Restores draft doc + publish state (status/version/publishedJson +
// QuizVersion rows) byte-for-byte in `finally`.
//
// Run:  set -a; source .env; set +a; BASE=http://localhost:3100 node e2e/fix3-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const DIR = process.env.SHOT_DIR ?? "/tmp/fix3-shots";
const CLASSIC_OUT = process.env.CLASSIC_OUT ?? `${DIR}/classic-dom.json`;
const CREAM = "#FBF6EF"; // rgb(251, 246, 239)
const CREAM_RGB = "rgb(251, 246, 239)";
const GREY_RGB = "rgb(250, 250, 250)"; // #FAFAFA — the classic backdrop
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
const pubSnapshot = {
  status: quiz.status,
  version: quiz.version,
  hadPublished: quiz.publishedJson != null,
  publishedJson: quiz.publishedJson,
};
const originalVersionIds = (
  await prisma.quizVersion.findMany({ where: { quizId: QUIZ }, select: { id: true } })
).map((v) => v.id);
console.log(
  `snapshot taken (status=${quiz.status} v${quiz.version}, published=${pubSnapshot.hadPublished}, versions=${originalVersionIds.length})`,
);

// The computed-style evidence: body / root (the qz-bp-* container div) /
// .qz-runtime-page backgrounds, plus the root's --qz-color-bg var value.
const bgMetrics = () => {
  const page = document.querySelector(".qz-runtime-page");
  const root = page?.parentElement ?? null;
  return {
    body: getComputedStyle(document.body).backgroundColor,
    root: root ? getComputedStyle(root).backgroundColor : null,
    rootVar: root ? getComputedStyle(root).getPropertyValue("--qz-color-bg").trim() : null,
    page: page ? getComputedStyle(page).backgroundColor : null,
    pageMinHeight: page ? getComputedStyle(page).minHeight : null,
    pageRect: page
      ? (({ width, height }) => ({ w: Math.round(width), h: Math.round(height) }))(
          page.getBoundingClientRect(),
        )
      : null,
  };
};

const setDraft = async (mutate) => {
  const fresh = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  const doc = structuredClone(fresh.draftJson);
  mutate(doc);
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: doc } });
};

// One FRESH builder page per publish, closed afterwards — a builder tab left
// open across a direct prisma draft write can flush a stale autosave over it
// on navigation (useQuizDraft flushSave), silently undoing the seeded tokens.
const publishViaUi = async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 20000 });
  const publishBtn = page.locator("button", { hasText: /^(◆ )?Publish$/ }).first();
  await publishBtn.click();
  await page
    .locator(".qz-banner-ok", { hasText: "Published v" })
    .first()
    .waitFor({ timeout: 30000 });
  await page.close();
};

const measureQ = async (ctx, width, height, shot) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width, height });
  // Cache-buster: /q HTML ships Cache-Control max-age=60, so a re-measure
  // after a republish would otherwise serve the PREVIOUS publish from the
  // browser HTTP cache (the loader ignores unknown query params).
  await p.goto(`${BASE}/q/${QUIZ}?_cb=${Date.now()}`, { waitUntil: "networkidle" });
  await p.waitForSelector(".qz-runtime-page", { timeout: 15000 });
  await p.waitForTimeout(400);
  const metrics = await p.evaluate(bgMetrics);
  await p.screenshot({ path: `${DIR}/${shot}`, fullPage: false });
  const html = await p.evaluate(
    () => document.querySelector(".qz-runtime-page")?.parentElement?.outerHTML ?? "",
  );
  await p.close();
  return { metrics, html };
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

  // ── Phase A · minimal chrome (the decider default bake) ──────────────────
  await setDraft((doc) => {
    doc.design_tokens = doc.design_tokens ?? {};
    doc.design_tokens.colors = { ...(doc.design_tokens.colors ?? {}), background: CREAM };
    delete doc.design_tokens.chrome; // publish bakes "minimal" for decider docs
  });
  await publishViaUi(ctx);
  check("published via UI (minimal)", true);

  const mob = await measureQ(ctx, 390, 844, "1-minimal-mobile-390x844.png");
  console.log("MINIMAL mobile", JSON.stringify(mob.metrics, null, 2));
  const desk = await measureQ(ctx, 1280, 800, "2-minimal-desktop-1280x800.png");
  console.log("MINIMAL desktop", JSON.stringify(desk.metrics, null, 2));

  check(
    "minimal mobile: --qz-color-bg carries the merchant cream",
    mob.metrics.rootVar?.toUpperCase() === CREAM,
    `rootVar=${mob.metrics.rootVar}`,
  );
  check(
    "minimal mobile: .qz-runtime-page paints the merchant Background (not #FAFAFA)",
    mob.metrics.page === CREAM_RGB,
    `page=${mob.metrics.page}`,
  );
  check(
    "minimal desktop: .qz-runtime-page paints the merchant Background (not #FAFAFA)",
    desk.metrics.page === CREAM_RGB,
    `page=${desk.metrics.page}`,
  );

  // ── Phase B · classic chrome regression lock ─────────────────────────────
  await setDraft((doc) => {
    doc.design_tokens.chrome = "classic";
  });
  await publishViaUi(ctx);
  check("published via UI (classic)", true);

  const cls = await measureQ(ctx, 1280, 800, "3-classic-desktop-1280x800.png");
  console.log("CLASSIC desktop", JSON.stringify(cls.metrics, null, 2));
  check(
    "classic: .qz-runtime-page keeps the #FAFAFA backdrop (byte-identical chrome)",
    cls.metrics.page === GREY_RGB,
    `page=${cls.metrics.page}`,
  );
  writeFileSync(
    CLASSIC_OUT,
    JSON.stringify({ metrics: cls.metrics, html: cls.html }, null, 2),
  );
  console.log(`classic DOM + computed styles dumped to ${CLASSIC_OUT}`);
} finally {
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: {
      draftJson: quiz.draftJson,
      status: pubSnapshot.status,
      version: pubSnapshot.version,
      publishedJson: pubSnapshot.hadPublished ? pubSnapshot.publishedJson : Prisma.DbNull,
    },
  });
  await prisma.quizVersion.deleteMany({
    where: { quizId: QUIZ, id: { notIn: originalVersionIds.length ? originalVersionIds : ["-"] } },
  });
  await prisma.$disconnect();
  await browser.close();
  console.log("fixture restored (draft doc + publish state + versions)");
}

for (const line of results) console.log(line);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
