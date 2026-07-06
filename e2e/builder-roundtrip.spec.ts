import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { buildTemplateQuiz } from "../app/lib/quizTemplates";
import { STANDALONE_MINIMAL_TOKENS } from "../app/lib/themePresets";
import { Quiz as QuizSchema, type Quiz as QuizDoc } from "../app/lib/quizSchema";

// BIC-2 D1 — builder round-trip regression lock: draft edit → publish → serve.
//
// The standalone studio deliberately exposes NO quiz-create-without-AI and NO
// quiz-delete over HTTP (studio.new is redirect-gated behind
// SHOW_OTHER_BUILD_PATHS=false; prisma.quiz.delete exists only on the embedded
// Shopify-auth surface). So the live leg reuses ONE dedicated, permanently
// named fixture quiz ("e2e-roundtrip-fixture") instead of creating/deleting
// per run — zero gallery growth by construction. The full create→delete
// lifecycle runs in the LOCAL leg, where prisma is available (RT_LOCAL=1).
//
// AI-cost discipline: publish bakes "why" bullets + answer tooltips via Claude
// for any node missing them — every doc this spec writes carries them
// pre-filled, so publish is verifiably AI-free (fills-only-empty contract in
// quizPublish.ts). No other AI intent is touched.
//
// Cleanup discipline (live deploy = production):
//   - writes only to the fixture, guarded by a name-prefix check that runs
//     BEFORE the first write — a mispointed SMOKE_RT_QUIZ can't be touched;
//   - the draft doc is restored from a snapshot in `finally`;
//   - the gallery count is asserted unchanged after the run.
//
// Skips (like the analytics smoke test) when STUDIO_ACCESS_TOKEN is unset —
// GitHub CI's post-deploy smoke has no studio secret today, so there it skips;
// ship.sh runs it with the full env. See e2e/README.md for the env contract
// and the fixture re-bootstrap procedure (RT_BOOTSTRAP=1, bottom of this file).

const TOKEN = process.env.STUDIO_ACCESS_TOKEN;
// The dedicated live fixture (bootstrapped 2026-07-07 via RT_BOOTSTRAP — see
// the last test in this file). Override with SMOKE_RT_QUIZ for other envs.
const RT_QUIZ = process.env.SMOKE_RT_QUIZ || "cmr9gir030026oml1e0v5rwij";
const RT_NAME_PREFIX = "e2e-roundtrip";

const builderData = (id: string) => `/studio/${id}?_data=routes%2Fstudio_.%24id`;
const GALLERY_DATA = "/studio/quizzes?_data=routes%2Fstudio.quizzes";

type BuilderData = {
  quizId: string;
  name: string;
  status: string;
  version: number;
  valid: boolean;
  doc: QuizDoc | null;
  collections: Array<{ collectionId: string; title: string }>;
};

async function authenticate(page: Page) {
  // The ?key= visit sets the signed studio cookie on the context; every
  // subsequent page/request call rides it. Never log the token.
  await page.goto(`/studio?key=${TOKEN}`, { waitUntil: "domcontentloaded" });
}

async function readBuilder(req: APIRequestContext, id: string): Promise<BuilderData | null> {
  const r = await req.get(builderData(id));
  if (r.status() === 404) return null;
  expect(r.ok(), `builder loader ${r.status()} for ${id}`).toBeTruthy();
  return (await r.json()) as BuilderData;
}

async function galleryCount(req: APIRequestContext): Promise<number> {
  const r = await req.get(GALLERY_DATA);
  expect(r.ok(), `gallery loader ${r.status()}`).toBeTruthy();
  const data = (await r.json()) as { quizzes: Array<{ id: string }> };
  return data.quizzes.length;
}

// The autosave contract the builder's useQuizDraft uses: PUT application/json
// { doc } — Quiz.safeParse-gated server-side.
async function putDoc(req: APIRequestContext, id: string, doc: QuizDoc) {
  const r = await req.put(builderData(id), {
    headers: { "content-type": "application/json" },
    data: { doc },
  });
  const body = (await r.json()) as { ok: boolean; issues?: unknown };
  expect(body.ok, `autosave PUT rejected: ${JSON.stringify(body.issues ?? body)}`).toBe(true);
}

