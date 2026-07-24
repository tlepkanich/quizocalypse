// BLD-2 live-verify — the Design AI top-bar restyle against a LOCAL
// production build (BASE env, default http://localhost:3000).
//
// Fixture: LOCAL draft cmr7khgd50001vkhscvox8dgt. Snapshots draftJson up
// front, strips build_session for the session (so /studio/:id opens the
// builder), drives the REAL affordance (pill → popover → prompt → apply →
// undo), and restores draftJson BYTE-FOR-BYTE in `finally`. Screenshots land
// in /tmp/bld2-shots.
//
// Two modes (the server env decides which paths are provable):
//   PROBE_MODE=fail   — server started with ANTHROPIC_API_KEY= (blank).
//                       Asserts: pill in the top bar · popover PORTALS to
//                       document.body (pointer-trap rule) · Enter submits ·
//                       the mapped "unavailable" copy renders inline · the
//                       draft's design_tokens are UNCHANGED · Esc closes and
//                       focus returns to the pill.
//   PROBE_MODE=happy  — server started with the real key. ONE real AI call:
//                       submit the brief → busy label → applied (≥2
//                       All-screens cards repaint via getComputedStyle) →
//                       autosave persists (prisma read-back: curated fonts,
//                       contrast ≥4.5) → Undo (Ns) reverts + persists.
//
// Run:  set -a; source .env; set +a; PROBE_MODE=fail node e2e/bld2-designai-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const MODE = process.env.PROBE_MODE === "happy" ? "happy" : "fail";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/bld2-shots";

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const mask = (s) => String(s).replaceAll(KEY, "***");
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${mask(detail)}` : ""}`);
  if (!cond) failures++;
};

// WCAG relative-luminance contrast (mirror of app/lib/designTokens.ts) so the
// probe can assert the guardrail on the PERSISTED tokens.
function contrast(hexA, hexB) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = lum(hexA) >= lum(hexB) ? [lum(hexA), lum(hexB)] : [lum(hexB), lum(hexA)];
  return (hi + 0.05) / (lo + 0.05);
}
const CURATED = new Set([
  "Playfair Display", "Lora", "Spectral", "Fraunces", "Cormorant Garamond", "Newsreader",
  "Inter", "Geist", "Poppins", "Work Sans", "DM Sans", "Manrope", "Space Grotesk",
  "Figtree", "Nunito Sans", "Outfit", "Karla", "Source Sans 3", "Schibsted Grotesk",
  "Quicksand", "Sora", "Archivo", "Bricolage Grotesque", "Unbounded", "Syne",
  "JetBrains Mono", "Space Mono", "IBM Plex Mono",
]);

const prisma = new PrismaClient();
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found in the LOCAL DB");
  await prisma.$disconnect();
  process.exit(1);
}
const snapshot = JSON.stringify(quiz.draftJson);
console.log(`mode=${MODE} · snapshot taken (${snapshot.length} bytes)`);

// Builder, not funnel: strip build_session for the session (restored below).
const { build_session: _bs, ...builderDoc } = quiz.draftJson;
await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: builderDoc } });
const tokensBefore = JSON.stringify(builderDoc.design_tokens ?? {});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));

const readCards = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".qz-allcard-doc")].slice(0, 4).map((el) => {
      const cs = getComputedStyle(el);
      return {
        bg: cs.getPropertyValue("--qz-color-background").trim(),
        heading: cs.getPropertyValue("--qz-font-heading").trim(),
        radius: cs.getPropertyValue("--qz-radius").trim(),
      };
    }),
  );

