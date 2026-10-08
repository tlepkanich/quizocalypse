import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import { refundReturnLines, refundTime, type RefundPayload, type ShopifyRefund } from "../lib/orderRefunds";

// refunds/create → "Returned" and "Days to return" on the analytics Products
// table (ANALYTICS-HANDOFF.md, Data work 2). Covered by the existing
// `read_orders` scope; subscribed in shopify.app.toml. HMAC is verified by
// authenticate.webhook().
//
// Only refunds of ATTRIBUTED orders are kept, and only their return lines
// (`restock_type` = "return"). Each copy rides an `order_refunded` Event on the
// same (quiz, session) as the order's `order_attributed` event, carrying the
// order id, so redactOrders() erases it with the order. Idempotent on the
// refund id: Shopify retries deliveries.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const log = logFor("webhook");

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRecord) return new Response();

  const refund = payload as ShopifyRefund;
  const orderId = refund.order_id != null ? String(refund.order_id).trim() : "";
  const refundId = refund.id != null ? String(refund.id).trim() : "";
  if (!orderId || !refundId) return new Response();

  const returns = refundReturnLines(refund);
  if (returns.length === 0) return new Response();

  try {
    // Scoped on the QUIZ relation (Event.shopId is nullable), like redaction.
    const orders = await prisma.event.findMany({
      where: {
        eventType: "order_attributed",
        quiz: { shopId: shopRecord.id },
        payload: { path: ["order_id"], equals: orderId },
      },
      select: { quizId: true, sessionId: true, payload: true, ts: true },
    });
    if (orders.length === 0) return new Response();

    const already = await prisma.event.findFirst({
      where: {
        eventType: "order_refunded",
        quiz: { shopId: shopRecord.id },
        payload: { path: ["refund_id"], equals: refundId },
      },
      select: { id: true },
    });
    if (already) return new Response();

    const refundedAt = refundTime(refund, new Date()).toISOString();
    const pairs = [...new Map(orders.map((o) => [`${o.quizId}:${o.sessionId}`, o])).values()];
    await prisma.event.createMany({
      data: pairs.map((o) => {
        const createdAt = (o.payload as { order_created_at?: unknown } | null)?.order_created_at;
        const body: RefundPayload = {
          order_id: orderId,
          refund_id: refundId,
          refunded_at: refundedAt,
          // Older order events predate order_created_at; their receipt time
          // is the order's time to within the webhook's delay.
          order_created_at: typeof createdAt === "string" ? createdAt : o.ts.toISOString(),
          returns,
        };
        return {
          quizId: o.quizId,
          shopId: shopRecord.id,
          sessionId: o.sessionId,
          eventType: "order_refunded",
          payload: body as never,
        };
      }),
    });
    log.info({ topic, shop, sessions: pairs.length }, "refund returns recorded");
  } catch (err) {
    // Best-effort, like the order event: a failure here must not make Shopify
    // retry forever, and the order's attribution is untouched either way.
    log.error({ err, topic, shop }, "order_refunded event write failed");
  }
  return new Response();
};
