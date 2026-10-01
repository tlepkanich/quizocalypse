import type { PrismaClient } from "@prisma/client";
import { Quiz, type DiscountConfig } from "./quizSchema";
import { offerLine, offerValue } from "./offerCopy";
import { newOfferCode, offerBucket, offerKeyHash, recommendedScope } from "./offerKey.server";
import type { OfferShopify } from "./offerShopify.server";

// Results handoff §12 — the per-shopper offer mint. discount_config is the
// ONE source of truth: it drives the Shopify discount, what the page says,
// and (later) the Klaviyo event. A code is earned by finishing the quiz, and
// when the email unlocks the offer, by submitting it. One grant per session.

export interface OfferFacts {
  code: string;
  /** "10% off your order · orders $50+ · expires in 24h" */
  line: string;
  /** "10% off" */
  value: string;
  kind: DiscountConfig["kind"];
  /** The discount's real end (the hourly bucket's), ISO; null = no expiry. */
  ends_at: string | null;
}

export type OfferResult =
  | { status: "issued"; offer: OfferFacts }
  | {
      status: "none";
      reason:
        | "not_offered"
        | "email_required"
        | "session_incomplete"
        | "no_shopify"
        | "exhausted"
        | "unavailable";
    };

export interface OfferDeps {
  prisma: PrismaClient;
  /** The shop's Shopify gateway; throws when no admin session exists. */
  shopify: (shopDomain: string) => Promise<OfferShopify>;
  now: () => Date;
  randomBytes: (n: number) => Uint8Array;
}

/** Codes added to the pool at a time once the first (create) code is taken. */
const REFILL_BATCH = 10;

function facts(cfg: DiscountConfig, code: string, endsAt: Date | null, pickedLabel?: string): OfferFacts {
  return {
    code,
    line: offerLine(cfg, pickedLabel),
    value: offerValue(cfg),
    kind: cfg.kind,
    ends_at: endsAt ? endsAt.toISOString() : null,
  };
}