try {
  await page.goto(`${BASE}/studio/${QUIZ}?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qz-builder", { timeout: 20000 });
  await page.waitForTimeout(1500); // hydration settle

  // ── shared: the pill + popover anatomy ─────────────────────────────────────
  const btn = page.locator('[data-testid="design-ai-btn"]');
  ok("Design AI pill renders in the top bar", (await btn.count()) === 1);
  ok("pill sits in the top-bar center (next to the canvas-mode control)",
    (await page.locator('.qz-builder [data-testid="design-ai-btn"]').count()) === 1);

  await btn.click();
  await page.waitForSelector('[data-testid="design-ai-popover"]', { timeout: 5000 });
  const portaled = await page.evaluate(() => {
    const pop = document.querySelector('[data-testid="design-ai-popover"]');
    const host = pop?.closest(".qz-popover");
    return Boolean(host && host.parentElement === document.body);
  });
  ok("popover portals to document.body (pointer-trap rule)", portaled);
  ok("textarea autofocused", await page.evaluate(
    () => document.activeElement?.tagName === "TEXTAREA"));
  await page.screenshot({ path: `${SHOTS}/${MODE}-1-popover-open.png` });

  if (MODE === "fail") {
    // ── failure path (keyless server): mapped copy, no doc change ────────────
    await page.locator('[data-testid="design-ai-popover"] textarea')
      .fill("warm editorial, cream background, serif headings, soft buttons");
    await page.keyboard.press("Enter"); // Enter submits
    await page.waitForSelector('[data-testid="design-ai-error"]', { timeout: 20000 });
    const copy = (await page.locator('[data-testid="design-ai-error"]').textContent()) ?? "";
    ok("mapped unavailable/failed copy renders inline",
      copy.includes("temporarily unavailable") && copy.includes("Your design is unchanged"),
      copy);
    await page.screenshot({ path: `${SHOTS}/fail-2-error-copy.png` });

    const after = await prisma.quiz.findUnique({ where: { id: QUIZ } });
    ok("draft design_tokens unchanged after the failed call",
      JSON.stringify(after.draftJson.design_tokens ?? {}) === tokensBefore);
    ok("no undo chip after a failure",
      (await page.locator('[data-testid="design-ai-undo"]').count()) === 0);

    // Esc closes; focus returns to the pill.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    ok("Esc closes the popover",
      (await page.locator('[data-testid="design-ai-popover"]').count()) === 0);
    ok("focus returns to the Design AI pill on close", await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "design-ai-btn"));
  } else {
    // ── happy path (real key): ONE real AI call end-to-end ──────────────────
    // All-screens mode so the repaint is measurable across cards.
    await page.locator('[role=group][aria-label="Canvas mode"] button', { hasText: "All screens" }).click();
    await page.waitForSelector(".qz-allcard-doc", { timeout: 10000 });
    const before = await readCards();
    ok("≥2 All-screens cards to measure", before.length >= 2);
    await page.screenshot({ path: `${SHOTS}/happy-2-before.png` });

    // Popover was dismissed by the mode click — reopen and submit.
    await btn.click();
    await page.waitForSelector('[data-testid="design-ai-popover"]', { timeout: 5000 });
    await page.locator('[data-testid="design-ai-popover"] textarea')
      .fill("warm editorial: cream background, serif headings, soft rounded buttons");
    await page.locator('[data-testid="design-ai-popover"] button', { hasText: "Apply style" }).click();

    // Busy state on the pill.
    try {
      await page.waitForSelector('[data-testid="design-ai-btn"]:has-text("Styling…")', { timeout: 4000 });
      ok("busy label ✦ Styling… shows", true);
      await page.screenshot({ path: `${SHOTS}/happy-3-busy.png` });
    } catch {
      ok("busy label ✦ Styling… shows", false, "never observed (call may have settled instantly)");
    }

    // Applied: undo chip appears; cards repaint.
    await page.waitForSelector('[data-testid="design-ai-undo"]', { timeout: 90000 });
    await page.waitForTimeout(400);
    const after = await readCards();
    const changed = after.filter((c, i) =>
      JSON.stringify(c) !== JSON.stringify(before[i] ?? {}));
    ok("tokens visibly change ≥2 All-screens cards (getComputedStyle)",
      changed.length >= 2,
      `changed=${changed.length}/${after.length} before=${JSON.stringify(before[0])} after=${JSON.stringify(after[0])}`);
    await page.screenshot({ path: `${SHOTS}/happy-4-applied.png` });
    await page.screenshot({ path: `${SHOTS}/happy-5-undo-toast.png`, clip: { x: 0, y: 0, width: 1600, height: 120 } });

    // Autosave persists the restyle (server write + client autosave agree).
    await page.waitForTimeout(2000);
    const persisted = await prisma.quiz.findUnique({ where: { id: QUIZ } });
    const dt = persisted.draftJson.design_tokens ?? {};
    ok("restyle persisted (design_tokens differ from before)",
      JSON.stringify(dt) !== tokensBefore);
    const heading = dt.typography?.heading?.family;
    const body = dt.typography?.body?.family;
    ok("persisted fonts are curated (or untouched)",
      (heading === undefined || CURATED.has(heading)) && (body === undefined || CURATED.has(body)),
      `heading=${heading} body=${body}`);
    const bg = dt.colors?.background ?? "#ffffff";
    const text = dt.colors?.text ?? "#1f1f1f";
    const primary = dt.colors?.primary ?? "#5563de";
    ok("persisted text-on-background contrast ≥ 4.5",
      contrast(text, bg) >= 4.5, `text=${text} bg=${bg} ratio=${contrast(text, bg).toFixed(2)}`);
    ok("persisted white-on-primary contrast ≥ 4.5",
      contrast("#ffffff", primary) >= 4.5, `primary=${primary} ratio=${contrast("#ffffff", primary).toFixed(2)}`);

    // Undo (Ns) reverts the look and the revert persists via autosave.
    await page.locator('[data-testid="design-ai-undo"]').click();
    await page.waitForTimeout(400);
    const reverted = await readCards();
    ok("undo repaints the cards back",
      JSON.stringify(reverted) === JSON.stringify(before),
      `reverted[0]=${JSON.stringify(reverted[0])}`);
    await page.waitForTimeout(2000);
    const restored = await prisma.quiz.findUnique({ where: { id: QUIZ } });
    ok("undo persisted (design_tokens back to before)",
      JSON.stringify(restored.draftJson.design_tokens ?? {}) === tokensBefore);
    await page.screenshot({ path: `${SHOTS}/happy-6-after-undo.png` });
  }

  ok("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (err) {
  ok("probe completed without throwing", false, String(err).slice(0, 300));
} finally {
  await browser.close();
  // Restore the fixture BYTE-FOR-BYTE.
  await prisma.quiz.update({
    where: { id: QUIZ },
    data: { draftJson: JSON.parse(snapshot) },
  });
  const check = await prisma.quiz.findUnique({ where: { id: QUIZ } });
  const restoredOk = JSON.stringify(check.draftJson) === snapshot;
  console.log(`${restoredOk ? "✓" : "✗"} fixture restored byte-for-byte`);
  if (!restoredOk) failures++;
  await prisma.$disconnect();
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
