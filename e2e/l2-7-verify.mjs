// L2-7 live-verify — "Test all paths" Tier-1 report + Flow decider highlight.
// Seeds a decider doc with a KNOWN V4 failure (unmapped deciding answers),
// drives the report overlay + deep link, fixes the doc, re-checks the verdict
// flip, checks the Flow chip, then restores. Temp probe.
import { chromium } from "playwright";

const BASE = "https://quizocalypse-studio.fly.dev";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmqwd15f0001aqvl19onkpwm6";
const ROUTE = `${BASE}/studio/onboarding/${QUIZ}`;
const DATA = `${ROUTE}?_data=routes%2Fstudio.onboarding_.%24quizId`;

const out = { checks: {}, pageErrors: [] };
const ok = (name, v) => {
  out.checks[name] = v;
  console.log(`${v ? "✓" : "✗"} ${name}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/studio?key=${KEY}`, { waitUntil: "domcontentloaded" });
const fetchLoader = async () => (await ctx.request.get(DATA)).json();
const putDoc = async (doc) =>
  (await ctx.request.put(DATA, { headers: { "content-type": "application/json" }, data: { doc } })).json();

const before = await fetchLoader();
const originalDoc = before.questionBuilder.doc;
const buckets = before.questionBuilder.categories;
ok("baseline clean", before.stage === "question_builder" && originalDoc.logic_model == null);

try {
  // ── seed: decider with ONLY the first answer mapped → V4 must fail ──
  const q1 = originalDoc.nodes.filter((n) => n.type === "question")[0];
  const seeded = {
    ...originalDoc,
    logic_model: "decider",
    nodes: originalDoc.nodes.map((n) =>
      n.id === q1.id
        ? {
            ...n,
            data: {
              ...n.data,
              role: "decides",
              required: true,
              answers: n.data.answers.map((a, i) =>
                i === 0 ? { ...a, target_id: buckets[0].id } : a,
              ),
            },
          }
        : n,
    ),
  };
  ok("seed PUT ok", (await putDoc(seeded)).ok === true);

  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await page.waitForSelector(".qz-ql-tabs", { timeout: 20000 });

  // ── open the report ──
  await page.locator("button:has-text('Test all paths')").click();
  await page.waitForSelector(".qz-ql-report", { timeout: 5000 });
  ok("overlay renders with Tier-1 + Tier-2 + outcomes sections", (await page.locator(".qz-ql-report-tier").count()) === 3);
  ok("11 checks listed (V1–V10 + S1 structure)", (await page.locator(".qz-ql-check").count()) === 11);
  const v1Row = page.locator(".qz-ql-check").filter({ hasText: "Exactly one deciding question" });
  ok("V1 passes (✓)", /✓/.test((await v1Row.locator(".qz-ql-check-glyph").textContent()) ?? ""));
  const v4Row = page.locator(".qz-ql-check").filter({ hasText: "Every deciding answer has a result" });
  ok("V4 fails with findings", (await v4Row.locator(".qz-ql-check-findings li").count()) === q1.data.answers.length - 1);
  ok("Tier-2 renders as a labeled placeholder", /arrives in a later update/.test((await page.locator(".qz-ql-report-tier2ph").textContent()) ?? ""));
  ok("outcome table has decider-answer rows", (await page.locator(".qz-ql-report-outcomes tbody tr").count()) >= q1.data.answers.length);
  // The REAL draft carries a genuinely orphaned end node — the S1 fold-in must
  // surface it (this is the review's key fix live: the report agrees with the
  // publish gate). blocking = unmapped answers + the structural orphan.
  const s1Row = page.locator(".qz-ql-check").filter({ hasText: "Structure" });
  ok("S1 structure check surfaces the real orphan", (await s1Row.locator(".qz-ql-check-findings li").count()) >= 1);
  const verdict1 = (await page.locator(".qz-ql-report-verdict").textContent()) ?? "";
  ok("§7.3 verdict: not safe + blocking count (V4 + S1)", /not safe to publish/.test(verdict1) && new RegExp(`${q1.data.answers.length - 1 + 1} blocking`).test(verdict1));

  // ── deep link: V4 finding → the decider card in the Builder view ──
  await v4Row.locator(".qz-ql-report-goto").first().click();
  await page.waitForSelector(".qz-ql-card.is-decider", { timeout: 5000 });
  ok("deep link closed the overlay", (await page.locator(".qz-ql-report").count()) === 0);
  ok("deep link landed on the ACTIVE decider card", await page.locator(".qz-ql-card.is-decider").first().evaluate((el) => el.classList.contains("is-active")));

  // ── fix the doc (map everything + drop the pre-existing orphaned end node)
  //    → verdict flips to safe ──
  const reachable = new Set();
  {
    const queue = ["intro"];
    const introNode = seeded.nodes.find((n) => n.type === "intro");
    queue[0] = introNode?.id ?? "intro";
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of seeded.edges) if (e.source === id) queue.push(e.target);
    }
  }
  const fixed = {
    ...seeded,
    nodes: seeded.nodes
      .filter((n) => n.type === "intro" || reachable.has(n.id)) // drop orphans
      .map((n) =>
        n.id === q1.id
          ? {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a, i) => ({
                  ...a,
                  target_id: buckets[i % buckets.length]?.id ?? buckets[0].id,
                })),
              },
            }
          : n,
      ),
  };
  ok("fix PUT ok", (await putDoc(fixed)).ok === true);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".qz-ql-tabs", { timeout: 20000 });
  await page.locator("button:has-text('Test all paths')").click();
  await page.waitForSelector(".qz-ql-report", { timeout: 5000 });
  const verdict2 = (await page.locator(".qz-ql-report-verdict").textContent()) ?? "";
  ok("verdict flips to safe after mapping", /0 blocking · safe to publish/.test(verdict2));
  ok("all block checks now pass", (await page.locator(".qz-ql-check.is-block").count()) === 0);
  await page.keyboard.press("Escape");
  ok("Escape closes the overlay", (await page.locator(".qz-ql-report").count()) === 0);

  // ── Flow tab: gold decider chip ──
  await page.locator(".qz-ql-tabs button", { hasText: "Flow" }).click();
  await page.waitForSelector(".qz-lfm-decider", { timeout: 5000 });
  ok("Flow map shows ◆ Decides the result", /Decides the result/.test((await page.locator(".qz-lfm-decider").textContent()) ?? ""));
} finally {
  ok("RESTORED original doc", (await putDoc(originalDoc)).ok === true);
}

// ── legacy regression: restored draft has NO tester button + NO flow chip ──
await page.goto(ROUTE, { waitUntil: "networkidle" });
await page.waitForSelector(".qz-ql-tabs", { timeout: 20000 });
ok("legacy: no Test-all-paths button", (await page.locator("button:has-text('Test all paths')").count()) === 0);
await page.locator(".qz-ql-tabs button", { hasText: "Flow" }).click();
await page.waitForTimeout(600);
ok("legacy: no decider chip in the flow map", (await page.locator(".qz-lfm-decider").count()) === 0);
ok("ZERO page errors", out.pageErrors.length === 0);
if (out.pageErrors.length) console.log("pageErrors:", out.pageErrors);

await browser.close();
const failed = Object.entries(out.checks).filter(([, v]) => !v);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} FAILED: ${failed.map(([k]) => k).join(" · ")}`);
process.exit(failed.length === 0 ? 0 : 1);
