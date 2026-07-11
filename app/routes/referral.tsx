import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import prisma from "../db.server";
import { reportError } from "../lib/log.server";
import { rateLimit } from "../lib/rateLimiters";
import { Quiz } from "../lib/quizSchema";
import { EngagementSettings, resolveEngagement } from "../lib/engagementSchema";
import { referralToken, isSelfReferral, capReached } from "../lib/referral";

// §M6 — public referral endpoint. Two intents:
//  • mint  — the referrer's result mints their stable share token (E5) + link.
//  • redeem — a friend arriving via ?ref=TOKEN records the attribution (pending).
// Both rewards are granted later, at the friend's QUALIFYING ORDER (the Shopify
// order webhook), NOT on click — the fraud guard the spec requires. CORS-open,
// rate-limited, Zod at boundary.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const ReferralRequest = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("mint"), quiz_id: z.string().min(1), session_id: z.string().min(1), email: z.string().email().optional() }),
  z.object({
    intent: z.literal("redeem"),
    quiz_id: z.string().min(1),
    session_id: z.string().min(1),
    token: z.string().min(1),
    email: z.string().email().optional(),
  }),
]);

export const loader = async () => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const rl = rateLimit(request, "referral", 20);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { ...CORS, "content-type": "application/json", "retry-after": String(rl.retryAfterS) },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const parsed = ReferralRequest.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid payload" }, 400);
  const data = parsed.data;

  let quiz;
  try {
    quiz = await prisma.quiz.findUnique({
      where: { id: data.quiz_id },
      select: { id: true, publishedJson: true, shop: { select: { engagementDefaults: true } } },
    });
  } catch (err) {
    reportError(err, { scope: "referral", msg: "quiz lookup failed" });
    return json({ error: "lookup failed" }, 500);
  }
  if (!quiz?.publishedJson) return json({ error: "quiz not found" }, 404);

  const parsedDoc = Quiz.safeParse(quiz.publishedJson);
  const accountParsed = EngagementSettings.safeParse(quiz.shop?.engagementDefaults ?? {});
  const referral = resolveEngagement(
    parsedDoc.success ? parsedDoc.data.engagement : undefined,
    accountParsed.success ? accountParsed.data : undefined,
  ).referral;
  if (!referral.enabled) return json({ referral: null }); // not offered on this quiz

  // ── mint — the referrer's shareable token (idempotent, deterministic). ──────
  if (data.intent === "mint") {
    const token = referralToken(quiz.id, data.session_id);
    try {
      await prisma.referralToken.upsert({
        where: { quizId_sessionId: { quizId: quiz.id, sessionId: data.session_id } },
        create: { token, quizId: quiz.id, sessionId: data.session_id, email: data.email ?? null },
        update: data.email ? { email: data.email } : {},
      });
    } catch (err) {
      reportError(err, { scope: "referral", msg: "mint failed" });
      return json({ error: "mint failed" }, 500);
    }
    const origin = new URL(request.url).origin;
    return json({ token, link: `${origin}/q/${quiz.id}?ref=${token}` });
  }

  // ── redeem — a friend arriving via the link (record the pending attribution). ─
  const ref = await prisma.referralToken.findUnique({ where: { token: data.token } });
  // Unknown token, or a token from a DIFFERENT quiz → ignore (no error leak).
  if (!ref || ref.quizId !== quiz.id) return json({ referral: null });
  // Fraud guard: a referrer can't redeem their own link.
  if (ref.sessionId === data.session_id || isSelfReferral(ref.email, data.email)) {
    return json({ referral: null, reason: "self_referral" });
  }
  // Fraud guard: redemption cap per referrer.
  const redemptions = await prisma.referral.count({ where: { tokenValue: data.token } });
  if (capReached(redemptions, referral.redemptionCap)) {
    return json({ referral: null, reason: "cap_reached" });
  }

  try {
    // Single-use per redeemer via the unique index; a repeat is a no-op success.
    await prisma.referral.upsert({
      where: { tokenValue_redeemerSessionId: { tokenValue: data.token, redeemerSessionId: data.session_id } },
      create: { quizId: quiz.id, tokenValue: data.token, redeemerSessionId: data.session_id, redeemerEmail: data.email ?? null, status: "pending" },
      update: data.email ? { redeemerEmail: data.email } : {},
    });
  } catch (err) {
    reportError(err, { scope: "referral", msg: "redeem failed" });
    return json({ error: "redeem failed" }, 500);
  }
  // Both rewards are granted at the friend's qualifying order (Shopify webhook).
  return json({ referral: { status: "pending" } });
};
