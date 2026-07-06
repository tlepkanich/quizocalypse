import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { reportError } from "../lib/log.server";
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
  // HII-1b — guard the lookup READ (the createMany below is already guarded); a
  // DB-down read otherwise escapes as Remix's generic un-CORS'd 500.
  let quizzes: { id: string; shopId: string }[];
  try {
    quizzes = await prisma.quiz.findMany({
      where: { id: { in: quizIds } },
      select: { id: true, shopId: true },
    });
  } catch (err) {
    reportError(err, { scope: "events", msg: "quiz lookup failed" });
    return new Response(JSON.stringify({ error: "lookup failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
  const shopByQuiz = new Map(quizzes.map((q) => [q.id, q.shopId]));

  // HII-1 — surface a write failure as a controlled, logged, CORS+JSON 500
  // (analytics is posted fire-and-forget via sendBeacon / void-fetch, so the
  // shopper never sees this; it's honest server-side monitoring instead of an
  // unhandled, un-CORS'd throw).
  try {
    await prisma.event.createMany({
      data: parsed.data.events
        .filter((e) => shopByQuiz.has(e.quiz_id))
        // order_attributed is SERVER-ONLY (written by the orders/create webhook
        // straight through Prisma). It shares the EventType enum so the Event
        // table stays one list, but the public boundary drops it — otherwise a
        // hostile client could spoof revenue into the dashboard.
        .filter((e) => e.event_type !== "order_attributed")
        .map((e) => ({
          quizId: e.quiz_id,
          shopId: shopByQuiz.get(e.quiz_id) ?? null,
          sessionId: e.session_id,
          eventType: e.event_type,
          payload: (e.payload ?? {}) as never,
          ...(e.ts ? { ts: new Date(e.ts) } : {}),
        })),
    });
  } catch (err) {
    reportError(err, { scope: "events", msg: "write failed" });
    return new Response(JSON.stringify({ error: "events not stored" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...CORS, "content-type": "application/json" },
  });
};
