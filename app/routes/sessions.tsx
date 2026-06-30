import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { SessionPayload } from "../lib/analytics";
import { rateLimit } from "../lib/rateLimiters";

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
  // HII-1b — this CORS-open "My Results" GET's only DB work is a read; guard
  // ONLY the read (the await) so a DB-down lookup returns a controlled CORS+JSON
  // 500. The 404 (no row) + 200 (found) are normal returns OUTSIDE the try — so a
  // successful read can never be mislabeled a read-failure (matches the other
  // three read-guards' shape).
  let session: {
    outcomeId: string | null;
    answerIds: string[];
    matchedProductIds: string[];
    converted: boolean;
    completedAt: Date | null;
  } | null;
  try {
    session = await prisma.quizSession.findUnique({
      where: { quizId_sessionId: { quizId, sessionId } },
      select: {
        outcomeId: true,
        answerIds: true,
        matchedProductIds: true,
        converted: true,
        completedAt: true,
      },
    });
  } catch (err) {
    console.error("[sessions] session lookup failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "lookup failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
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
  // 30 upserts/min/IP — a session writes once on completion (+ resume rewrites).
  const rl = rateLimit(request, "sessions", 30);
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

  const parsed = SessionPayload.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid payload", issues: parsed.error.issues.slice(0, 3) }),
      { status: 400, headers: { ...CORS, "content-type": "application/json" } },
    );
  }

  // HII-1b — guard the lookup READ (the upsert below is already guarded); a
  // DB-down read otherwise escapes as Remix's generic un-CORS'd 500.
  let quiz: { id: string; shopId: string } | null;
  try {
    quiz = await prisma.quiz.findUnique({
      where: { id: parsed.data.quiz_id },
      select: { id: true, shopId: true },
    });
  } catch (err) {
    console.error("[sessions] quiz lookup failed:", err instanceof Error ? err.message : err);
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

  const { session_id, outcome_id, answer_ids, matched_product_ids } = parsed.data;
  // HII-1 — surface a write failure as a controlled, logged, CORS+JSON 500
  // (the runtime posts this fire-and-forget on completion, so the shopper is
  // unaffected; this is honest server-side monitoring, not a UX change).
  try {
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
  } catch (err) {
    console.error("[sessions] write failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "session save failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...CORS, "content-type": "application/json" },
  });
};