export async function issueOffer(
  deps: OfferDeps,
  input: { quizId: string; sessionId: string; email?: string },
): Promise<OfferResult> {
  const { prisma } = deps;
  const email = input.email?.trim().toLowerCase() || undefined;
  const quiz = await prisma.quiz.findUnique({
    where: { id: input.quizId },
    select: { id: true, shopId: true, publishedJson: true, shop: { select: { shopDomain: true, source: true } } },
  });
  const parsed = quiz?.publishedJson ? Quiz.safeParse(quiz.publishedJson) : null;
  if (!quiz || !quiz.shop || !parsed?.success) return { status: "none", reason: "not_offered" };
  const doc = parsed.data;
  const cfg = doc.discount_config;
  // Only a discount saved in the Results editor (configured) and switched on.
  if (doc.logic_model !== "decider" || !cfg.enabled || cfg.configured !== true) {
    return { status: "none", reason: "not_offered" };
  }
  const settings = doc.rec_page_settings?.global;
  if (settings?.captureUnlocksOffer === true && settings.captureEmail !== false && !email) {
    return { status: "none", reason: "email_required" };
  }

  // A picked list is named on the page ("10% off Best sellers").
  const pickedLabel =
    cfg.applies_to === "collections" && cfg.applies_collection_ids.length > 0
      ? (
          await prisma.collection.findMany({
            where: { shopId: quiz.shopId, collectionId: { in: cfg.applies_collection_ids } },
            select: { title: true },
            take: 3,
          })
        )
          .map((c) => c.title)
          .join(", ") || undefined
      : undefined;

  // A code is earned by finishing the quiz (/sessions is public, so this
  // raises the bar rather than proving a real shopper).
  const session = await prisma.quizSession.findUnique({
    where: { quizId_sessionId: { quizId: quiz.id, sessionId: input.sessionId } },
    select: { completedAt: true, outcomeId: true, answerIds: true, matchedProductIds: true },
  });
  if (!session?.completedAt || !session.outcomeId || session.answerIds.length === 0) {
    return { status: "none", reason: "session_incomplete" };
  }

  // Shared and existing codes are one string for everyone: nothing is minted
  // per shopper. The string never ships in the public quiz file (it is
  // redacted in stripPublicDoc), so the page gets it here, after the gates.
  if (cfg.code_mode === "static" || cfg.code_mode === "existing") {
    const code = (cfg.code_mode === "static" ? cfg.static_code : cfg.existing_code)?.trim();
    if (!code) return { status: "none", reason: "not_offered" };
    const endsAt = cfg.expiry_mode === "date" && cfg.ends_at ? new Date(cfg.ends_at) : null;
    return { status: "issued", offer: facts(cfg, code, endsAt, pickedLabel) };
  }

  const granted = async (where: { sessionId: string } | { email: string }) =>
    prisma.quizOfferGrant.findFirst({
      where: { quizId: quiz.id, ...where },
      orderBy: { createdAt: "desc" },
      select: { code: { select: { code: true, discount: { select: { endsAt: true } } } } },
    });
  const asResult = (g: NonNullable<Awaited<ReturnType<typeof granted>>>): OfferResult => ({
    status: "issued",
    offer: facts(cfg, g.code.code, g.code.discount.endsAt, pickedLabel),
  });

  // Idempotency: this session's code, as issued.
  const mine = await granted({ sessionId: input.sessionId });
  if (mine) return asResult(mine);
  // "One use per customer" across codes is ours to enforce — Shopify counts
  // use per code. The same address gets its live code back.
  if (cfg.once_per_customer && email) {
    const theirs = await granted({ email });
    const end = theirs?.code.discount.endsAt;
    if (theirs && (!end || end.getTime() > deps.now().getTime())) return asResult(theirs);
  }
  // "Total codes this quiz can give out."
  if (cfg.usage_limit !== undefined) {
    const issued = await prisma.quizOfferGrant.count({ where: { quizId: quiz.id } });
    if (issued >= cfg.usage_limit) return { status: "none", reason: "exhausted" };
  }

  const shopDomain = quiz.shop.shopDomain;
  if (quiz.shop.source === "standalone" || !shopDomain.endsWith(".myshopify.com")) {
    return { status: "none", reason: "no_shopify" };
  }
  const shopify = await deps.shopify(shopDomain);

  const now = deps.now();
  const bucket = offerBucket(cfg, now);
  if (bucket.endsAt && bucket.endsAt.getTime() <= now.getTime()) return { status: "none", reason: "not_offered" };
  const scope = recommendedScope(cfg, session.matchedProductIds);
  if (scope && scope.length === 0) return { status: "none", reason: "not_offered" };
  const keyHash = offerKeyHash(cfg, bucket, scope);

  const discount = await ensureDiscount(deps, shopify, {
    quizId: quiz.id,
    keyHash,
    cfg,
    endsAt: bucket.endsAt,
    scope,
  });
  let codeId = await takeCode(prisma, discount.id);
  if (!codeId) {
    await refill(deps, shopify, discount, cfg);
    codeId = await takeCode(prisma, discount.id);
  }
  if (!codeId) return { status: "none", reason: "unavailable" };

  try {
    await prisma.quizOfferGrant.create({
      data: { quizId: quiz.id, sessionId: input.sessionId, email: email ?? null, codeId },
    });
  } catch {
    // A double submit: the other request won the session's unique slot.
    // Put our code back and return the winner's.
    await prisma.quizOfferCode.update({ where: { id: codeId }, data: { status: "available" } });
    const winner = await granted({ sessionId: input.sessionId });
    return winner ? asResult(winner) : { status: "none", reason: "unavailable" };
  }
  const issued = await prisma.quizOfferCode.findUniqueOrThrow({ where: { id: codeId }, select: { code: true } });
  return { status: "issued", offer: facts(cfg, issued.code, bucket.endsAt, pickedLabel) };
}

/** Get the keyed discount, creating it (with its first, live code) under a
 *  per-key advisory lock so two first shoppers never create two discounts. */
