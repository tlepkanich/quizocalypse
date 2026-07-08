// DGN-1 verify — brand-derived design tokens seed newly created funnel drafts.
// LOCAL prod build (BASE env) + local DB shop cmpnytxce… (quizocalypse.myshopify.com),
// driving the REAL studio funnel front door + set-design intent over HTTP.
//
// Proves:
//   A. With a brand identity present, the front door's findOrCreateStep1Draft
//      seeds the new draft's design_tokens from brandIdentity.derived_tokens —
//      template_id "brand" + the store's real primary color — NOT house Linen.
//   B. The Design-stage "Your brand" card's set-design switch replaces the pack
//      wholesale (template_id flips away from "brand").
//   C. With NO brand identity, a new draft falls back to HOUSE_TOKENS exactly as
//      before (dual-model: legacy behavior byte-identical).
//
// Seed/restore discipline: shop.brandIdentity backed up + restored; the fixture
// draft's buildState is parked to null for the run (so the front door CREATES
// rather than resumes) and restored; every draft this probe creates is deleted.
//
// Run:  set -a; source .env; set +a; BASE=http://localhost:3000 \
//       node e2e/dgn1-verify.mjs
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.STUDIO_ACCESS_TOKEN;
const SHOP = "cmpnytxce0000vk7yykbx8srg"; // quizocalypse.myshopify.com (local dev)
const FIXTURE = "cmr7khgd50001vkhscvox8dgt"; // the local step1 draft (parked)

if (!KEY) {
  console.error("STUDIO_ACCESS_TOKEN missing — source .env first");
  process.exit(1);
}

const prisma = new PrismaClient();
const results = {};
let failed = 0;
const ok = (name, v, extra = "") => {
  results[name] = v;
  if (!v) failed++;
  console.log(`${v ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// A valid BrandIdentity blob with a distinctive dark derived-tokens pack.
const PROBE_PRIMARY = "#123456";
const PROBE_IDENTITY = {
  schema_version: 1,
  summary: "DGN-1 probe brand — distinctive dark pack.",
  design: {
    derived_tokens: {
      colors: {
        primary: PROBE_PRIMARY,
        secondary: "#654321",
        accent: "#2dd4bf",
        background: "#0C1018",
        text: "#E9EEF7",
        muted: "#8B95A7",
      },
      typography: {
        heading: { family: "Geist", source: "google", weight: 600 },
        body: { family: "Geist", source: "google", base_size: 16, scale_ratio: 1.25 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
      shadow: "elevated",
    },
  },
  positioning: {},
  updated_at: "2026-07-08T00:00:00.000Z",
};

// The `?key=` break-glass first redirects to strip the key + set a session
// cookie; the front door's draft redirect only happens on the authed follow-up.
// Grab the cookie once, then reuse it for the funnel POST too.
let studioCookie = "";

// Hit the front door with the studio cookie → follow redirects until the draft
// path (/studio/onboarding/:id) appears → return the freshly created draft id.
async function createDraftViaFrontDoor() {
  let url = `${BASE}/studio/onboarding?key=${encodeURIComponent(KEY)}`;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: studioCookie ? { cookie: studioCookie } : {},
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) studioCookie = setCookie.split(";")[0];
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`front door did not redirect (status ${res.status})`);
    const m = loc.match(/\/studio\/onboarding\/([^/?#]+)/);
    if (m) return m[1];
    url = loc.startsWith("http") ? loc : `${BASE}${loc}`;
  }
  throw new Error("front door never reached a draft path");
}

async function readTokens(quizId) {
  const q = await prisma.quiz.findUnique({ where: { id: quizId }, select: { draftJson: true } });
  return q?.draftJson?.design_tokens ?? null;
}

async function main() {
  const backup = await prisma.shop.findUnique({
    where: { id: SHOP },
    select: { brandIdentity: true },
  });
  const fixture = await prisma.quiz.findUnique({
    where: { id: FIXTURE },
    select: { buildState: true },
  });
  const createdIds = [];

  try {
    // Park the fixture so the front door creates instead of resuming it.
    await prisma.quiz.update({ where: { id: FIXTURE }, data: { buildState: null } });

    // ── A: brand identity present → brand-seeded tokens ──
    await prisma.shop.update({ where: { id: SHOP }, data: { brandIdentity: PROBE_IDENTITY } });
    const aId = await createDraftViaFrontDoor();
    createdIds.push(aId);
    const aTokens = await readTokens(aId);
    ok("A: draft created with brand template_id", aTokens?.template_id === "brand", aTokens?.template_id);
    ok(
      "A: primary color is the store's brand color",
      aTokens?.colors?.primary === PROBE_PRIMARY,
      aTokens?.colors?.primary,
    );
    ok(
      "A: background carried from derived pack (not Linen cream)",
      aTokens?.colors?.background === "#0C1018",
      aTokens?.colors?.background,
    );

    // ── B: set-design switch replaces the pack (template_id flips away) ──
    const switchTokens = {
      colors: {
        primary: "#111111",
        secondary: "#4B5563",
        accent: "#2563EB",
        background: "#FFFFFF",
        text: "#0F1115",
        muted: "#6B7280",
      },
      typography: {
        heading: { family: "Inter", source: "google", weight: 600 },
        body: { family: "Inter", source: "google", base_size: 16, scale_ratio: 1.2 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
      shadow: "soft",
      template_id: "minimal",
    };
    const body = new URLSearchParams({
      intent: "set-design",
      tokens: JSON.stringify(switchTokens),
      scope: "quiz",
    });
    const switchRes = await fetch(`${BASE}/studio/onboarding/${aId}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(studioCookie ? { cookie: studioCookie } : {}),
      },
      body,
    });
    ok("B: set-design intent accepted", switchRes.ok, `status ${switchRes.status}`);
    const bTokens = await readTokens(aId);
    ok("B: switching away from brand works", bTokens?.template_id === "minimal", bTokens?.template_id);

    // ── C: no brand identity → HOUSE_TOKENS fallback ──
    await prisma.quiz.delete({ where: { id: aId } }); // remove so the next front door creates fresh
    createdIds.splice(createdIds.indexOf(aId), 1);
    await prisma.shop.update({ where: { id: SHOP }, data: { brandIdentity: null } });
    const cId = await createDraftViaFrontDoor();
    createdIds.push(cId);
    const cTokens = await readTokens(cId);
    ok("C: no template_id (untouched house seed)", cTokens?.template_id === undefined, String(cTokens?.template_id));
    ok("C: primary is Linen ink", cTokens?.colors?.primary === "#1B1A17", cTokens?.colors?.primary);
    ok("C: background is Linen cream", cTokens?.colors?.background === "#F8F6F1", cTokens?.colors?.background);
  } finally {
    for (const id of createdIds) {
      await prisma.quiz.delete({ where: { id } }).catch(() => {});
    }
    await prisma.shop.update({
      where: { id: SHOP },
      data: { brandIdentity: backup?.brandIdentity ?? null },
    });
    await prisma.quiz.update({
      where: { id: FIXTURE },
      data: { buildState: fixture?.buildState ?? "step1" },
    });
    await prisma.$disconnect();
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${Object.keys(results).length - failed}/${Object.keys(results).length} checks`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("probe error:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
