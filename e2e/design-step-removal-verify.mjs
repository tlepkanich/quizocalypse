// Design-step removal live-verify — the funnel bar is FOUR steps
// (Recommendations · Questions · Logic · Results); Results' Continue reads
// "Open builder" (generate-build — the look is brand-inherited, edited in
// the builder's Design rail); a draft PARKED at the retired "design" stage
// folds onto Results and still renders. LOCAL prod build + LOCAL DB,
// fixture cmr7khgd50001vkhscvox8dgt — the draft's stage is seeded via prisma
// (q3's pattern) and byte-restored at the end.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/design-removal-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const prisma = new PrismaClient();
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const originalDraft = quiz.draftJson;
const seedStage = async (stage) => {
  const doc = structuredClone(originalDraft);
  doc.build_session = { ...(doc.build_session ?? {}), stage };
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: doc } });
};
const restore = async () => {
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: originalDraft } });
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));

try {
  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });

  // ── stage rec_page: the four-step bar + Open builder ──────────────────────
  await seedStage("rec_page");
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-stepnav", { timeout: 15000 });
  await page.waitForTimeout(1200);

  const pills = (await page.locator(".qz-stepnav .qz-stepnav-pill").allInnerTexts()).map(
    (p) => p.replace(/\s+/g, " ").trim(),
  );
  ok("funnel bar shows FOUR steps", pills.length === 4, JSON.stringify(pills));
  ok("no Design pill anywhere", !pills.some((p) => /design/i.test(p)), JSON.stringify(pills));
  ok("Results is the LAST pill", /results/i.test(pills[pills.length - 1] ?? ""), pills.at(-1));
  ok("current pill is Results",
    /results/i.test(((await page.locator(".qz-stepnav-pill.is-current").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ")));
  const label = ((await page.locator(".qz-topbar-continue").innerText().catch(() => "")) ?? "").trim();
  ok('Results Continue reads "Open builder" (generate-build)', /open builder/i.test(label), label);
  ok("Results surface renders (guided flow or rec stage)",
    (await page.locator(".qz-rg, .qz-s4, .qz-recstage, .qz-page").count()) > 0);
  await page.screenshot({ path: `${SHOTS}/four-step-bar.png` });

  // ── parked at the RETIRED "design" stage → folds onto Results ─────────────
  await seedStage("design");
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-stepnav", { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok("parked-design draft folds onto Results (current pill)",
    /results/i.test(((await page.locator(".qz-stepnav-pill.is-current").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ")));
  const label2 = ((await page.locator(".qz-topbar-continue").innerText().catch(() => "")) ?? "").trim();
  ok("parked-design draft gets the Open-builder Continue", /open builder/i.test(label2), label2);
  ok("no Design surface renders for the parked draft",
    (await page.locator(".qz-design-stage, .qz-vibesel").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/parked-design-folds.png` });

  ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} finally {
  await restore();
  console.log("fixture restored (draftJson byte-for-byte)");
  await browser.close();
  await prisma.$disconnect();
}
console.log(failures === 0 ? `\nALL GREEN — shots in ${SHOTS}` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
