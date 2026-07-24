// FIX-1 probe — preview↔publish padding/framing parity on the REAL published
// output. Publishes the LOCAL fixture cmr7khgd50001vkhscvox8dgt through the
// builder UI's Publish button, then screenshots + measures /q at 390×844 and
// 1280×800, and compares against the builder preview's assumptions
// (BLD-1 Global panel / All-screens cards: 24px default content padding).
//
// Server must run WITHOUT an Anthropic key so publish's AI passes degrade
// instead of spending tokens:
//   ANTHROPIC_API_KEY= SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x \
//     SHOPIFY_APP_URL=http://localhost:3100 PORT=3100 npm run start
//
// Restores draft doc + publish state (status/version/publishedJson +
// QuizVersion rows) byte-for-byte in `finally`.
//
// Run:  set -a; source .env; set +a; BASE=http://localhost:3100 node e2e/fix1-verify.mjs
import { chromium } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const DIR = process.env.SHOT_DIR ?? "/tmp/fix1-shots";
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

const pageMetrics = () => {
  const page = document.querySelector(".qz-runtime-page");
  const card = page?.querySelector(".qz-runtime-content > *") ?? null;
  const shell = page?.querySelector(".qz-runtime-shell") ?? null;
  const cs = page ? getComputedStyle(page) : null;
  const cardRect = card?.getBoundingClientRect() ?? null;
  return {
    rootClass: document.querySelector("[class*='qz-bp-'],.qz-unmeasured")?.className ?? "",
    padding: cs ? { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft } : null,
    minHeight: cs?.minHeight ?? null,
    justify: cs?.justifyContent ?? null,
    align: cs?.alignItems ?? null,
    shellWidth: shell ? shell.getBoundingClientRect().width : null,
    card: cardRect ? { w: Math.round(cardRect.width), top: Math.round(cardRect.top), left: Math.round(cardRect.left) } : null,
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight,
  };
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // ── 1 · Publish through the real builder UI ───────────────────────────────
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 20000 });
  await page.screenshot({ path: `${DIR}/0-builder-before-publish.png`, fullPage: false });
  const publishBtn = page.locator("button", { hasText: /^(◆ )?Publish$/ }).first();
  check("builder: Publish clickable", (await publishBtn.count()) === 1 && (await publishBtn.isEnabled()));
  await publishBtn.click();
  await page
    .locator(".qz-banner-ok", { hasText: "Published v" })
    .first()
    .waitFor({ timeout: 30000 });
  check("published via UI", true);

  // ── 2 · /q at phone size (390×844 — the SPEC's logical viewport) ─────────
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(`${BASE}/q/${QUIZ}`, { waitUntil: "networkidle" });
  await mob.waitForSelector(".qz-runtime-page", { timeout: 15000 });
  await mob.waitForTimeout(400);
  const mobMetrics = await mob.evaluate(pageMetrics);
  console.log("MOBILE metrics", JSON.stringify(mobMetrics, null, 2));
  await mob.screenshot({ path: `${DIR}/1-q-mobile-390x844.png`, fullPage: true });
  check(
    "mobile /q: 24px padding (matches builder preview default)",
    mobMetrics.padding?.top === "24px" &&
      mobMetrics.padding?.right === "24px" &&
      mobMetrics.padding?.bottom === "24px" &&
      mobMetrics.padding?.left === "24px",
    JSON.stringify(mobMetrics.padding),
  );

  // ── 3 · /q at desktop size (1280×800) ────────────────────────────────────
  const desk = await ctx.newPage();
  await desk.setViewportSize({ width: 1280, height: 800 });
  await desk.goto(`${BASE}/q/${QUIZ}`, { waitUntil: "networkidle" });
  await desk.waitForSelector(".qz-runtime-page", { timeout: 15000 });
  await desk.waitForTimeout(400);
  const deskMetrics = await desk.evaluate(pageMetrics);
  console.log("DESKTOP metrics", JSON.stringify(deskMetrics, null, 2));
  await desk.screenshot({ path: `${DIR}/2-q-desktop-1280x800.png`, fullPage: true });
  // DESKTOP-SPEC §1/§6: content is a centered column, section padding 48px
  // desktop, never edge-to-edge; the runtime + builder must agree on the default.
  check(
    "desktop /q: padding-top matches the preview↔publish agreed default (48px)",
    deskMetrics.padding?.top === "48px",
    JSON.stringify(deskMetrics.padding),
  );
  check(
    "desktop /q: content is horizontally centered (not stranded left)",
    deskMetrics.card != null &&
      Math.abs(deskMetrics.card.left + deskMetrics.card.w / 2 - 640) < 60,
    JSON.stringify(deskMetrics.card),
  );
  check(
    "desktop /q: no huge whitespace (body ≈ viewport for a one-question screen)",
    deskMetrics.bodyScrollHeight <= deskMetrics.innerHeight + 8,
    `scrollHeight=${deskMetrics.bodyScrollHeight} innerHeight=${deskMetrics.innerHeight}`,
  );

  // ── 4 · intro screen advance — second screen sanity ──────────────────────
  const start = desk.locator(".qz-runtime-page button").first();
  if ((await start.count()) === 1) {
    await start.click();
    await desk.waitForTimeout(600);
    await desk.screenshot({ path: `${DIR}/3-q-desktop-question.png`, fullPage: true });
  }
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