async function ensureDiscount(
  deps: OfferDeps,
  shopify: OfferShopify,
  args: { quizId: string; keyHash: string; cfg: DiscountConfig; endsAt: Date | null; scope: string[] | null },
): Promise<{ id: string; shopifyDiscountId: string }> {
  const { prisma } = deps;
  const find = () =>
    prisma.quizOfferDiscount.findUnique({
      where: { quizId_keyHash: { quizId: args.quizId, keyHash: args.keyHash } },
      select: { id: true, shopifyDiscountId: true },
    });
  const existing = await find();
  if (existing?.shopifyDiscountId) return { id: existing.id, shopifyDiscountId: existing.shopifyDiscountId };

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer:${args.quizId}:${args.keyHash}`}))`;
      const again = await tx.quizOfferDiscount.findUnique({
        where: { quizId_keyHash: { quizId: args.quizId, keyHash: args.keyHash } },
        select: { id: true, shopifyDiscountId: true },
      });
      if (again?.shopifyDiscountId) return { id: again.id, shopifyDiscountId: again.shopifyDiscountId };
      const code = newOfferCode(args.cfg.code_prefix, deps.randomBytes);
      const created = await shopify.createDiscount({
        cfg: args.cfg,
        code,
        startsAt: deps.now(),
        endsAt: args.endsAt,
        productIds: args.scope,
        // Labels the bucket without bookkeeping in `title`, which customers see.
        tags: ["wiskr-quiz", `wiskr-quiz-${args.quizId}`],
      });
      const row = await tx.quizOfferDiscount.create({
        data: {
          quizId: args.quizId,
          keyHash: args.keyHash,
          shopifyDiscountId: created.discountId,
          endsAt: args.endsAt,
          // The create's own code is live at once: it is the pool's first.
          codes: { create: { code, status: "available" } },
        },
        select: { id: true },
      });
      return { id: row.id, shopifyDiscountId: created.discountId };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** Hand one pooled code out atomically (SKIP LOCKED: concurrent shoppers
 *  never get the same row and never wait on each other). */
async function takeCode(prisma: PrismaClient, discountId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "QuizOfferCode" SET "status" = 'assigned'
    WHERE "id" = (
      SELECT "id" FROM "QuizOfferCode"
      WHERE "discountId" = ${discountId} AND "status" = 'available'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

async function refill(
  deps: OfferDeps,
  shopify: OfferShopify,
  discount: { id: string; shopifyDiscountId: string },
  cfg: DiscountConfig,
): Promise<void> {
  const codes = Array.from({ length: REFILL_BATCH }, () => newOfferCode(cfg.code_prefix, deps.randomBytes));
  const added = await shopify.addCodes(discount.shopifyDiscountId, codes);
  if (added.length === 0) return;
  await deps.prisma.quizOfferCode.createMany({
    data: added.map((c) => ({
      discountId: discount.id,
      code: c.code,
      redeemCodeId: c.redeemCodeId,
      status: "available",
    })),
    skipDuplicates: true,
  });
}

/**
 * Clean-up (handoff §12.2 step 5): after a bucket expires, delete its
 * unassigned codes in Shopify and locally. Best-effort; the store-wide cap is
 * 20,000,000 codes and no app can raise it.
 */
export async function retireExpiredOffers(deps: OfferDeps, quizId: string, shopDomain: string): Promise<number> {
  const { prisma } = deps;
  const expired = await prisma.quizOfferDiscount.findMany({
    where: { quizId, retiredAt: null, endsAt: { lt: deps.now() } },
    select: {
      id: true,
      shopifyDiscountId: true,
      codes: { where: { status: "available" }, select: { id: true, redeemCodeId: true } },
    },
    take: 20,
  });
  if (expired.length === 0) return 0;
  const shopify = await deps.shopify(shopDomain);
  for (const d of expired) {
    const ids = d.codes.map((c) => c.redeemCodeId).filter((id): id is string => Boolean(id));
    if (d.shopifyDiscountId && ids.length > 0) await shopify.deleteCodes(d.shopifyDiscountId, ids);
    await prisma.quizOfferCode.deleteMany({ where: { id: { in: d.codes.map((c) => c.id) } } });
    await prisma.quizOfferDiscount.update({ where: { id: d.id }, data: { retiredAt: deps.now() } });
  }
  return expired.length;
}
