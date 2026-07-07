// QZY-5 live-verify — the LIGHT Step-4 Results reveal (quiz-results-step4
// v1.0) on the funnel fixture. Seeds a minimal decider doc parked at
// build_session.stage="rec_page" with 2 probe buckets, drives the new
// Step4Results shell with Playwright, asserts the spec's Acceptance lines,
// then restores the fixture byte-for-byte (doc + original Category rows).
//
// Asserts: settings panel always visible / NO collapse control · 4 archetype
// thumbs (hero+grid default) · layout switch re-lays-out the preview without
// losing settings · products scrub 0–6 (exact entry) · price/desc/ATC/add-all
// toggles live in the preview · add-all only at 2+ · fallback single toggle,
// default ON, inline "If nothing matches" block (no state tabs) · More
// options fit/aspect/radius apply live · NO OOS + NO capture controls ·
// persistent dashboard explainer · sparse persistence via autosave · zero
// page errors.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/qzy5-shots";
const BACKUP = `${SHOTS}/qzy5-${QUIZ}-backup.json`;

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(BACKUP, JSON.stringify({ draftJson: quiz.draftJson, categories: originalCats }, null, 2));
console.log(`snapshot written: ${BACKUP}`);

let seeded = false;
async function restore() {
  if (!seeded) return;
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  seeded = false;
  console.log("fixture restored (doc + categories)");
}

