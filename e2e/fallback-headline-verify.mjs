// Fallback headline live-verify (owner 2026-09-30) — the decider fallback
// page's own headline + one honest line, proven against TWO local prod builds
// on the same local DB:
//
//   OLD = the pre-change build (e.g. `git archive` of the base commit)
//   NEW = this tree's build
//
// 1. Creates two throwaway decider quizzes on the local fixture's shop
//    (`cmr7khgd5…`'s shop; the fixture itself is never written) with their own
//    categories: D1 = attributes (Boards → 4 products, Empty → 0 products →
//    the resolved-but-empty fallback page), D2 = Rules only (Boards rule →
//    products; anything else → the D1 safety net, targetId null). Both carry a
//    best_sellers global_fallback, captureEmail off and a LOCKED why-copy (no
//    runtime AI call, deterministic DOM). Publishes both via OLD.
// 2. `/q/:id.json` bytes: OLD vs NEW for every published legacy quiz + D1/D2.
// 3. DOM: walks every case to the reveal on OLD and NEW (desktop, reduced
//    motion), diffs the normalized runtime DOM. Only fallback pages may differ.
// 4. Republishes D1/D2 via NEW with a merchant fallbackHeadline (+ a fr
//    translation of it on D1) and screenshots every fallback page mobile +
//    desktop, default and merchant headline; checks ?locale=fr.
// 5. Puts D1's draft at the Results stage and drives the guided Results
//    step's "Fallback headline" field on NEW (screenshot + autosave proof).
// 6. Deletes both quizzes (cascade) and their categories in `finally`.
//
// Run: OLD=http://localhost:4210 NEW=http://localhost:4211 \
//      node --env-file=.env e2e/fallback-headline-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OLD = process.env.OLD ?? "http://localhost:4210";
const NEW = process.env.NEW ?? "http://localhost:4211";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const FIXTURE = "cmr7khgd50001vkhscvox8dgt";
const OUT = process.env.OUT ?? "/tmp/fbh-verify";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — run with node --env-file=.env");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient();
const checks = {};
const ok = (name, v, extra = "") => {
  checks[name] = Boolean(v);
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${String(extra).replaceAll(KEY, "***")}` : ""}`);
};

const source = await prisma.quiz.findUnique({ where: { id: FIXTURE }, select: { shopId: true } });
if (!source) {
  console.error("local fixture not found");
  process.exit(1);
}
const shopId = source.shopId;
const created = [];

const answers = (defs) =>
  defs.map(([id, text, target]) => ({
    id,
    text,
    tags: [],
    edge_handle_id: `h_${id}`,
    ...(target ? { target_id: target } : {}),
  }));

function mkDoc(quizId, { catA, catEmpty, rules, global = {}, translations }) {
  return {
    quiz_id: quizId,
    status: "draft",
    scope: { collection_ids: [] },
    logic_model: "decider",
    ...(rules ? { logic_style: "rules" } : {}),
    design_tokens: { colors: { primary: "#2A9D8F", background: "#FFF4E6", text: "#264653" }, radius: "rounded" },
    nodes: [
      { id: "intro1", type: "intro", position: { x: 0, y: 0 },
        data: { headline: "FBH Probe", subtext: "Fallback headline check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "What are you shopping for?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA], ["a_other", "Something else", rules ? null : catEmpty]]) } },
      { id: "r1", type: "result", position: { x: 0, y: 240 }, data: { headline: "Your match", fallback_collection_id: "manual" } },
    ],
    edges: [
      { id: "e1", source: "intro1", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
    results_pages: [],
    ...(rules
      ? { decision_rules: [{ id: "rule_board", match: "all", action: "show", target_id: catA,
          conditions: [{ op: "is", answer_id: "a_board", question_id: "q1" }] }] }
      : {}),
    global_fallback: { enabled: true, mode: "best_sellers", heading: "Our most-loved products", product_ids: [], count: 4 },
    rec_page_settings: {
      global: { captureEmail: false, whyCopyLocked: true, ...global },
      overrides: {},
    },
    ...(translations ? { translations } : {}),
    build_session: { stage: "question_builder", built: true },
  };
}

