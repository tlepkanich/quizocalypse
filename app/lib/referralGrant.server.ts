import prisma from "../db.server";
import { logFor, reportError } from "./log.server";
import { Quiz } from "./quizSchema";
import { EngagementSettings, resolveEngagement } from "./engagementSchema";
import {
  pickGrantableReferral,
  referralGrantCode,
  referralDiscountConfig,
  describeReferralReward,
  type GrantCandidate,
  type ResolvedReferral,
} from "./referral";
import { rewardExpiresAt } from "./rewardDiscount";
import { createCodeDiscount } from "./discount.server";
import { unauthenticated } from "../shopify.server";
import { sendEmail } from "./email.server";

// ════════════════════════════════════════════════════════════════════════════
// §M6 — the grant step. The referral endpoint records redemptions as "pending";
// THIS module (called from the orders/create webhook) grants them: when an
// order's customer email matches a pending redemption and the subtotal clears
// the quiz's qualifyingSubtotal, the row flips pending → qualified, both
// single-use Shopify codes are minted (give = referrer, get = friend), stored
// on the row, and delivered by email (best-effort). Decision logic is pure
// (pickGrantableReferral); this module is the I/O shell.
//
// Idempotency: the pending→qualified CAS (updateMany filtered on status) is
// the lock — a Shopify webhook redelivery or a same-email order race loses the
// CAS and no-ops. Any mint/store failure reverts the row to pending so the
// next qualifying order (or redelivery) retries with FRESH codes.
// ════════════════════════════════════════════════════════════════════════════

const log = logFor("referral-grant");

export interface OrderForReferralGrant {
  shopId: string;
  shopDomain: string;
  shopSource: string;
  /** Shop.engagementDefaults (raw JSON — parsed here). */
  engagementDefaults: unknown;
  orderEmail: string | null;
  subtotal: number;
  nowMs: number;
}

/** Grant at most one pending referral for this order. Never throws — the order
 *  webhook must survive any referral hiccup (and vice versa: a granted row is
 *  never blocked by attribution). */
export async function grantReferralForOrder(order: OrderForReferralGrant): Promise<void> {
  try {
    await grant(order);
  } catch (err) {
    reportError(err, { scope: "referral-grant", msg: "grant step failed" });
  }
}