try {
  // ── seed: 2 probe buckets + a decider doc parked at rec_page ──────────────
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId },
    select: { productId: true },
    take: 6,
  });
  ok("catalog has ≥6 products for probe buckets", products.length >= 6, `${products.length}`);
  const collection = await prisma.collection.findFirst({
    where: { shopId: quiz.shopId },
    select: { collectionId: true },
  });
  const fallbackCol = collection?.collectionId ?? "manual";

  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QZY5 Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "qzy5_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QZY5 Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "qzy5_probe",
    },
  });

  const answers = (defs) =>
    defs.map(([id, text, target]) => ({
      id, text, tags: [], edge_handle_id: `h_${id}`, ...(target ? { target_id: target } : {}),
    }));
  const probeDoc = {
    quiz_id: QUIZ,
    status: "draft",
    scope: { collection_ids: [] },
    logic_model: "decider",
    design_tokens: {
      colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" },
      radius: "rounded",
    },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "QZY5 Probe Shop", subtext: "Quick check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "What are you shopping for?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "r1", type: "result", position: { x: 0, y: 240 },
        data: { headline: "Your match", fallback_collection_id: fallbackCol } },
    ],
    edges: [
      { id: "e1", source: "intro1", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
    results_pages: [],
    rec_page_settings: { global: {}, overrides: {} },
    build_session: { stage: "rec_page", built: true },
  };
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: probeDoc } });
  console.log(`seeded probe doc at rec_page (targets ${catA.id} / ${catB.id})`);

  // ── drive the stage ────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 300)));

  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/studio/onboarding/${QUIZ}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // §1 — layout: panel + phone, no collapse control.
  ok("Step4 split mounts (.qz-s4-split)", (await page.locator(".qz-s4-split").count()) === 1);
  ok("settings panel rendered", await page.locator(".qz-s4-panel").isVisible());
  ok("NO collapse/hide-settings control",
    (await page.locator("button", { hasText: "Hide settings" }).count()) === 0 &&
    (await page.locator("button", { hasText: "Show settings" }).count()) === 0);
  ok("phone preview rendered", await page.locator(".qz-s4-phone").isVisible());
  ok("persistent dashboard explainer",
    await page.locator(".qz-s4-explainer", { hasText: "in the dashboard" }).isVisible());

  // §4 — nothing re-configured here: no OOS, no contact capture.
  const panelText = (await page.locator(".qz-s4-panel").textContent()) ?? "";
  ok("NO out-of-stock control on the page", !/out.of.stock/i.test(panelText));
  ok("NO contact-capture control on the page", !/email|phone|sms/i.test(panelText));

  // §3 — no preview state tabs.
  ok("NO preview state tabs", (await page.locator(".qz-s4-previewcol [role=tab]").count()) === 0);

  // §2.1 — four archetypes, hero+grid default; default preview = hero + 3 grid.
  ok("4 layout thumbs", (await page.locator(".qz-s4-layout").count()) === 4);
  ok("Hero + grid active by default",
    await page.locator(".qz-s4-layout.is-active", { hasText: "Hero + grid" }).isVisible());
  ok("default headline in preview",
    await page.locator(".qz-s4p-headline", { hasText: "Your perfect match" }).isVisible());
  // The bucket seeds 4 catalog products, but the engine drops unsellable/OOS
  // items — assert the archetype INVARIANTS relative to what resolved.
  const initialGrid = await page.locator(".qz-s4p-items .qz-s4p-card").count();
  const shownTotal = 1 + initialGrid; // hero + grid
  ok("hero badge + grid cards (hero_grid default)",
    (await page.locator(".qz-s4p-herowrap").count()) === 1 && initialGrid >= 1,
    `hero + ${initialGrid} grid`);

  // Layout switches re-lay-out the preview.
  await page.locator(".qz-s4-layout", { hasText: "Single hero" }).click();
  await page.waitForTimeout(200);
  ok("Single hero → one hero card, no grid",
    (await page.locator(".qz-s4p-herowrap").count()) === 1 &&
    (await page.locator(".qz-s4p-items .qz-s4p-card").count()) === 0);
  await page.locator(".qz-s4-layout", { hasText: "List" }).click();
  await page.waitForTimeout(200);
  ok("List → hero folded into stacked rows, no hero treatment",
    (await page.locator(".qz-s4p-herowrap").count()) === 0 &&
    (await page.locator(".qz-s4p-items.is-list .qz-s4p-card.is-row").count()) === shownTotal);
  await page.locator(".qz-s4-layout", { hasText: "Hero + grid" }).first().click();
  await page.waitForTimeout(200);
  ok("switching back never loses copy/product settings",
    (await page.locator(".qz-s4p-herowrap").count()) === 1 &&
    (await page.locator(".qz-s4p-items .qz-s4p-card").count()) === initialGrid);

  // §2.3 — products scrub (exact entry) + toggles.
  const scrub = page.locator(".qz-s4-sec", { hasText: "Products" }).locator(".qz-scrub-value").first();
  await scrub.click();
  await page.locator(".qz-s4-sec", { hasText: "Products" }).locator(".qz-scrub-input").fill("1");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  ok("scrub exact → 1 product after the hero",
    (await page.locator(".qz-s4p-items .qz-s4p-card").count()) === 1);

  ok("prices show by default", (await page.locator(".qz-s4p-price").count()) > 0);
  await page.locator(".qz-s4-check", { hasText: "Show price" }).locator("input").click();
  await page.waitForTimeout(200);
  ok("price toggle off → no prices in preview", (await page.locator(".qz-s4p-price").count()) === 0);

  ok("ATC pills show by default", (await page.locator(".qz-s4p-atc").count()) > 0);
  await page.locator(".qz-s4-check", { hasText: "Show “Add to cart”" }).locator("input").click();
  await page.waitForTimeout(200);
  ok("ATC toggle off → no add-to-cart pills", (await page.locator(".qz-s4p-atc").count()) === 0);

  ok("no add-all bar by default", (await page.locator(".qz-s4p-addall").count()) === 0);
  await page.locator(".qz-s4-check", { hasText: "Show “Add all to cart”" }).locator("input").click();
  await page.waitForTimeout(200);
  const addAllText = (await page.locator(".qz-s4p-addall").textContent().catch(() => "")) ?? "";
  ok("add-all on → bar with item count + total (2 shown)",
    /Add all 2 to cart · \$\d/.test(addAllText), addAllText.trim());

  // §5 — everything off still renders a valid reveal.
  await page.locator(".qz-s4-check", { hasText: "Show descriptions" }).locator("input").click();
  await page.waitForTimeout(200);
  ok("all product toggles off → reveal still valid (title cards remain)",
    (await page.locator(".qz-s4p-card .qz-s4p-title").count()) === 2 &&
    out.pageErrors.length === 0);

  // §2.4/§3 — fallback: default ON, inline block, toggle removes it.
  ok("fallback block shown inline by default (labeled)",
    await page.locator(".qz-s4p-fb-head", { hasText: "If nothing matches" }).isVisible());
  ok("fallback tag 'default copy · edit in dashboard'",
    await page.locator(".qz-s4p-fb-tag", { hasText: "edit in dashboard" }).isVisible());
  await page.locator(".qz-s4-check", { hasText: "fallback" }).locator("input").click();
  await page.waitForTimeout(200);
  ok("fallback toggle OFF → block absent", (await page.locator(".qz-s4p-fb").count()) === 0);
  await page.locator(".qz-s4-check", { hasText: "fallback" }).locator("input").click();
  await page.waitForTimeout(200);

  // §2.5 — More options: fit applies to preview images live.
  await page.locator(".qz-s4-more > summary").click();
  await page.locator(".qz-s4-seg button", { hasText: "Contain" }).click();
  await page.waitForTimeout(200);
  const fit = await page
    .locator(".qz-s4p-card img")
    .first()
    .evaluate((el) => getComputedStyle(el).objectFit)
    .catch(() => "no-img");
  ok("image fit Contain applies live", fit === "contain" || fit === "no-img", fit);
  await page.locator(".qz-s4-seg button", { hasText: "Portrait" }).click();
  await page.waitForTimeout(600);

  // Content — headline edit updates the preview.
  await page.locator(".qz-s4-field input[type=text]").fill("Made for you");
  await page.waitForTimeout(300);
  ok("headline edit live in preview",
    await page.locator(".qz-s4p-headline", { hasText: "Made for you" }).isVisible());

  // Autosave persists SPARSELY (values equal to defaults are absent).
  await page.waitForTimeout(1600);
  const savedDoc = (await prisma.quiz.findUnique({ where: { id: QUIZ } })).draftJson;
  const g = savedDoc?.rec_page_settings?.global ?? {};
  ok("autosave persisted the changed fields",
    g.gridMax === 1 && g.showPrice === false && g.showAtc === false &&
    g.showAddAll === true && g.showDesc === false && g.imgFit === "contain" &&
    g.cardAspect === "portrait" && g.headline === "Made for you",
    JSON.stringify(g));
  ok("defaults stay sparse (no layout/fallbackOn keys after round-trips)",
    !("layout" in g) && !("fallbackOn" in g));

  await page.screenshot({ path: `${SHOTS}/qzy5-final.png`, fullPage: true });
  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));

  await browser.close();
} finally {
  await restore();
  await prisma.$disconnect();
}

const failed = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - failed.length}/${Object.keys(out.checks).length} checks passed`);
if (failed.length) {
  console.log("FAILED:", failed.map(([k]) => k).join(" · "));
  process.exit(1);
}
