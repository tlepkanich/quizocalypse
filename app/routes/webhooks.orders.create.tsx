import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  attributeOrderToSessions,
  DEFAULT_ATTRIBUTION_WINDOW_MS,
} from "../lib/conversionAttribution";

// orders/create → conversion attribution (Dev Spec §7.2 `converted`). Matches the
// order to recent quiz sessions (by email + product overlap, then product overlap
// within a window) and flips `QuizSession.converted`. HMAC is verified by
// authenticate.webhook(). Requires the `read_orders` scope + the orders/create
// subscription (shopify.app.toml) to fire.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRecord) return new Response();

  const order = payload as {
    id?: number | string | null;
    email?: string | null;
    created_at?: string | null;
    total_price?: string | null;
    currency?: string | null;
    line_items?: Array<{ product_id?: number | string | null }>;
  };
  const productIds = (order.line_items ?? [])
    .map((li) => (li.product_id != null ? `gid://shopify/Product/${li.product_id}` : null))
    .filter((x): x is string => x !== null);
  if (productIds.length === 0) return new Response();

  const createdAt = order.created_at ? new Date(order.created_at) : new Date();
  const since = new Date(createdAt.getTime() - DEFAULT_ATTRIBUTION_WINDOW_MS);
  const email = order.email?.trim() || null;

  // Candidate sessions: this shop, completed in-window, not yet converted.
  const [sessions, captures] = await Promise.all([
    prisma.quizSession.findMany({
      where: {
        shopId: shopRecord.id,
        converted: false,
        completedAt: { gte: since, lte: createdAt },
      },
      select: {
        id: true,
        quizId: true,
        sessionId: true,
        matchedProductIds: true,
        completedAt: true,
      },
    }),
    email
      ? prisma.emailCapture.findMany({
          where: {
            shopId: shopRecord.id,
            email: { equals: email, mode: "insensitive" },
            capturedAt: { gte: since, lte: createdAt },
          },
          select: { quizId: true, sessionId: true, email: true, capturedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const winnerIds = attributeOrderToSessions({ productIds, email, createdAt }, sessions, captures);
  if (winnerIds.length > 0) {
    await prisma.quizSession.updateMany({
      where: { id: { in: winnerIds } },
      data: { converted: true },
    });
    // Revenue attribution (BIC P2, migration-free): one order_attributed Event
    // row per winning session carrying the order total. Dashboards sum these
    // DEDUPED BY order_id (one order can win multiple sessions), grouped by
    // currency. Best-effort — an Event failure must never break attribution.
    try {
      const winners = sessions.filter((s) => winnerIds.includes(s.id));
      await prisma.event.createMany({
        data: winners.map((s) => ({
          quizId: s.quizId,
          shopId: shopRecord.id,
          sessionId: s.sessionId,
          eventType: "order_attributed",
          payload: {
            order_id: String(order.id ?? ""),
            total_price: order.total_price ?? null,
            currency: order.currency ?? null,
          } as never,
        })),
      });
    } catch (err) {
      console.error("[webhook] order_attributed event write failed:", err);
    }
  }
  console.log(`[webhook] ${topic} ${shop}: converted ${winnerIds.length} session(s)`);
  return new Response();
};
