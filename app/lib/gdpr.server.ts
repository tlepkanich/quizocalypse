import type { PrismaClient } from "@prisma/client";

// X6 (§N) — GDPR/CCPA data-subject requests. One shared implementation behind
// Shopify's mandatory compliance webhooks (App-Store-blocking). Covers every
// store of SHOPPER PII this app holds:
//   • EmailCapture — email/name/phone from the email gate.
//   • BackInStockRequest — email from "notify me" on OOS results.
//   • QuizReward — email attached to an issued reward code (§M3).
//   • ReferralToken / Referral — referrer + redeemer emails (§M6).
// All are email-keyed and shop-scoped via their quiz relation.
// NOT shopper PII: Session / StudioLoginToken are MERCHANT auth (covered by
// shop/redact); QuizSession / Event / QuizFeedback are pseudonymous (sessionId,
// no email). Future §M stores (saved-results profiles, referral records) plug in here.

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
