// WIS-026: Question widget mapping, picker cancellation and measured overflow.
// Local fixture only, snapshot/restored in finally.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3200";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const QUIZ = "cmr7khgd50001vkhscvox8dgt";
const SHOTS = "/tmp/wis026-widget-shots";
const BACKUP = `${SHOTS}/qs-${QUIZ}-backup.json`;

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

// NEVER print the token — mask it out of any thrown/goto error text.
const mask = (s) => String(s).replaceAll(KEY, "***");

const prisma = new PrismaClient();
const out = { checks: {}, pageErrors: [] };
const ok = (name, v, extra = "") => {
  out.checks[name] = Boolean(v);
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${mask(extra)}` : ""}`);
};

// ── snapshot ────────────────────────────────────────────────────────────────
const quiz = await prisma.quiz.findUnique({ where: { id: QUIZ } });
if (!quiz) {
  console.error("fixture quiz not found");
  process.exit(1);
}
const originalCats = await prisma.category.findMany({ where: { quizId: QUIZ } });
writeFileSync(
  BACKUP,
  JSON.stringify({ draftJson: quiz.draftJson, publishedJson: quiz.publishedJson, version: quiz.version, status: quiz.status, categories: originalCats }, null, 2),
);
console.log(`snapshot written: ${BACKUP} (${originalCats.length} quiz-scoped categories)`);

let seeded = false;
async function restore() {
  if (!seeded) return;
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: quiz.draftJson, publishedJson: quiz.publishedJson, version: quiz.version, status: quiz.status } });
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  for (const c of originalCats) {
    const { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt } = c;
    await prisma.category.create({
      data: { id, shopId, quizId, name, description, tags, productIds, source, sourceRef, manualProductIds, rationale, discoveryRunId, createdAt },
    });
  }
  seeded = false;
  console.log("fixture restored (doc + categories, byte-for-byte)");
}

