import type { PrismaClient } from "@prisma/client";

// X6 (§N) — GDPR/CCPA data-subject requests. One shared implementation behind
// Shopify's mandatory compliance webhooks (App-Store-blocking). Covers every
// store of SHOPPER PII this app holds:
//   • EmailCapture — email/name/phone from the email gate.
//   • BackInStockRequest — email from "notify me" on OOS results.
//   • QuizReward — email attached to an issued reward code (§M3).
//   • ReferralToken / Referral — referrer + redeemer emails (§M6).
// All are email-keyed and shop-scoped via their quiz relation.
//
// ORDER data is the exception: it is keyed by ORDER ID, not email, and arrives
// on the same webhook as `orders_to_redact`. The only order data this app
// holds is the `order_attributed` Event (payload.order_id + the order total)
// written by webhooks.orders.create, plus the QuizSession.converted flag
// derived from it. redactOrders() below erases both — see its comment for why
// `converted` is cleared only when no OTHER order still backs it.
// NOT shopper PII: Session / StudioLoginToken are MERCHANT auth (covered by
// shop/redact); QuizSession / QuizFeedback and non-order Event rows are
// pseudonymous (sessionId, no email). Future §M stores plug in here.

export interface CustomerData {
  captures: Array<{
    email: string;
    firstName: string | null;
    phone: string | null;
    quizId: string;
    capturedAt: Date;
  }>;
  backInStock: Array<{ email: string; productId: string | null; quizId: string; requestedAt: Date }>;
  rewards: Array<{ email: string | null; code: string; quizId: string; createdAt: Date }>;
  referrals: Array<{ email: string | null; role: "referrer" | "redeemer"; quizId: string; createdAt: Date }>;
}

/** customers/data_request — gather everything held for a shopper email in a shop
 *  so the merchant can fulfil the export (the data also lives in the Customers
 *  surface). Empty when the shop or shopper is unknown. */
export async function collectCustomerData(
  prisma: PrismaClient,
  shopDomain: string,
  email: string,
): Promise<CustomerData> {
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return { captures: [], backInStock: [], rewards: [], referrals: [] };
  const [captures, backInStock, rewards, refTokens, redemptions] = await Promise.all([
    prisma.emailCapture.findMany({
      where: { email, quiz: { shopId: shop.id } },
      select: { email: true, firstName: true, phone: true, quizId: true, capturedAt: true },
    }),
    prisma.backInStockRequest.findMany({
      where: { email, quiz: { shopId: shop.id } },
      select: { email: true, productId: true, quizId: true, requestedAt: true },
    }),
    prisma.quizReward.findMany({
      where: { email, quiz: { shopId: shop.id } },
      select: { email: true, code: true, quizId: true, createdAt: true },
    }),
    prisma.referralToken.findMany({
      where: { email, quiz: { shopId: shop.id } },
      select: { email: true, quizId: true, createdAt: true },
    }),
    prisma.referral.findMany({
      where: { redeemerEmail: email, quiz: { shopId: shop.id } },
      select: { redeemerEmail: true, quizId: true, createdAt: true },
    }),
  ]);
  const referrals: CustomerData["referrals"] = [
    ...refTokens.map((t) => ({ email: t.email, role: "referrer" as const, quizId: t.quizId, createdAt: t.createdAt })),
    ...redemptions.map((r) => ({ email: r.redeemerEmail, role: "redeemer" as const, quizId: r.quizId, createdAt: r.createdAt })),
  ];
  return { captures, backInStock, rewards, referrals };
}

/** customers/redact — erase a shopper's PII across this shop. Returns the delete
 *  counts (for the audit log). No-op when the shop is unknown. */
export async function redactCustomer(
  prisma: PrismaClient,
  shopDomain: string,
  email: string,
): Promise<{ captures: number; backInStock: number; rewards: number; referrals: number }> {
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return { captures: 0, backInStock: 0, rewards: 0, referrals: 0 };
  const [c, b, r, rt, rd] = await prisma.$transaction([
    prisma.emailCapture.deleteMany({ where: { email, quiz: { shopId: shop.id } } }),
    prisma.backInStockRequest.deleteMany({ where: { email, quiz: { shopId: shop.id } } }),
    // Only rows carrying THIS email — pseudonymous rows (no email) are kept.
    prisma.quizReward.deleteMany({ where: { email, quiz: { shopId: shop.id } } }),
    // §M6 — clear the PII, keep the pseudonymous rows, on BOTH sides. Never
    // deleteMany the tokens: Referral.token is onDelete: Cascade, so a token
    // delete would destroy OTHER shoppers' redemption rows (and the only
    // record of minted codes) — one user's erasure must not erase third
    // parties (audit finding).
    prisma.referralToken.updateMany({ where: { email, quiz: { shopId: shop.id } }, data: { email: null } }),
    prisma.referral.updateMany({ where: { redeemerEmail: email, quiz: { shopId: shop.id } }, data: { redeemerEmail: null } }),
  ]);
  return { captures: c.count, backInStock: b.count, rewards: r.count, referrals: rt.count + rd.count };
}