// The real publish intent, mirroring the client contract (doc field = the live
// doc, so a publish racing a pending autosave still bakes the latest edit).
async function publish(req: APIRequestContext, id: string, doc: QuizDoc): Promise<number> {
  const r = await req.post(builderData(id), {
    form: { intent: "publish", doc: JSON.stringify(doc) },
  });
  const body = (await r.json()) as { ok: boolean; version?: number; error?: string };
  expect(body.ok, `publish failed: ${body.error ?? ""}`).toBe(true);
  return body.version ?? -1;
}

// Both serving surfaces must carry the marker: the SSR'd /q HTML and the
// published /q/:id.json wire doc.
async function expectServed(req: APIRequestContext, id: string, marker: string) {
  const html = await (await req.get(`/q/${id}`)).text();
  expect(html, `/q/${id} HTML missing "${marker}"`).toContain(marker);
  const wire = await (await req.get(`/q/${id}.json`)).text();
  expect(wire, `/q/${id}.json missing "${marker}"`).toContain(marker);
}

// Pre-fill the two things publish would otherwise generate with Claude
// (fills-only-empty in quizPublish.ts) so publishing this doc is AI-free.
function prefillAiBakes(doc: QuizDoc): QuizDoc {
  const nodes = doc.nodes.map((n): QuizDoc["nodes"][number] => {
    if (n.type === "question") {
      return {
        ...n,
        data: {
          ...n.data,
          answers: n.data.answers.map((a) => ({
            ...a,
            tooltip_text: a.tooltip_text || "A solid fit if this sounds like you.",
          })),
        },
      };
    }
    if (n.type === "result") {
      return {
        ...n,
        data: {
          ...n.data,
          why_bullets: n.data.why_bullets.length
            ? n.data.why_bullets
            : ["Matched to your answers by the quiz logic."],
        },
      };
    }
    return n;
  });
  return { ...doc, nodes };
}

function withIntroHeadline(doc: QuizDoc, headline: string): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.type === "intro" ? { ...n, data: { ...n.data, headline } } : n)),
  };
}

function introHeadlineOf(doc: QuizDoc | null | undefined): string {
  const intro = doc?.nodes.find((n) => n.type === "intro");
  return intro && intro.type === "intro" ? intro.data.headline : "";
}

