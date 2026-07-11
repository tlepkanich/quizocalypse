import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { reportError } from "../lib/log.server";
import { FeedbackPayload } from "../lib/analytics";
import { rateLimit } from "../lib/rateLimiters";

// §L L2 — public feedback endpoint. Mirrors /captures: CORS-open, Zod at the
// boundary, shopId resolved server-side from the quiz, session_id as the bearer
// capability, rate-limited, 202. One submission per session (upsert on the
// unique index — a re-submit updates rather than 409s).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export const loader = async () => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });

  const rl = rateLimit(request, "feedback", 15);
  if (!rl.ok) {
    return new Response("rate limited", {
      status: 429,
      headers: { ...CORS, "retry-after": String(rl.retryAfterS) },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response("invalid json", { status: 400, headers: CORS });
  }

  const parsed = FeedbackPayload.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid payload", issues: parsed.error.issues.slice(0, 3) }),
      { status: 400, headers: { ...CORS, "content-type": "application/json" } },
    );
  }

  let quiz: { id: string } | null;
  try {
    quiz = await prisma.quiz.findUnique({ where: { id: parsed.data.quiz_id }, select: { id: true } });
  } catch (err) {
    reportError(err, { scope: "feedback", msg: "quiz lookup failed" });
    return new Response(JSON.stringify({ error: "lookup failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
  if (!quiz) {
    return new Response(JSON.stringify({ error: "quiz not found" }), {
      status: 404,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  try {
    await prisma.quizFeedback.upsert({
      where: { quizId_sessionId: { quizId: quiz.id, sessionId: parsed.data.session_id } },
      create: {
        quizId: quiz.id,
        sessionId: parsed.data.session_id,
        rating: parsed.data.rating,
        text: parsed.data.text ?? null,
        outcomeId: parsed.data.outcome_id ?? null,
      },
      update: {
        rating: parsed.data.rating,
        text: parsed.data.text ?? null,
      },
    });
  } catch (err) {
    reportError(err, { scope: "feedback", msg: "write failed" });
    return new Response(JSON.stringify({ error: "feedback failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...CORS, "content-type": "application/json" },
  });
};