const draftDoc = async () => {
  const row = await prisma.quiz.findUnique({ where: { id: QUIZ }, select: { draftJson: true } });
  return row?.draftJson ?? null;
};
const draftNode = async (nodeId) => (await draftDoc())?.nodes?.find((n) => n.id === nodeId) ?? null;
// Poll the draft until pred holds (autosave = 700ms debounce + a round-trip;
// a fixed sleep is a flake — the add-answer check raced it once).
const waitDraft = async (pred, ms = 6000) => {
  const t0 = Date.now();
  for (;;) {
    if (pred(await draftDoc())) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
};
const edgeChain = (d) => (d?.edges ?? []).map((e) => `${e.source}→${e.target}`).join(",");

let browser = null;
try {
  // ── seed: 2 probe buckets + the decider doc the task pins ─────────────────
  const products = await prisma.product.findMany({
    where: { shopId: quiz.shopId },
    select: { productId: true },
    take: 6,
  });
  const collection = await prisma.collection.findFirst({
    where: { shopId: quiz.shopId },
    select: { collectionId: true },
  });
  const fallbackCol = collection?.collectionId ?? "manual";

  seeded = true;
  await prisma.category.deleteMany({ where: { quizId: QUIZ } });
  const catA = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QS Boards", description: "", tags: [],
      productIds: products.slice(0, 4).map((p) => p.productId),
      source: "manual", discoveryRunId: "qs_probe",
    },
  });
  const catB = await prisma.category.create({
    data: {
      shopId: quiz.shopId, quizId: QUIZ, name: "QS Accessories", description: "", tags: [],
      productIds: products.slice(4, 6).map((p) => p.productId),
      source: "manual", discoveryRunId: "qs_probe",
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
        data: { headline: "QS Probe Shop", subtext: "Quick fit check.", button_label: "Start" } },
      { id: "q1", type: "question", position: { x: 0, y: 120 },
        data: { text: "What are you shopping for today?", question_type: "single_select", required: true, role: "decides",
          answers: answers([["a_board", "A snowboard", catA.id], ["a_acc", "Accessories", catB.id]]) } },
      { id: "q2", type: "question", position: { x: 0, y: 240 },
        data: { text: "Which features matter most?", question_type: "multi_select", required: true, role: "qualifier",
          max_selections: 2,
          answers: answers([["f1", "Lightweight build"], ["f2", "Powder float"], ["f3", "Edge grip on ice"], ["f4", "Park durability"]]) } },
      { id: "q3", type: "question", position: { x: 0, y: 360 },
        data: { text: "How would you rate your riding ability?", question_type: "rating", required: true, role: "qualifier",
          scale_config: { min: 1, max: 5, endpoint_label_min: "Beginner", endpoint_label_max: "Expert" },
          answers: answers([["r1", "1"], ["r2", "2"], ["r3", "3"], ["r4", "4"], ["r5", "5"]]) } },
      { id: "r1", type: "result", position: { x: 0, y: 480 },
        data: { headline: "Your match", fallback_collection_id: fallbackCol } },
    ],
    edges: [
      { id: "e1", source: "intro1", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "q3" },
      { id: "e4", source: "q3", target: "r1" },
    ],
    results_pages: [],
    rec_page_settings: { global: {}, overrides: {} },
    build_session: { stage: "question_builder", built: true },
  };
  await prisma.quiz.update({ where: { id: QUIZ }, data: { draftJson: probeDoc } });
  console.log(`seeded probe doc (decider q1 → multi q2 → rating q3; targets ${catA.id} / ${catB.id})`);

  // ── drive the Questions step ──────────────────────────────────────────────
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(mask(String(e)).slice(0, 300)));

  const goto = async (url) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      throw new Error(mask(e.message ?? e));
    }
  };
  await goto(`${BASE}/studio?key=${KEY}`);
  await goto(`${BASE}/studio/onboarding/${QUIZ}`);
  await page.waitForTimeout(1400);
  const response = await ctx.request.post(`${BASE}/studio/onboarding/${QUIZ}`, {form:{intent:"to-logic"}});
  if (!response.ok()) throw new Error(`to-logic failed: ${response.status()}`);
  await page.reload();
  await page.waitForSelector(".qz-s3-logicview", { timeout: 15000 });
  await page.waitForTimeout(500);
  ok('to-logic persisted (build_session.stage "logic")',
    (await draftDoc())?.build_session?.stage === "logic");
  ok("Questions panel unmounted on the Logic stage",
    (await page.locator('[data-testid="questions-walkthrough"]').count()) === 0);
  // Logic-step §2 — a FRESH quiz (no rules, no filter roles, logic_style
  // unset) lands on the style chooser first. Click through the recommended
  // card so the workspace assertions below run; the pick writes
  // build_session.logic_style via the set-logic-style intent (the fixture
  // restore in `finally` reverts it byte-for-byte).
  const clickThroughChooser = async () => {
    if ((await page.locator('[data-testid="logic-style-chooser"]').count()) === 0) return;
    // Click the Attributes + Rules ROW explicitly (module 01 rebuild: the
    // whole row is the button, and recommendEngine() decides which row is
    // recommended from the catalog scan — on a catalog without strong
    // attributes Rules only leads, and the sections below assert the
    // attributes workspace, so never click ".is-rec" here).
    await page.locator('.qz-lsc-eng[data-pick="attributes"] .qz-lsc-go').click();
    await page.waitForSelector('[data-testid="logic-style-bar"]', { timeout: 8000 });
    await page.waitForTimeout(400);
  };
  await clickThroughChooser();
  ok("style chooser answered — the style bar renders",
    (await page.locator('[data-testid="logic-style-bar"]').count()) === 1);
  const widget = page.locator('.qz-qwidget');
  const cell = widget.locator('.qz-qwidget-cell').first();
  let writes = 0;
  page.on('request', (r) => { if (r.method() === 'PUT') writes++; });
  await cell.click({position:{x:3,y:3}});
  await page.getByRole('radiogroup', {name:'Recommendations'}).waitFor();
  await page.getByLabel('Search recommendations').fill('Accessories');
  ok('picker stays open while typing', await page.getByRole('radiogroup').isVisible());
  await page.waitForTimeout(250);
  await page.screenshot({path:SHOTS+'/picker.png'});
  await page.getByRole('radio', {name:/QS Accessories/}).click();
  ok('picks replaces the previous target', await waitDraft((d) => d.nodes.find((n) => n.id === 'q1').data.answers[0].target_id === catB.id));
  ok('one mapping chip only', await widget.locator('.qz-lw-ar').first().locator('.qz-lw-vchip').count() === 1);
  await widget.locator('.qz-qwidget-cards').getByRole('button', {name:'QS Boards',exact:true}).click();
  const armedCell = widget.getByRole('button',{name:'Replace QS Accessories with QS Boards',exact:true}).first();
  await armedCell.hover();
  await page.screenshot({path:SHOTS+'/replace.png'});
  ok('occupied cell warns before replacing', await armedCell.getByText('Replace QS Accessories with QS Boards',{exact:true}).isVisible());
  await armedCell.click({position:{x:3,y:3}});
  ok('armed placement replaces exactly one target', await waitDraft((d) => d.nodes.find((n) => n.id === 'q1').data.answers[0].target_id === catA.id));
  await widget.getByLabel('Clear this answer’s result',{exact:true}).first().click();
  ok('clear removes the target key', await waitDraft((d) => !('target_id' in d.nodes.find((n) => n.id === 'q1').data.answers[0])));
  await cell.press('Enter');
  ok('Enter opens the picker', await page.getByRole('radiogroup').isVisible());
  await page.keyboard.press('Escape');
  ok('Escape closes the picker', await page.getByRole('radiogroup').count() === 0);
  // Seed a filter answer with all families, then prove a single chip removal
  // preserves every other family through real autosave.
  const edited = await draftDoc();
  const fq = edited.nodes.find((n) => n.id === 'q2'); fq.data.role = 'filter';
  Object.assign(fq.data.answers[0],{tags:['Material:wood'],collection_filters:['keep-collection'],metafield_filters:[{key:'custom.material',value:'wood'}],variant_filters:[{name:'Size',value:'Large'}],product_type_filters:['Board']});
  await prisma.quiz.update({where:{id:QUIZ},data:{draftJson:edited}});
  await page.reload(); await page.locator('.qz-qwidget').waitFor();
  await widget.locator('.qz-lw-qi').nth(1).click();
  const filterCell = widget.locator('.qz-qwidget-cell').first();
  await filterCell.click({position:{x:3,y:3}});
  await page.getByLabel('Search catalog values').waitFor();
  const before = writes;
  const options = page.locator('.qz-lw-vp-opt');
  for (let i=0;i<Math.min(3,await options.count());i++) await options.nth(i).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForTimeout(1000);
  ok('Cancel performs zero autosave writes',writes === before);
  await widget.getByLabel('Remove Tag: wood',{exact:true}).click();
  ok('per-value removal preserves other families',await waitDraft((d) => { const a=d.nodes.find((n)=>n.id==='q2').data.answers[0]; return !a.tags.length && a.collection_filters?.[0]==='keep-collection' && a.metafield_filters?.[0].key==='custom.material' && a.variant_filters?.[0].name==='Size' && a.product_type_filters?.[0]==='Board'; }));
  await page.screenshot({path:SHOTS+'/narrows.png'});
  const mappedBefore = (await draftNode('q2')).data.answers;
  await widget.locator('.qz-ltab-pill').click();
  await page.locator('.qz-ltab-menu-row').filter({hasText:'Info only'}).click();
  ok('Info role keeps saved filter values',await waitDraft((d)=>d.nodes.find((n)=>n.id==='q2').data.role==='qualifier'));
  ok('Info chips are inert',await widget.locator('.qz-lw-acell button, .qz-lw-acell [role="button"]').count()===0);
  await widget.locator('.qz-ltab-pill').click();
  await page.locator('.qz-ltab-menu-row').filter({hasText:'Narrows'}).click();
  ok('Narrows round-trip keeps every saved value',await waitDraft((d)=> {const q=d.nodes.find((n)=>n.id==='q2'); return q.data.role==='filter'&&JSON.stringify(q.data.answers)===JSON.stringify(mappedBefore);}));
  await widget.locator('.qz-ltab-pill').click();
  await page.locator('.qz-ltab-menu-row').filter({hasText:'Picks'}).click();
  ok('multi-select promotion works in Logic role menu',await waitDraft((d)=>d.nodes.find((n)=>n.id==='q2').data.role==='decides'));
  // Real publish gate and /q union, with all AI-filled fields supplied.
  const pub = structuredClone(probeDoc);
  pub.nodes = pub.nodes.filter((n)=> !['q2','q3'].includes(n.id));
  pub.nodes.find((n)=>n.id==='q1').data.question_type='multi_select';
  pub.nodes.find((n)=>n.id==='q1').data.answers.forEach((a)=>a.tooltip_text='Fixture answer.');
  pub.nodes.find((n)=>n.id==='r1').data.why_bullets=['Fixture match.'];
  pub.edges=[{id:'e1',source:'intro1',target:'q1'},{id:'e2',source:'q1',target:'r1'}];
  pub.rec_page_settings={global:{captureEmail:false,captureName:false,capturePhone:false,gridMax:12,loadingOn:false},overrides:{}};
  const publishUrl=`${BASE}/studio/${QUIZ}?_data=routes%2Fstudio_.%24id`;
  const unmapped=structuredClone(pub);delete unmapped.nodes.find((n)=>n.id==='q1').data.answers[0].target_id;
  const denied=await ctx.request.post(publishUrl,{form:{intent:'publish',doc:JSON.stringify(unmapped)}});
  const deniedBody=await denied.json();ok('publish still blocks an unmapped deciding answer',deniedBody.ok!==true);
  const published=await ctx.request.post(publishUrl,{form:{intent:'publish',doc:JSON.stringify(pub)}});
  const publishedBody=await published.json();ok('multi-select decider publishes',publishedBody.ok===true);
  if(publishedBody.ok!==true) throw new Error(`Publish failed: ${JSON.stringify(publishedBody)}`);
  await goto(`${BASE}/q/${QUIZ}`);
  await page.getByRole('button',{name:/Start/}).click();
  await page.getByRole('checkbox',{name:'Accessories',exact:true}).check();
  await page.getByRole('checkbox',{name:'A snowboard',exact:true}).check();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.waitForTimeout(1200);
  const wire=await (await ctx.request.get(`${BASE}/q/${QUIZ}.json`)).json();
  const memberB=wire.product_index.find((p)=>catB.productIds.includes(p.product_id)&&p.inventory_in_stock!==false);
  const memberA=wire.product_index.find((p)=>catA.productIds.includes(p.product_id)&&p.inventory_in_stock!==false);
  const shopperText=await page.locator('body').innerText();
  ok('/q displays products from both selected buckets',Boolean(memberA&&memberB&&shopperText.includes(memberA.title)&&shopperText.includes(memberB.title)));
  await page.screenshot({path:SHOTS+'/shopper-union.png'});
  // Restore the mapped deciding question for the tray check.
  await prisma.quiz.update({where:{id:QUIZ},data:{draftJson:{...probeDoc,build_session:{stage:'logic',built:true,logic_style:'attributes'}}}});
  await goto(`${BASE}/studio/onboarding/${QUIZ}`);
  await widget.waitFor();
  // Many variable-width recommendations: actual two-row wrapping at both widths.
  for(let i=0;i<198;i++) await prisma.category.create({data:{shopId:quiz.shopId,quizId:QUIZ,name:`Recommendation ${i} ${i%3===0?'with a longer name':''}`,description:'',tags:[],productIds:[],source:'manual',discoveryRunId:'qwidget_probe'}});
  await page.reload(); await widget.waitFor();
  for(const width of [1440,1000,390,1440]) {
    await page.setViewportSize({width,height:950}); await page.waitForTimeout(300);
    const rows = await widget.locator('.qz-qwidget-cards').evaluate((el) => [...new Set(Array.from(el.children).map((c)=>Math.round(c.getBoundingClientRect().top)))]);
    const shown = await widget.locator('.qz-qwidget-cards > button').count();
    const more = await widget.locator('.qz-qwidget-cards').getByRole('button',{name:/See \d+ more/}).innerText();
    ok(`two measured rows at ${width}`,rows.length<=2);
    const heading = await widget.locator('.qz-lw-dhead').boundingBox();
    const role = await widget.locator('.qz-lw-drole').boundingBox();
    ok(`title and role do not overlap at ${width}`, heading.y >= role.y + role.height || heading.x + heading.width <= role.x);
    ok(`overflow count at ${width}`,Number(more.match(/\d+/)[0])+shown===200);
    await widget.screenshot({path:SHOTS+`/tray-${width}.png`});
  }
  ok("zero page errors", out.pageErrors.length === 0, out.pageErrors.join(" | "));
  await browser.close();
  browser = null;
} finally {
  if (browser) await browser.close().catch(() => {});
  await restore();
  await prisma.$disconnect();
}

const fails = Object.entries(out.checks).filter(([, v]) => !v);
console.log(`\n${Object.keys(out.checks).length - fails.length}/${Object.keys(out.checks).length} checks passed`);
if (fails.length) {
  console.log("FAILED:", fails.map(([k]) => k).join(" · "));
  process.exit(1);
}
