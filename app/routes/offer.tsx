import { randomBytes } from "node:crypto";
import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import prisma from "../db.server";
import { reportError } from "../lib/log.server";
import { rateLimit } from "../lib/rateLimiters";
import { issueOffer, retireExpiredOffers, type OfferDeps } from "../lib/offerMint.server";
import { shopifyOfferGateway } from "../lib/offerShopify.server";
import { unauthenticated } from "../shopify.server";

// Results handoff §12.3 — the public offer endpoint. The live quiz POSTs
// here when the shopper earns the code: on email submit (before the results,
// or the unlock on the results page), or on results reveal when no email is
// asked. Never from the builder preview. CORS-open, rate-limited, Zod at the
// boundary; the code is never part of the public quiz file.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const OfferRequest = z.object({
  quiz_id: z.string().min(1).max(64),
  session_id: z.string().min(16).max(128),
  email: z.string().email().max(254).optional(),
});

const deps: OfferDeps = {
  prisma,
  shopify: async (shopDomain) => shopifyOfferGateway((await unauthenticated.admin(shopDomain)).admin),
  now: () => new Date(),
  randomBytes: (n) => randomBytes(n),
};

export const loader = async () => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const rl = rateLimit(request, "offer", 15);
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
  const parsed = OfferRequest.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid payload" }, 400);
  const { quiz_id, session_id, email } = parsed.data;

  try {
    const result = await issueOffer(deps, { quizId: quiz_id, sessionId: session_id, email });
    if (result.status === "issued") {
      // Best-effort clean-up of this quiz's expired buckets; never delays
      // or fails the shopper's response.
      void prisma.quiz
        .findUnique({ where: { id: quiz_id }, select: { shop: { select: { shopDomain: true } } } })
        .then((q) => (q?.shop ? retireExpiredOffers(deps, quiz_id, q.shop.shopDomain) : 0))
        .catch((err) => reportError(err, { scope: "offer", msg: "expired-bucket clean-up failed" }));
      return json({ offer: result.offer });
    }
    // The completion POST can still be in flight — the page retries on 409.
    return json({ offer: null, reason: result.reason }, result.reason === "session_incomplete" ? 409 : 200);
  } catch (err) {
    reportError(err, { scope: "offer", msg: "issue failed" });
    return json({ offer: null, reason: "unavailable" }, 502);
  }
};