/**
 * customers/redact — the `orders_to_redact` half. Shopify sends the order ids
 * alongside the customer, and requires that we delete or de-identify anything
 * we hold ABOUT those orders. This app holds exactly two things:
 *
 *   1. the `order_attributed` Event (payload.order_id + the order total), and
 *   2. QuizSession.converted, a flag DERIVED from that event.
 *
 * Both go. The flag is cleared only for sessions left with no OTHER attributed
 * order — a shopper with two orders who redacts one is still, truthfully, a
 * converter, and blanking that would corrupt the merchant's analytics beyond
 * what the request asked for.
 *
 * Deleting the events does move revenue figures. That is correct: the numbers
 * must stop reflecting data we were told to erase.
 *
 * Order ids are stored as STRINGS by the orders webhook (`String(order.id)`)
 * while the webhook payload sends numbers, so every id is stringified here.
 * Returns the counts for the audit log. No-op on an unknown shop or empty list.
 */
export async function redactOrders(
  prisma: PrismaClient,
  shopDomain: string,
  orderIds: Array<string | number>,
): Promise<{ orderEvents: number; sessionsUnconverted: number }> {
  // Blank ids are dropped, NOT stringified into "" — the orders webhook writes
  // `String(order.id ?? "")`, so an empty id would otherwise match those rows
  // and erase orders nobody asked about.
  const ids = [...new Set(orderIds.map((v) => String(v).trim()).filter(Boolean))];
  if (ids.length === 0) return { orderEvents: 0, sessionsUnconverted: 0 };
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return { orderEvents: 0, sessionsUnconverted: 0 };

  // Scope on the QUIZ relation, not Event.shopId — that column is nullable, so
  // relation-scoping is the one that can't silently miss rows.
  const match = {
    eventType: "order_attributed",
    quiz: { shopId: shop.id },
    OR: ids.map((id) => ({ payload: { path: ["order_id"], equals: id } })),
  };

  // Read the touched sessions BEFORE deleting — afterwards there is nothing
  // left to say which sessions the orders belonged to.
  const touched = await prisma.event.findMany({
    where: match,
    select: { quizId: true, sessionId: true },
  });
  const pairs = [...new Map(touched.map((t) => [`${t.quizId}:${t.sessionId}`, t])).values()];

  // Which of those sessions keep an order that is NOT being redacted? One
  // grouped read rather than a count per session: a single order can win
  // unboundedly many sessions (W2), so the per-session loop this replaces
  // could fan out badly on exactly the request we must not drop.
  const survivorPairs = new Set<string>();
  if (pairs.length > 0) {
    const survivors = await prisma.event.findMany({
      where: {
        eventType: "order_attributed",
        quiz: { shopId: shop.id },
        sessionId: { in: [...new Set(pairs.map((x) => x.sessionId))] },
        NOT: { OR: ids.map((id) => ({ payload: { path: ["order_id"], equals: id } })) },
      },
      select: { quizId: true, sessionId: true },
    });
    for (const s of survivors) survivorPairs.add(`${s.quizId}:${s.sessionId}`);
  }
  const toUnconvert = pairs.filter((x) => !survivorPairs.has(`${x.quizId}:${x.sessionId}`));

  // Atomic: a crash between the delete and the flag clear would leave
  // `converted` asserting a purchase whose evidence we just erased, and the
  // Shopify retry could not detect it — the events it would look for are gone.
  const [deleted, ...updates] = await prisma.$transaction([
    prisma.event.deleteMany({ where: match }),
    ...toUnconvert.map((x) =>
      prisma.quizSession.updateMany({
        where: { quizId: x.quizId, sessionId: x.sessionId, converted: true },
        data: { converted: false },
      }),
    ),
  ]);

  return {
    orderEvents: deleted.count,
    sessionsUnconverted: updates.reduce((n, u) => n + (u as { count: number }).count, 0),
  };
}

/** shop/redact — full erasure of a shop's data (~48h after uninstall). The Shop
 *  delete cascades products/collections/quizzes → captures/back-in-stock; also
 *  clear Shopify sessions. Idempotent — a no-op if already gone. */
export async function redactShop(
  prisma: PrismaClient,
  shopDomain: string,
): Promise<{ shop: number }> {
  await prisma.session.deleteMany({ where: { shop: shopDomain } });
  const res = await prisma.shop.deleteMany({ where: { shopDomain } });
  return { shop: res.count };
}