async function makeQuiz(name, rules) {
  const quiz = await prisma.quiz.create({ data: { shopId, name, status: "draft", draftJson: {} } });
  created.push(quiz.id);
  const products = await prisma.product.findMany({
    where: { shopId }, select: { productId: true }, take: 4,
  });
  const catA = await prisma.category.create({
    data: { shopId, quizId: quiz.id, name: "FBH Boards", description: "", tags: [],
      productIds: products.map((p) => p.productId), source: "manual", discoveryRunId: "fbh_probe" },
  });
  const catEmpty = await prisma.category.create({
    data: { shopId, quizId: quiz.id, name: "FBH Empty", description: "", tags: [],
      productIds: [], source: "manual", discoveryRunId: "fbh_probe" },
  });
  return { id: quiz.id, catA: catA.id, catEmpty: catEmpty.id, rules };
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// The runtime's DOM with build-specific noise removed (asset hashes live in
// <script>/<link>; session ids are random per visit).
const normalizedDom = (page) =>
  page.evaluate(() => {
    const body = document.body.cloneNode(true);
    body.querySelectorAll("script, link, noscript").forEach((n) => n.remove());
    return body.innerHTML
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
      .replace(/(session(?:Id)?=)[A-Za-z0-9_-]+/g, "$1<SID>")
      .replace(/(\/r\/)[A-Za-z0-9_-]+/g, "$1<SID>");
  });

// Every walk gets a FRESH browser context: the runtime resumes a stored
// session per origin, so a shared context replays the previous walk's result.
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
async function shopperPage(viewport = DESKTOP) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  // Pin Math.random: an ab_split branch node (pickBranchSlot) rolls it, so a
  // legacy quiz with one would reach a different result on every walk.
  await ctx.addInitScript(() => {
    Math.random = () => 0.42;
  });
  return ctx.newPage();
}
const closePage = (page) => page.context().close();

