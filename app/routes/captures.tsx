import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { CapturePayload } from "../lib/analytics";
import { rateLimit } from "../lib/rateLimiters";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export const loader = async () =>
  new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }
  // 15 captures/min/IP — email submission is a once-per-shopper action; this
  // throttles PII-table flooding without touching real traffic.
  const rl = rateLimit(request, "captures", 15);
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

  const parsed = CapturePayload.safeParse(raw);
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

  // HII-1 — surface a write failure as a controlled, logged, CORS+JSON 500
  // instead of letting the throw escape to Remix's generic (un-CORS'd, non-JSON)
  // 500. The storefront callers are fire-and-forget (they never inspect the
  // status, so the shopper is unaffected either way), but this gives honest
  // server-side monitoring + a parseable body for the deferred retry layer.
  try {
    await prisma.emailCapture.create({
      data: {
        quizId: quiz.id,
        shopId: quiz.shopId,
        sessionId: parsed.data.session_id,
        email: parsed.data.email,
        firstName: parsed.data.first_name ?? null,
        phone: parsed.data.phone ?? null,
      },
    });
  } catch (err) {
    console.error("[captures] write failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "capture failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }

  // Outbound webhook delivery to Klaviyo / merchant-configured endpoints
  // deferred — write the row now, retry layer comes in a follow-up.

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...CORS, "content-type": "application/json" },
  });
};
