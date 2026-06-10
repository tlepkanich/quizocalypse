import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { EventsBatch } from "../lib/analytics";
import { rateLimit } from "../lib/rateLimiters";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export const loader = async () =>
  // Respond to CORS preflight (OPTIONS via the same route hits loader for non-POST methods).
  new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }
  // 300 req/min/IP — counts REQUESTS (zod caps 50 events each; a real shopper
  // sends ≤12 req/min), so ~25 concurrent shoppers behind one NAT stay clear.
  const rl = rateLimit(request, "events", 300);
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

  const parsed = EventsBatch.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid payload", issues: parsed.error.issues.slice(0, 3) }),
      { status: 400, headers: { ...CORS, "content-type": "application/json" } },
    );
  }

  // Resolve shopId from any quiz in the batch (events should all be from the
  // same quiz, but we don't enforce that). Skip rows for unknown quizzes.
  const quizIds = [...new Set(parsed.data.events.map((e) => e.quiz_id))];
  const quizzes = await prisma.quiz.findMany({
    where: { id: { in: quizIds } },
    select: { id: true, shopId: true },
  });
  const shopByQuiz = new Map(quizzes.map((q) => [q.id, q.shopId]));

  await prisma.event.createMany({
    data: parsed.data.events
      .filter((e) => shopByQuiz.has(e.quiz_id))
      .map((e) => ({
        quizId: e.quiz_id,
        shopId: shopByQuiz.get(e.quiz_id) ?? null,
        sessionId: e.session_id,
        eventType: e.event_type,
        payload: (e.payload ?? {}) as never,
        ...(e.ts ? { ts: new Date(e.ts) } : {}),
      })),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...CORS, "content-type": "application/json" },
  });
};
