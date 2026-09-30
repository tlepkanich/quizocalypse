// Logic step (handoff §13, fix agent G) — the check popover's copy, grouping
// and order, plus the P1-1 "a route never renumbers" guarantee, live against
// a LOCAL production build + local DB. Runs on a THROWAWAY clone of the local
// fixture cmr7khgd50001vkhscvox8dgt (deleted at the end).
//
//   BASE=http://localhost:3647 node --env-file=.env e2e/logic-check-copy-verify.mjs
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { cloneFixture } from "./logic-fixture-clone.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/logic-check-copy-shots";
if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing (node --env-file=.env)");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });
const mask = (s) => String(s).replaceAll(KEY, "***");
const BANNED = /—|decid|bucket|branch|boost|weight|score/i;
const prisma = new PrismaClient();
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${mask(detail)}` : ""}`);
  if (!cond) failures++;
};

const clone = await cloneFixture(prisma, { name: "Logic check copy probe" });
const original = await clone.draft();
const questionIds = original.nodes.filter((n) => n.type === "question").map((n) => n.id);
const edit = async (fn) => {
  const d = structuredClone(original);
  fn(d);
  await clone.setDraft(d);
};
const q = (d, i) => d.nodes.find((n) => n.id === questionIds[i]);

let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(mask(String(e.message).split("\n")[0])));
  await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" }).catch((e) => {
    throw new Error(mask(e.message));
  });

  const open = async () => {
    await page.goto(`${BASE}/studio/onboarding/${clone.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="logic-tab-card"]', { timeout: 20000 }).catch(async (e) => {
      await page.screenshot({ path: `${SHOTS}/xx-no-card.png` });
      throw e;
    });
    await page.waitForTimeout(1200);
  };
  const popRows = async () => {
    await page.locator(".qz-topbar-continue").click();
    await page.waitForSelector('[data-testid="logic-check-popover"]', { timeout: 4000 });
    await page.waitForTimeout(300);
    return (await page.locator('[data-testid="logic-check-popover"] .qz-lg-find-t').allInnerTexts()).map((t) => t.trim());
  };
  const railOrder = async () =>
    page.locator('[data-testid="logic-tab-card"] .qz-lg-rail .qz-lg-qtxt').allInnerTexts();

  // 1 ── Filter Results + Rules: grouped copy, and a route never renumbers.
  await edit((d) => {
    d.logic_style = "attributes";
    for (const a of q(d, 0).data.answers) {
      delete a.target_id;
      delete a.target_ids;
    }
  });
  await open();
  const before = await railOrder();
  const rows = await popRows();
  console.log("  filter rows:", JSON.stringify(rows));
  ok("no row uses an em dash or an internal word", rows.every((r) => !BANNED.test(r)));
  ok("V4 is ONE grouped row (“Q1 · N answers have no recommendation”)",
    rows.filter((r) => /^Q1 · \d+ answers? ha(ve|s) no recommendation$/.test(r)).length === 1);
  ok("V13 is one row per question", rows.filter((r) => /keeps? everything \(no value chosen\)/.test(r)).length <= 1);
  await page.screenshot({ path: `${SHOTS}/01-filter-popover.png` });
  await page.keyboard.press("Escape");

  // A skip route (Q1 answer 1 → Q3) keeps the numbering.
  await edit((d) => {
    d.logic_style = "attributes";
    const a0 = q(d, 0).data.answers[0];
    d.edges = d.edges.filter((e) => !(e.source === questionIds[0] && e.source_handle === a0.edge_handle_id));
    d.edges.push({ id: "probe-skip", source: questionIds[0], target: questionIds[2], source_handle: a0.edge_handle_id });
  });
  await open();
  const after = await railOrder();
  ok("a skip route does not renumber the rail", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));

  // 2 ── Rules only with zero rules: only "needs at least one rule".
  await edit((d) => {
    d.logic_style = "rules";
    d.decision_rules = [];
  });
  await open();
  const ro = await popRows();
  console.log("  rules-only rows:", JSON.stringify(ro));
  // The not-live products note stays (mock `findings()` always lists it).
  const roIssues = ro.filter((r) => !/are not live/.test(r));
  ok("Rules only, zero rules: the one issue row is 'needs at least one rule'",
    roIssues.length === 1 && roIssues[0] === "Rules only needs at least one rule to show anything.");
  ok("no “never recommended” rows without rules", !ro.some((r) => /never recommended/.test(r)));
  await page.screenshot({ path: `${SHOTS}/02-rules-only-popover.png` });
  await page.keyboard.press("Escape");

  // 3 ── R0: a rules-inferred draft with no saved style lists the style row
  // FIRST, and the Filter block repeats the sentence.
  await edit((d) => {
    delete d.logic_style;
    if (d.build_session) delete d.build_session.logic_style;
    // No filter role + a rule → the screen infers Rules only; the picking
    // question loses its targets so a Filter block (V4) fires beside R0.
    const target = q(d, 0).data.answers.find((a) => a.target_id)?.target_id ?? "";
    for (const n of d.nodes) if (n.type === "question" && n.data.role === "filter") n.data.role = "qualifier";
    for (const a of q(d, 0).data.answers) {
      delete a.target_id;
      delete a.target_ids;
    }
    const qa = q(d, 2);
    d.decision_rules = [
      { id: "probe-r1", conditions: [{ question_id: qa.id, answer_id: qa.data.answers[0].id, op: "is" }], target_id: target },
    ];
  });
  await open();
  const r0 = await popRows();
  console.log("  style-note rows:", JSON.stringify(r0));
  ok("the style row is listed first", /still picks results the Filter Results \+ Rules way/.test(r0[0] ?? ""));
  ok("the Filter block carries the same sentence",
    r0.slice(1).some((r) => /^Q1 · \d+ answers? ha(ve|s) no recommendation/.test(r) && /Choose 'Rules only'/.test(r)));
  ok("no row uses an em dash or an internal word", r0.every((r) => !BANNED.test(r)));
  await page.screenshot({ path: `${SHOTS}/03-style-note-popover.png` });

  // 4 ── P2-11: the autosave PUT orders one session's writes. A late older
  // commit is refused (409, stale) and the newer save stays.
  const headlineOf = (d) => d.nodes.find((n) => n.type === "intro")?.data.headline;
  const put = (headline, seq) => {
    const d = structuredClone(original);
    d.nodes.find((n) => n.type === "intro").data.headline = headline;
    return page.request.put(`${BASE}/studio/onboarding/${clone.id}`, {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ doc: d, save: { id: "probe-session", seq } }),
    });
  };
  const newer = await put("probe newer", 6);
  const older = await put("probe older", 5);
  const olderBody = await older.json().catch(() => ({}));
  const saved = await clone.draft();
  ok("newer PUT writes", newer.status() === 200, String(newer.status()));
  // A document request renders the page, so only the status is checked here.
  ok("a late older PUT is refused as stale (409)", older.status() === 409 && olderBody !== null, String(older.status()));
  ok("the newer save stays", headlineOf(saved) === "probe newer", headlineOf(saved));
  ok("the session stamp is kept in build_session", saved.build_session?.autosave?.seq === 6);

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser?.close();
  await clone.drop();
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
