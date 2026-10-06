import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import {
  attributeOrderToSessions,
  ATTRIBUTION_WINDOW_MS,
} from "../lib/conversionAttribution";
import { orderLineItems, type ShopifyOrderLine } from "../lib/orderLines";
import { grantReferralForOrder, repairCodelessReferrals } from "../lib/referralGrant.server";

// orders/create → conversion attribution (Dev Spec §7.2 `converted`) + the §M6
// referral grant step. Attribution matches the order to recent quiz sessions
// (by email + product overlap, then product overlap) placed within 14 days of
// the shopper STARTING the quiz (conversionAttribution.ts) and flips
// `QuizSession.converted`; the grant step qualifies pending referral
// redemptions (referralGrant.server.ts). HMAC is verified by
// authenticate.webhook(). Requires the `read_orders` scope + the orders/create
// subscription (shopify.app.toml) to fire.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (!shopRecord) return new Response();

  const order = payload as {
    id?: number | string | null;
    email?: string | null;
    customer?: { email?: string | null } | null;
    created_at?: string | null;
    subtotal_price?: string | null;
    total_price?: string | null;
    currency?: string | null;
    line_items?: ShopifyOrderLine[];
  };

  // §M6 referral grant — runs before the line-item early-return (a grant needs
  // no product overlap) and never throws. `email` falls back to customer.email
  // (attribution below keeps its original order.email-only behavior).
  const subtotal = Number(order.subtotal_price ?? order.total_price ?? "0");
  const grantOrder = {
    shopId: shopRecord.id,
    shopDomain: shop,
    shopSource: shopRecord.source,
    engagementDefaults: shopRecord.engagementDefaults,
    orderEmail: order.email?.trim() || order.customer?.email?.trim() || null,
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    nowMs: Date.now(),
  };
  await grantReferralForOrder(grantOrder);
  // Audit M1 — heal any rows stranded qualified-without-codes by an earlier
  // crash (deploy/restart mid-grant). Rides this webhook as its backstop tick;
  // never throws, bounded to 3 rows per order.
  await repairCodelessReferrals(grantOrder);

  const productIds = (order.line_items ?? [])
    .map((li) => (li.product_id != null ? `gid://shopify/Product/${li.product_id}` : null))
    .filter((x): x is string => x !== null);
  if (productIds.length === 0) return new Response();

  const createdAt = order.created_at ? new Date(order.created_at) : new Date();
  const since = new Date(createdAt.getTime() - ATTRIBUTION_WINDOW_MS);
  const email = order.email?.trim() || null;

  // Candidate sessions: this shop, not yet converted, recommended one of the
  // ordered products, and finished inside the window. A session's finish is
  // never before its start, so "finished since" is a safe pre-filter for
  // "started since"; the matcher applies the exact rule on the start time.
  const sessionRows = await prisma.quizSession.findMany({
    where: {
      shopId: shopRecord.id,
      converted: false,
      completedAt: { gte: since, lte: createdAt },
      matchedProductIds: { hasSome: [...new Set(productIds)] },
    },
    select: {
      id: true,
      quizId: true,
      sessionId: true,
      matchedProductIds: true,
      completedAt: true,
    },
  });
  const candidateSessionIds = [...new Set(sessionRows.map((s) => s.sessionId))];
  const candidateQuizIds = [...new Set(sessionRows.map((s) => s.quizId))];

  // A QuizSession row is written when the result renders, so the START lives
  // only on the session's quiz_engaged events. Captures are read for the
  // candidates (every email, not just the order's) so the matcher knows which
  // sessions belong to an identified shopper.
  const [engageRows, captures] = await Promise.all([
    sessionRows.length
      ? prisma.event.findMany({
          where: {
            quizId: { in: candidateQuizIds },
            eventType: "quiz_engaged",
            sessionId: { in: candidateSessionIds },
            ts: { lte: createdAt },
          },
          select: { quizId: true, sessionId: true, ts: true },
        })
      : Promise.resolve([]),
    sessionRows.length
      ? prisma.emailCapture.findMany({
          where: {
            shopId: shopRecord.id,
            quizId: { in: candidateQuizIds },
            sessionId: { in: candidateSessionIds },
            capturedAt: { lte: createdAt },
          },
          select: { quizId: true, sessionId: true, email: true, capturedAt: true },
        })
      : Promise.resolve([]),
  ]);
  const engagesBySession = new Map<string, Date[]>();
  for (const e of engageRows) {
    const key = `${e.quizId} ${e.sessionId}`;
    const list = engagesBySession.get(key) ?? [];
    list.push(e.ts);
    engagesBySession.set(key, list);
  }
  const sessions = sessionRows.map((s) => {
    // The run that produced this result: the latest Start at or before the
    // finish (a session id survives "Start over").
    const finish = s.completedAt?.getTime() ?? createdAt.getTime();
    let startedAt: Date | null = null;
    for (const ts of engagesBySession.get(`${s.quizId} ${s.sessionId}`) ?? []) {
      if (ts.getTime() <= finish && (!startedAt || ts > startedAt)) startedAt = ts;
    }
    return { ...s, startedAt };
  });

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
      const lineItems = orderLineItems(order.line_items);
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
            // The order's own time. `Event.ts` is when the webhook arrived,
            // which is what "days to return" must NOT be measured from.
            order_created_at: createdAt.toISOString(),
            // E7 — which products the order actually contained, so the
            // analytics Products table can answer "was this ever bought?".
            // Already GIDs (product_index's format) and deduped: a single
            // order carrying two variants of one product is ONE purchase of
            // it. Ids only, no titles or prices — the catalogue already has
            // those, and Event rows are the highest-volume table we write.
            //
            // Redaction-safe by construction: this rides INSIDE the
            // order_attributed event, which redactOrders() deletes wholesale
            // for an orders_to_redact request. No second store to forget.
            line_item_product_ids: [...new Set(productIds)],
            // Each line with its quantity and its price after discounts —
            // product revenue and "top products by revenue" read these.
            // Inside this payload for the same redaction reason as above.
            line_items: lineItems,
          } as never,
        })),
      });
    } catch (err) {
      logFor("webhook").error({ err, topic, shop }, "order_attributed event write failed");
    }
  }
  logFor("webhook").info({ topic, shop, converted: winnerIds.length }, "conversion attribution done");
  return new Response();
};
