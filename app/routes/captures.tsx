import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { CapturePayload } from "../lib/analytics";

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

  await prisma.emailCapture.create({
    data: {
      quizId: quiz.id,
      shopId: quiz.shopId,
      sessionId: parsed.data.session_id,
      email: parsed.data.email,
      firstName: parsed.data.first_name ?? null,
    },
  });

  // Outbound webhook delivery to Klaviyo / merchant-configured endpoints
  // deferred — write the row now, retry layer comes in a follow-up.

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...CORS, "content-type": "application/json" },
  });
};
