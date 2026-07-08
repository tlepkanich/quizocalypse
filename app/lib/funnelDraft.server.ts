// BIC-2 C3b — the funnel's shared draft plumbing: the resume-or-seed front
// door, the owned-draft loader, and the re-parse-before-write helper. Split
// out of step1Funnel.server.ts as a pure move; funnelLoader.server.ts and
// funnelIntents.server.ts build on these.
import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { Quiz, BuildSession } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { brandSeedTokens } from "./brandSeed";

// Builder Re-work Step 1 — the funnel's loader + action, lifted out of the route
// so the studio (cookie) and embedded (Shopify admin) routes are thin wrappers
// over ONE shop-scoped implementation. Mirrors the `*ForShop` editor-IO seam:
// each route resolves its own shop + builder URL, the logic lives here.

// Minimum goal characters before the merchant can generate. Shared by the action
// (the gate) and the component (the QzProgress bar, via loader data).
export const MIN_GOAL_CHARS = 24;

export type FunnelShop = Pick<Shop, "id" | "shopDomain">;

// The funnel's front door: resume the most-recent in-flight Step-1 draft for this
// shop, or seed a fresh one. Returns the quiz id; each entry route redirects to
// its own nested funnel path (/studio/onboarding/:id or /app/onboarding/:id).
export async function findOrCreateStep1Draft(shopId: string): Promise<string> {
  // Resume the most recent GENUINELY in-flight funnel draft. A step1 draft whose
  // build already completed (session.built) or that reached a terminal stage is a
  // finished quiz that didn't graduate — graduate it now (buildState → null, so it
  // leaves the funnel + appears in the gallery) and keep looking. This both fixes
  // the "Create new quiz drops you back in the builder" bug and self-heals any
  // pre-existing stuck drafts.
  const candidates = await prisma.quiz.findMany({
    where: { shopId, buildState: "step1" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, draftJson: true },
    take: 24,
  });
  let resumeId: string | null = null;
  for (const c of candidates) {
    const parsed = Quiz.safeParse(c.draftJson);
    const session = parsed.success ? parsed.data.build_session : undefined;
    const finished = session?.built === true || session?.stage === "done" || session?.stage === "generate";
    if (finished) {
      // Graduate EVERY finished draft (not just the newest), so a finished quiz
      // sitting behind a newer in-flight one still leaves the funnel + shows up in
      // the gallery.
      await prisma.quiz
        .update({ where: { id: c.id }, data: { buildState: null } })
        .catch(() => {});
    } else if (!resumeId) {
      resumeId = c.id; // the newest genuinely mid-funnel draft → resume it
    }
  }
  if (resumeId) return resumeId;

  // DGN-1 — seed the draft's design from the shop's brand identity so an
  // AI-generated quiz comes out looking like the store, not the house "Linen"
  // theme. Best-effort: the identity is built detached at install and may be
  // absent/building/errored here — brandSeedTokens returns null in every such
  // case and the draft falls back to HOUSE_TOKENS, byte-identical to before.
  const shopRow = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { brandIdentity: true },
  });
  const brandTokens = brandSeedTokens(parseBrandIdentitySafe(shopRow?.brandIdentity));

  // LOGIC v2 (L2-10d) — every NEW funnel draft is a DECIDER doc from creation
  // (the stamp is never applied retroactively; in-flight pre-flip drafts
  // resume as legacy with today's exact behavior — every consumer keys off
  // the stamp, never off deploy time).
  const doc = Quiz.parse({
    ...buildSeedQuiz("New quiz"),
    ...(brandTokens ? { design_tokens: brandTokens } : {}),
    logic_model: "decider",
    build_session: { stage: "grouping" },
  });
  const created = await prisma.quiz.create({
    data: {
      shopId,
      name: "New quiz",
      status: "draft",
      buildState: "step1",
      draftJson: doc as never,
    },
    select: { id: true },
  });
  return created.id;
}

// Load the owned draft + its parsed doc + build_session. Throws a 404 Response
// when the quiz isn't this shop's (or doesn't parse).
export async function loadFunnelDraft(shopId: string, quizId: string | undefined) {
  if (!quizId) throw new Response("Not found", { status: 404 });
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, shopId },
    select: { id: true, name: true, draftJson: true, buildState: true, updatedAt: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  const parsed = Quiz.safeParse(quiz.draftJson);
  if (!parsed.success) throw new Response("Draft is not readable", { status: 422 });
  // BuildSession.parse({}) fills every default (stage:"grouping" + all arrays),
  // so this stays correct as Step-2 fields accrete.
  const session: BuildSession = parsed.data.build_session ?? BuildSession.parse({});
  return { quiz, doc: parsed.data, session };
}

// Re-parse before writing so an invalid mutation can never land (build_session is
// scratch state — we write draftJson directly, no publish path).
export async function writeDoc(quizId: string, doc: Quiz) {
  await prisma.quiz.update({
    where: { id: quizId },
    data: { draftJson: Quiz.parse(doc) as never },
  });
}