async function walk(page, base, quizId, answerText, { locale } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const q = `${base}/q/${quizId}?fbh=${Math.random().toString(36).slice(2)}${locale ? `&locale=${locale}` : ""}`;
  await page.goto(q, { waitUntil: "networkidle", timeout: 30_000 });
  for (let i = 0; i < 14; i++) {
    if (await page.getByRole("button", { name: /start over/i }).count()) break;
    if (answerText && (await page.getByText(answerText, { exact: false }).count())) {
      await page.getByText(answerText, { exact: false }).first().click();
    } else {
      const choice = page.locator('.qz-runtime-content input[type="checkbox"], .qz-runtime-content input[type="radio"]').first();
      if (await choice.count()) await choice.click().catch(() => {});
      const inputs = page.locator('.qz-runtime-content input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"])');
      for (let k = 0; k < (await inputs.count()); k++) {
        const type = await inputs.nth(k).getAttribute("type");
        await inputs.nth(k).fill(type === "email" ? "a@b.co" : type === "number" ? "3" : "test").catch(() => {});
      }
      const action = page
        .locator('.qz-runtime-content button:not([title="Jump back to this question"]):not([aria-label="More info"])')
        .filter({ hasNotText: /^\s*back\s*$/i })
        .first();
      if (!(await action.count()) || !(await action.isEnabled().catch(() => false))) break;
      await action.click();
    }
    await page.waitForTimeout(350);
    const next = page.getByRole("button", { name: /^next$/i }).first();
    if ((await next.count()) && (await next.isEnabled().catch(() => false))) await next.click();
    await page.waitForTimeout(450);
  }
  await page.getByRole("button", { name: /start over/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  return errors;
}

let browser = null;
const report = { json: [], dom: [], screenshots: [] };
try {
  const d1 = await makeQuiz("[probe] fallback headline D1 attributes", false);
  const d2 = await makeQuiz("[probe] fallback headline D2 rules", true);
  console.log(`probe quizzes created: ${d1.id} ${d2.id}`);
  const frD2 = {
    fr: { generated_at: new Date().toISOString(), strings: {
      "chrome.decider_fallback_headline": "Nos produits préférés",
      "chrome.decider_fallback_subline": "Pas de correspondance exacte pour vos réponses, voici nos favoris.",
    } },
  };

  browser = await chromium.launch();
  const ctxFor = async (base, viewport = { width: 1280, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(`${base}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
    await p.close();
    return ctx;
  };
  const publish = async (ctx, base, quizId, doc) => {
    await prisma.quiz.update({ where: { id: quizId }, data: { draftJson: doc } });
    const res = await ctx.request.post(`${base}/studio/${quizId}?_data=routes%2Fstudio_.%24id`, {
      form: { intent: "publish", doc: JSON.stringify(doc) },
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok() && !/"ok":false/.test(body), body: body.slice(0, 300) };
  };

  // ── 1. publish both via OLD ────────────────────────────────────────────────
  const oldCtx = await ctxFor(OLD);
  const newCtx = await ctxFor(NEW);
  const p1 = await publish(oldCtx, OLD, d1.id, mkDoc(d1.id, d1));
  ok("D1 publishes via OLD", p1.ok, p1.body);
  const p2 = await publish(oldCtx, OLD, d2.id, mkDoc(d2.id, { ...d2, translations: frD2 }));
  ok("D2 publishes via OLD", p2.ok, p2.body);

  // ── 2. /q/:id.json bytes OLD vs NEW ───────────────────────────────────────
  const legacy = (await prisma.quiz.findMany({ where: { publishedJson: { not: null } }, select: { id: true, publishedJson: true } }))
    .filter((r) => r.publishedJson?.logic_model !== "decider")
    .map((r) => r.id);
  for (const id of [...legacy, d1.id, d2.id]) {
    const [a, b] = await Promise.all([OLD, NEW].map(async (base) => {
      const r = await fetch(`${base}/q/${id}.json`);
      return Buffer.from(await r.arrayBuffer());
    }));
    const same = a.equals(b);
    report.json.push({ id, bytes: a.length, sha256: sha(a).slice(0, 16), identical: same });
    ok(`/q/${id}.json bytes identical OLD vs NEW`, same, `${a.length}B ${sha(a).slice(0, 16)}`);
  }

  // ── 3. DOM walks ───────────────────────────────────────────────────────────
  const cases = [
    ...legacy.map((id) => ({ label: `legacy-${id}`, id, answer: null, fallback: false })),
    { label: "D1-products", id: d1.id, answer: "A snowboard", fallback: false },
    { label: "D1-empty-target", id: d1.id, answer: "Something else", fallback: true },
    { label: "D2-rule-products", id: d2.id, answer: "A snowboard", fallback: false },
    { label: "D2-safety-net", id: d2.id, answer: "Something else", fallback: true },
  ];
  for (const c of cases) {
    const doms = {};
    for (const [name, base] of [["old", OLD], ["new", NEW]]) {
      const page = await shopperPage();
      const errors = await walk(page, base, c.id, c.answer);
      doms[name] = await normalizedDom(page);
      writeFileSync(`${OUT}/dom-${c.label}-${name}.html`, doms[name]);
      if (name === "new" && c.fallback) {
        const shot = `${OUT}/new-${c.label}-default-desktop.png`;
        await page.screenshot({ path: shot, fullPage: true });
        report.screenshots.push(shot);
        const h2 = await page.locator(".qz-runtime-content h2").first().textContent().catch(() => null);
        const text = await page.locator("body").innerText();
        ok(`${c.label}: NEW h2 is the default fallback headline`, h2 === "Our most-loved products", h2);
        ok(`${c.label}: NEW shows the one line`, text.includes("We couldn't find an exact match for your answers, so here are some favourites."));
        ok(`${c.label}: NEW has no why-copy and no old line`,
          !text.includes("matched you with products tailored") && !text.includes("here are our most-loved products."));
      }
      if (name === "old" && c.fallback) {
        const text = await page.locator("body").innerText();
        ok(`${c.label}: OLD showed the old line (the page this change replaces)`,
          text.includes("We couldn't find an exact match — here are our most-loved products."));
      }
      if (errors.length) ok(`${c.label}/${name}: no page errors`, false, errors[0]);
      await closePage(page);
    }
    const same = doms.old === doms.new;
    report.dom.push({ case: c.label, identical: same, fallbackPage: c.fallback, bytes: doms.new.length });
    if (c.fallback) ok(`${c.label}: DOM differs OLD vs NEW (the allowed fallback-page diff)`, !same);
    else ok(`${c.label}: DOM identical OLD vs NEW`, same, same ? `${doms.new.length}B` : "see dom-*.html");
  }

  // Mobile default screenshots of both fallback pages + ?locale=fr on D2.
  for (const [label, id] of [["D1-empty-target", d1.id], ["D2-safety-net", d2.id]]) {
    const page = await shopperPage(MOBILE);
    await walk(page, NEW, id, "Something else");
    const shot = `${OUT}/new-${label}-default-mobile.png`;
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshots.push(shot);
    await closePage(page);
  }
  {
    const page = await shopperPage();
    await walk(page, NEW, d2.id, "Something else", { locale: "fr" });
    const h2 = await page.locator(".qz-runtime-content h2").first().textContent().catch(() => null);
    ok("D2 ?locale=fr translates the default fallback headline", h2 === "Nos produits préférés", h2);
    ok("D2 ?locale=fr translates the line", (await page.locator("body").innerText()).includes("Pas de correspondance exacte"));
    const shot = `${OUT}/new-D2-safety-net-default-fr-desktop.png`;
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshots.push(shot);
    await closePage(page);
  }

  // ── 4. merchant headline via NEW ───────────────────────────────────────────
  const frD1 = {
    fr: { generated_at: new Date().toISOString(), strings: { "recpage.fallbackHeadline": "Les favoris de l'équipe" } },
  };
  const m1 = await publish(newCtx, NEW, d1.id, mkDoc(d1.id, { ...d1, global: { fallbackHeadline: "Staff favourites" }, translations: frD1 }));
  ok("D1 republishes via NEW with a fallbackHeadline", m1.ok, m1.body);
  const m2 = await publish(newCtx, NEW, d2.id, mkDoc(d2.id, { ...d2, global: { fallbackHeadline: "Staff favourites" } }));
  ok("D2 republishes via NEW with a fallbackHeadline", m2.ok, m2.body);
  const pj = await (await fetch(`${NEW}/q/${d1.id}.json`)).json();
  ok("published JSON carries fallbackHeadline", pj.rec_page_settings?.global?.fallbackHeadline === "Staff favourites");
  for (const [label, id] of [["D1-empty-target", d1.id], ["D2-safety-net", d2.id]]) {
    for (const [vp, viewport] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
      const page = await shopperPage(viewport);
      await walk(page, NEW, id, "Something else");
      const h2 = await page.locator(".qz-runtime-content h2").first().textContent().catch(() => null);
      ok(`${label} @${vp}: merchant fallback headline renders`, h2 === "Staff favourites", h2);
      const shot = `${OUT}/new-${label}-merchant-${vp}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      report.screenshots.push(shot);
      await closePage(page);
    }
    // The product path of the same doc keeps its reveal headline.
    const page = await shopperPage();
    await walk(page, NEW, id, "A snowboard");
    const h2 = await page.locator(".qz-runtime-content h2").first().textContent().catch(() => null);
    ok(`${label.slice(0, 2)} products page keeps "Your perfect match" with a fallbackHeadline set`, h2 === "Your perfect match", h2);
    await closePage(page);
  }
  {
    const page = await shopperPage();
    await walk(page, NEW, d1.id, "Something else", { locale: "fr" });
    const h2 = await page.locator(".qz-runtime-content h2").first().textContent().catch(() => null);
    ok("D1 ?locale=fr translates the merchant fallback headline", h2 === "Les favoris de l'équipe", h2);
    await closePage(page);
  }

  // ── 5. the guided Results step field ───────────────────────────────────────
  {
    const row = await prisma.quiz.findUnique({ where: { id: d1.id }, select: { draftJson: true } });
    const draft = { ...row.draftJson, build_session: { ...(row.draftJson.build_session ?? {}), stage: "rec_page", built: true } };
    delete draft.rec_page_settings.global.fallbackHeadline;
    await prisma.quiz.update({ where: { id: d1.id }, data: { draftJson: draft } });
    for (const [vp, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
      const ctx = await ctxFor(NEW, viewport);
      const page = await ctx.newPage();
      await page.goto(`${NEW}/studio/onboarding/${d1.id}`, { waitUntil: "networkidle", timeout: 30_000 });
      const field = page.getByLabel("Fallback headline");
      await field.waitFor({ timeout: 15_000 }).catch(() => {});
      ok(`guided Results @${vp}: Fallback headline field renders`, await field.isVisible().catch(() => false));
      ok(`guided Results @${vp}: placeholder is the default`, (await field.getAttribute("placeholder").catch(() => null)) === "Our most-loved products");
      if (vp === "desktop") {
        await field.fill("Staff favourites");
        let stored;
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(400);
          stored = (await prisma.quiz.findUnique({ where: { id: d1.id }, select: { draftJson: true } })).draftJson
            .rec_page_settings?.global?.fallbackHeadline;
          if (stored === "Staff favourites") break;
        }
        ok("guided Results: typing autosaves global.fallbackHeadline", stored === "Staff favourites", stored);
      }
      await field.scrollIntoViewIfNeeded().catch(() => {});
      const shot = `${OUT}/new-guided-results-field-${vp}.png`;
      await page.screenshot({ path: shot, fullPage: false });
      report.screenshots.push(shot);
      await ctx.close();
    }
  }
} finally {
  for (const id of created) {
    await prisma.category.deleteMany({ where: { quizId: id } });
    await prisma.quiz.delete({ where: { id } }).catch(() => {});
  }
  console.log(`probe quizzes deleted: ${created.join(" ")}`);
  await browser?.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ checks, ...report }, null, 2));
  await prisma.$disconnect();
}
const failed = Object.entries(checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(checks).length - failed.length}/${Object.keys(checks).length} checks passed`);
process.exit(failed.length ? 1 : 0);
