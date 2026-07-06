import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import type { IndexedProduct } from "../lib/recommendationEngine";
import { rateLimit } from "../lib/rateLimiters";
import { assertPublicHttpsUrl } from "../lib/ssrfGuard.server";

// Rec-Page spec §5 — "Notify Me" / back-in-stock capture. The storefront posts
// here when a shopper asks to be notified about an out-of-stock product (or a
// fully-OOS section). We durably record the request (BackInStockRequest) and,
// when the quiz has a back-in-stock webhook configured, forward it. The default
// path just stores the intent for the merchant to sync to their tool.
//
// Public route (storefront origin), so it's CORS-open + rate-limited. product_id
// is validated against the quiz's published product_index when present.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const loader = async () => new Response(null, { status: 204, headers: CORS });

export async function action({ params, request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS });
  }
  const { id } = params;
  if (!id) return json({ error: "Missing quiz id" }, { status: 400, headers: CORS });

  // 15 notify requests/min/IP — a once-per-shopper action; throttle PII flooding.
  const rl = rateLimit(request, "notify", 15);
  if (!rl.ok) {
    return json(
      { error: "rate limited" },
      { status: 429, headers: { ...CORS, "retry-after": String(rl.retryAfterS) } },
    );
  }

  let body: { email?: unknown; product_id?: unknown; session_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid json" }, { status: 400, headers: CORS });
  }
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  if (!EMAIL_RE.test(email)) {
    return json({ error: "invalid email" }, { status: 400, headers: CORS });
  }
  const productId = typeof body.product_id === "string" ? body.product_id : null;
  const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 128) : null;

  // HII-1-class guards (owner-approved 2026-07-03 — Notify-Me's guardrail is
  // unblocked for this specific error-path hardening): a DB failure must
  // return the controlled CORS+JSON 500, never Remix's un-CORS'd generic one.
  let quiz: { id: string; shopId: string | null; publishedJson: unknown } | null;
  try {
    quiz = await prisma.quiz.findUnique({
      where: { id },
      select: { id: true, shopId: true, publishedJson: true },
    });
  } catch (err) {
    logFor("notify").error({ err, quizId: id }, "quiz lookup failed");
    return json({ error: "lookup failed" }, { status: 500, headers: CORS });
  }
  if (!quiz) return json({ error: "quiz not found" }, { status: 404, headers: CORS });

  // If a product id is given, it must belong to this quiz's published catalog.
  if (productId) {
    const productIndex =
      (quiz.publishedJson as { product_index?: IndexedProduct[] } | null)?.product_index ?? [];
    const known = productIndex.some((p) => p.product_id === productId);
    if (!known) return json({ error: "unknown product" }, { status: 400, headers: CORS });
  }

  try {
    await prisma.backInStockRequest.create({
      data: {
        shopId: quiz.shopId ?? null,
        quizId: quiz.id,
        sessionId,
        productId,
        email,
      },
    });
  } catch (err) {
    logFor("notify").error({ err, quizId: quiz.id }, "write failed");
    return json({ error: "write failed" }, { status: 500, headers: CORS });
  }

  // Optional forward to a merchant-configured back-in-stock webhook (spec §5:
  // "allow custom webhook for brands using a third-party tool"). Best-effort.
  const webhookUrl = (quiz.publishedJson as { back_in_stock_webhook_url?: string } | null)
    ?.back_in_stock_webhook_url;
  if (webhookUrl) {
    // SSRF guard: a merchant could point this at an internal / cloud-metadata
    // address. Screen before POSTing shopper PII; never log the URL or email.
    const safe = await assertPublicHttpsUrl(webhookUrl);
    if (!safe.ok) {
      logFor("notify").warn({ quizId: quiz.id, reason: safe.reason }, "back-in-stock webhook blocked");
    } else {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "Quizocalypse/1.0" },
          body: JSON.stringify({
            quiz_id: quiz.id,
            email,
            product_id: productId,
            requested_at: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
        clearTimeout(t);
      } catch {
        // The request is already stored — a webhook hiccup must not fail the capture.
      }
    }
  }

  return json({ ok: true }, { headers: CORS });
}