async function grant(order: OrderForReferralGrant): Promise<void> {
  const email = order.orderEmail?.trim() || null;
  if (!email) return;

  const pending = await prisma.referral.findMany({
    where: {
      status: "pending",
      redeemerEmail: { equals: email, mode: "insensitive" },
      quiz: { shopId: order.shopId },
    },
    select: {
      id: true,
      tokenValue: true,
      redeemerEmail: true,
      createdAt: true,
      token: { select: { email: true } },
      quiz: { select: { publishedJson: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20, // one shopper's pending redemptions — bounded for webhook latency
  });
  if (pending.length === 0) return;

  // The redemption cap counts GRANTED rewards per referrer token.
  const qualifiedByToken = await prisma.referral.groupBy({
    by: ["tokenValue"],
    where: { tokenValue: { in: [...new Set(pending.map((p) => p.tokenValue))] }, status: "qualified" },
    _count: { _all: true },
  });
  const qualifiedCount = new Map(qualifiedByToken.map((g) => [g.tokenValue, g._count._all]));

  const accountParsed = EngagementSettings.safeParse(order.engagementDefaults ?? {});
  const account = accountParsed.success ? accountParsed.data : undefined;
  const candidates: GrantCandidate[] = pending.map((p) => {
    const parsedDoc = Quiz.safeParse(p.quiz.publishedJson);
    return {
      id: p.id,
      createdAt: p.createdAt,
      referrerEmail: p.token.email,
      qualifiedCount: qualifiedCount.get(p.tokenValue) ?? 0,
      settings: resolveEngagement(parsedDoc.success ? parsedDoc.data.engagement : undefined, account).referral,
    };
  });

  const winner = pickGrantableReferral({ email, subtotal: order.subtotal }, candidates);
  if (!winner) return;

  // Shopify discounts need an offline admin session — standalone workspaces
  // can't mint codes. Leave the row pending (a future Shopify connect could
  // still grant it) rather than qualifying it codeless.
  if (order.shopSource === "standalone" || !order.shopDomain.endsWith(".myshopify.com")) {
    log.info({ shopDomain: order.shopDomain }, "referral grant skipped — no Shopify admin session");
    return;
  }

  // CAS pending → qualified: the idempotency lock. A webhook redelivery or a
  // concurrent same-email order loses here and no-ops.
  const claimed = await prisma.referral.updateMany({
    where: { id: winner.id, status: "pending" },
    data: { status: "qualified" },
  });
  if (claimed.count === 0) return;

  const settings = winner.settings;
  const expiresAtISO = rewardExpiresAt(order.nowMs, settings.expiryHours);
  const startsAtISO = new Date(order.nowMs).toISOString();
  const giveCode = referralGrantCode("give");
  const getCode = referralGrantCode("get");

  const revert = () =>
    prisma.referral.updateMany({ where: { id: winner.id, status: "qualified" }, data: { status: "pending" } });

  try {
    const { admin } = await unauthenticated.admin(order.shopDomain);
    const give = await createCodeDiscount(
      admin,
      referralDiscountConfig(settings.giveType, settings.giveValue, expiresAtISO),
      giveCode,
      startsAtISO,
    );
    const get = give.ok
      ? await createCodeDiscount(
          admin,
          referralDiscountConfig(settings.getType, settings.getValue, expiresAtISO),
          getCode,
          startsAtISO,
        )
      : give;
    if (!give.ok || !get.ok) {
      // An orphaned first code (give ok, get failed) is single-use + expiring;
      // the retry mints fresh random codes, so it can never be double-granted.
      await revert();
      reportError(new Error(give.warning ?? get.warning ?? "discount create failed"), {
        scope: "referral-grant",
        msg: "code mint failed — reverted to pending",
      });
      return;
    }
    await prisma.referral.update({ where: { id: winner.id }, data: { giveCode, getCode } });
  } catch (err) {
    await revert().catch(() => undefined);
    reportError(err, { scope: "referral-grant", msg: "grant failed — reverted to pending" });
    return;
  }

  log.info({ referralId: winner.id, shopDomain: order.shopDomain }, "referral granted — codes minted");

  // Delivery is best-effort and detached — the webhook response never waits on
  // SMTP. Codes are already stored on the row, so a lost email is recoverable
  // (delivery UX beyond this transactional send is an open design item).
  void deliverReferralEmails({
    referrerEmail: winner.referrerEmail,
    redeemerEmail: email,
    giveCode,
    getCode,
    settings,
    expiresAtISO,
  }).catch((err) => reportError(err, { scope: "referral-grant", msg: "reward email delivery failed" }));
}

async function deliverReferralEmails(args: {
  referrerEmail: string | null;
  redeemerEmail: string;
  giveCode: string;
  getCode: string;
  settings: ResolvedReferral;
  expiresAtISO: string;
}): Promise<void> {
  const expires = args.expiresAtISO.slice(0, 10); // date-only, UTC (SSR-safe idiom)
  if (args.referrerEmail) {
    const reward = describeReferralReward(args.settings.giveType, args.settings.giveValue);
    await sendEmail(
      {
        to: args.referrerEmail,
        subject: "Your referral reward is ready",
        html: `<p>A friend you referred just made a purchase — thank you!</p><p>Here's ${reward}: <strong>${args.giveCode}</strong></p><p>Single-use, valid until ${expires}.</p>`,
        text: `A friend you referred just made a purchase — thank you!\n\nHere's ${reward}: ${args.giveCode}\n\nSingle-use, valid until ${expires}.`,
      },
      "referral-grant",
    );
  } else {
    log.info({ giveCode: args.giveCode }, "referrer email unknown — give code stored undelivered");
  }
  const reward = describeReferralReward(args.settings.getType, args.settings.getValue);
  await sendEmail(
    {
      to: args.redeemerEmail,
      subject: "A thank-you from your referral",
      html: `<p>Thanks for your order! Your referral earned you ${reward} on your next purchase: <strong>${args.getCode}</strong></p><p>Single-use, valid until ${expires}.</p>`,
      text: `Thanks for your order! Your referral earned you ${reward} on your next purchase: ${args.getCode}\n\nSingle-use, valid until ${expires}.`,
    },
    "referral-grant",
  );
}
