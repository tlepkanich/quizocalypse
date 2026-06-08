import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { SessionPayload } from "../lib/analytics";

// Server-side quiz session write (Dev Spec §7.2). Storefront-origin POST, so it
// carries the same permissive CORS as /captures. Upserts one row per
// (quizId, sessionId): the runtime posts it once on completion. Never trusts the
// client for shopId — it's resolved from the quiz row.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

// GET ?quiz_id=&session_id= → the shopper's saved session (cross-device "My
// Results" read). session_id is an unguessable capability token, so no other
// auth; only non-PII fields are returned. With no params it's the POST's CORS
// preflight no-op.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const quizId = url.searchParams.get("quiz_id");
  const sessionId = url.searchParams.get("session_id");
  if (!quizId || !sessionId) {
    return new Response(null, { status: 204, headers: CORS });
  }
  const session = await prisma.quizSession.findUnique({
    where: { quizId_sessionId: { quizId, sessionId } },
    select: {
      outcomeId: true,
      answerIds: true,
      matchedProductIds: true,
      converted: true,
      completedAt: true,
    },
  });
  if (!session) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, session }), {
    status: 200,
    headers: { ...CORS, "content-type": "application/json" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response("invalid json", { status: 400, headers: CORS });
  }

  const parsed = SessionPayload.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid payload", issues: parsed.error.issues.slice(0, 3) }),
      { status: 400, headers: { ...CORS, "content-type": "application/json" } },
    );
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: parsed.data.quiz_id },
    select: { id: true, shopId: true },
  });
  if (!quiz) {
    return new Response(JSON.stringify({ error: "quiz not found" }), {
      status: 404,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  const { session_id, outcome_id, answer_ids, matched_product_ids } = parsed.data;
  await prisma.quizSession.upsert({
    where: { quizId_sessionId: { quizId: quiz.id, sessionId: session_id } },
    create: {
      quizId: quiz.id,
      shopId: quiz.shopId,
      sessionId: session_id,
      outcomeId: outcome_id ?? null,
      answerIds: answer_ids,
      matchedProductIds: matched_product_ids,
      completedAt: new Date(),
    },
    update: {
      outcomeId: outcome_id ?? null,
      answerIds: answer_ids,
      matchedProductIds: matched_product_ids,
      completedAt: new Date(),
    },
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...CORS, "content-type": "application/json" },
  });
};