// ── The round-trip lock (runs wherever STUDIO_ACCESS_TOKEN is set) ──────────
test("builder round-trip: draft edit → publish → serve on the dedicated fixture", async ({
  page,
}) => {
  test.skip(!TOKEN, "STUDIO_ACCESS_TOKEN not set");
  test.setTimeout(150_000);
  await authenticate(page);
  const req = page.context().request;

  const before = await readBuilder(req, RT_QUIZ);
  test.skip(
    !before,
    `round-trip fixture ${RT_QUIZ} not found on this deploy — re-bootstrap per e2e/README.md`,
  );
  if (!before) return;
  // HARD WRITE-GUARD: refuse to touch anything not named as the fixture. This
  // runs before the first write, so a mispointed SMOKE_RT_QUIZ (or a renamed
  // fixture) can never mutate a real quiz.
  expect(
    before.name.startsWith(RT_NAME_PREFIX),
    `refusing to write: quiz ${RT_QUIZ} is named "${before.name}", not "${RT_NAME_PREFIX}*"`,
  ).toBeTruthy();
  expect(before.valid && before.doc !== null, "fixture draft doc failed Quiz.parse").toBeTruthy();
  const snapshot = before.doc as QuizDoc;

  const galleryBefore = await galleryCount(req);
  const nonce = Date.now().toString(36);
  const baseHeadline = `E2E round-trip base ${nonce}`;
  const editedHeadline = `E2E round-trip edited ${nonce}`;

  try {
    // 1 — PUT a deterministic base doc (the autosave contract) and publish it.
    const baseDoc = withIntroHeadline(prefillAiBakes(snapshot), baseHeadline);
    await putDoc(req, RT_QUIZ, baseDoc);
    const v1 = await publish(req, RT_QUIZ, baseDoc);
    await expectServed(req, RT_QUIZ, baseHeadline);

    // 2 — ONE deterministic edit through the REAL builder UI: the BLD-2b
    // inline canvas edit (click selects, dblclick starts a contenteditable
    // session, Enter commits through the normal doc-commit seam + autosave).
    await page.goto(`/studio/${RT_QUIZ}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".qz-builder", { timeout: 20_000 });
    await page.waitForTimeout(1500); // hydration settle (builderv3 probe precedent)
    const head = page.locator(".qz-builder-canvas h1, .qz-builder-canvas h2").first();
    await expect(head, "canvas should show the published base headline").toHaveText(baseHeadline);
    await head.click();
    const sel = page.locator(".qz-insp-sel").first();
    await sel.dblclick();
    expect(
      await sel.evaluate((el) => el instanceof HTMLElement && el.isContentEditable),
      "dblclick should start the inline edit",
    ).toBeTruthy();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(editedHeadline, { delay: 15 });
    await page.keyboard.press("Enter"); // commits (startInlineTextEdit)
    await page.waitForTimeout(2000); // 700ms autosave debounce + PUT round-trip

    const afterEdit = await readBuilder(req, RT_QUIZ);
    expect(introHeadlineOf(afterEdit?.doc), "inline edit must land in the draft").toBe(
      editedHeadline,
    );

    // Draft-vs-published isolation: the edit must NOT serve until publish.
    await expectServed(req, RT_QUIZ, baseHeadline);

    // 3 — publish the edit through the real intent; the edit must serve.
    const editedDoc = afterEdit?.doc as QuizDoc;
    const v2 = await publish(req, RT_QUIZ, editedDoc);
    expect(v2, "publish must mint a new version").toBeGreaterThan(v1);
    await expectServed(req, RT_QUIZ, editedHeadline);
  } finally {
    // Restore the draft snapshot so the fixture is stable between runs (the
    // published page keeps the last run's marker — it's a dedicated fixture).
    await putDoc(req, RT_QUIZ, snapshot).catch(() => {});
  }

  // No gallery growth: the round trip must not have created or deleted quizzes.
  expect(await galleryCount(req), "gallery count changed across the round trip").toBe(
    galleryBefore,
  );
});

// ── Full lifecycle: create → edit → publish → serve → delete (LOCAL only) ───
// The real create/delete intents are unreachable on the standalone surface
// (see the header), so the row lifecycle is driven with prisma exactly the way
// the flag-gated /studio/new template intent would create it — which also
// gives the otherwise-uncovered quizTemplates library a publish/serve lock.
// Opt in with RT_LOCAL=1 against a local prod build (never the live deploy).
test("builder round-trip: full create → edit → publish → serve → delete (local prod build)", async ({
  page,
}) => {
  test.skip(process.env.RT_LOCAL !== "1", "local lifecycle: opt in with RT_LOCAL=1");
  test.skip(!TOKEN, "STUDIO_ACCESS_TOKEN not set");
  const base = process.env.SMOKE_BASE ?? "";
  test.skip(
    !/localhost|127\.0\.0\.1/.test(base),
    "RT_LOCAL runs only against a local prod build (SMOKE_BASE=http://localhost:PORT)",
  );
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");
  test.setTimeout(120_000);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  let quizId: string | null = null;
  try {
    // Resolve the shop the studio surface manages (mirrors resolveStudioShop).
    const domain = process.env.DEV_SHOP_DOMAIN;
    const shop =
      process.env.STUDIO_MODE === "standalone" || !domain
        ? await prisma.shop.findUnique({ where: { shopDomain: "studio.local" } })
        : await prisma.shop.findUnique({ where: { shopDomain: domain } });
    expect(shop, "no studio shop in the local DB").toBeTruthy();
    if (!shop) return;

    // Pre-run sweep: leftovers from crashed earlier runs (belt-and-suspenders).
    await prisma.quiz.deleteMany({
      where: { shopId: shop.id, name: { startsWith: "e2e-roundtrip-run-" } },
    });

    await authenticate(page);
    const req = page.context().request;
    const galleryBefore = await galleryCount(req);

    // CREATE — the exact row the /studio/new `template` intent builds.
    const firstCollection = await prisma.collection.findFirst({
      where: { shopId: shop.id },
      select: { collectionId: true },
    });
    const { doc } = buildTemplateQuiz("skincare", firstCollection?.collectionId ?? "");
    const nonce = Date.now().toString(36);
    const marker = `E2E local round-trip ${nonce}`;
    const created = await prisma.quiz.create({
      data: {
        shopId: shop.id,
        name: `e2e-roundtrip-run-${nonce}`,
        status: "draft",
        draftJson: {
          ...prefillAiBakes(doc),
          design_tokens: STANDALONE_MINIMAL_TOKENS,
        } as never,
      },
      select: { id: true },
    });
    quizId = created.id;

    // EDIT (autosave PUT) → PUBLISH (real intent) → SERVE.
    const loaded = await readBuilder(req, quizId);
    expect(loaded?.valid && loaded.doc !== null, "created template failed Quiz.parse").toBeTruthy();
    const edited = withIntroHeadline(loaded?.doc as QuizDoc, marker);
    await putDoc(req, quizId, edited);
    await publish(req, quizId, edited);
    await expectServed(req, quizId, marker);

    // DELETE + no gallery pollution.
    await prisma.quiz.delete({ where: { id: quizId } });
    quizId = null;
    expect(await galleryCount(req), "gallery count changed across the lifecycle").toBe(
      galleryBefore,
    );
  } finally {
    if (quizId) await prisma.quiz.delete({ where: { id: quizId } }).catch(() => {});
    await prisma.$disconnect();
  }
});

// ── Fixture bootstrap (manual, one-time; RT_BOOTSTRAP=1) ────────────────────
// Creates the dedicated live fixture through the only HTTP create path the
// standalone surface has (the funnel front door), then bakes the skincare
// template over it, names it, graduates it into the gallery, and publishes a
// baseline. Prints the id to pin above. Refuses to claim a non-pristine draft,
// so an owner's in-flight funnel work can never be hijacked.
test("bootstrap the dedicated round-trip fixture (manual)", async ({ page }) => {
  test.skip(process.env.RT_BOOTSTRAP !== "1", "manual bootstrap: opt in with RT_BOOTSTRAP=1");
  test.skip(!TOKEN, "STUDIO_ACCESS_TOKEN not set");
  test.setTimeout(120_000);
  await authenticate(page);
  const req = page.context().request;

  // Front door WITHOUT following the redirect: the nested funnel loader kicks
  // the web-research prefetch (an AI-adjacent side effect) — don't run it.
  const front = await req.get("/studio/onboarding", { maxRedirects: 0 });
  expect(front.status(), "front door should 302 to the draft").toBe(302);
  const id = (front.headers()["location"] ?? "").split("/").pop() ?? "";
  expect(id, "no draft id in the front-door redirect").toBeTruthy();

  // Only claim a PRISTINE fresh draft — never the owner's in-flight work.
  const fresh = await readBuilder(req, id);
  const stage = fresh?.doc?.build_session?.stage;
  expect(
    fresh?.name === "New quiz" && fresh.status === "draft" && stage === "grouping",
    `front door returned a non-pristine draft ("${fresh?.name}" @ ${stage ?? "?"}) — finish or graduate it first, then re-run`,
  ).toBeTruthy();

  // Bake the skincare template over it. build_session stays "done/built" so
  // the funnel GRADUATES it (never resumes it); AI bakes pre-filled so the
  // baseline publish (and every future round-trip publish) is AI-free.
  const fb = fresh?.collections[0]?.collectionId ?? "";
  const { doc } = buildTemplateQuiz("skincare", fb);
  const fixtureDoc = QuizSchema.parse({
    ...prefillAiBakes(doc),
    quiz_id: id,
    design_tokens: STANDALONE_MINIMAL_TOKENS,
    build_session: { stage: "done", built: true },
  });
  await putDoc(req, id, fixtureDoc);

  // Name it — the round-trip test's write-guard keys on this prefix.
  const rn = await req.post(builderData(id), {
    form: { intent: "rename", name: "e2e-roundtrip-fixture" },
  });
  expect(((await rn.json()) as { ok: boolean }).ok).toBe(true);

  // Graduate it into the gallery (the front door graduates built drafts; the
  // fresh bare draft this GET mints is exactly what a merchant gets anyway).
  await req.get("/studio/onboarding", { maxRedirects: 0 });

  // Baseline publish + serve proof.
  await publish(req, id, fixtureDoc);
  await expectServed(req, id, introHeadlineOf(fixtureDoc));

  console.log(`\nROUND-TRIP FIXTURE READY: ${id} — pin as RT_QUIZ in e2e/builder-roundtrip.spec.ts\n`);
});
