import type { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import prisma from "../db.server";
import { reportError } from "../lib/log.server";
import { rateLimit } from "../lib/rateLimiters";
import { Quiz } from "../lib/quizSchema";
import { EngagementSettings, resolveEngagement } from "../lib/engagementSchema";
import { pickRewardValue } from "../lib/rewardPicker";
import { rewardToDiscountConfig, rewardCode, rewardExpiresAt, rewardCapReached } from "../lib/rewardDiscount";
import { createCodeDiscount } from "../lib/discount.server";
import { unauthenticated } from "../shopify.server";

// §M3/§L L3 — public reward endpoint. The storefront POSTs at result reveal; we
// pick the value server-side (never client-trusted), create a SINGLE-USE,
// EXPIRING Shopify code via the shop's offline admin session, store it (one per
// session — E1), and return the code. Idempotent: the QuizReward row is the lock
// (its code is deterministic by session, so a retry returns the same reward
// without minting a second discount). CORS-open, rate-limited, Zod at boundary.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const RewardRequest = z.object({
  quiz_id: z.string().min(1),
  session_id: z.string().min(1),
  email: z.string().email().optional(),
});

export const loader = async () => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const rl = rateLimit(request, "reward", 15);
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
  const parsed = RewardRequest.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid payload" }, 400);
  const { quiz_id, session_id, email } = parsed.data;

  let quiz;
  try {
    quiz = await prisma.quiz.findUnique({
      where: { id: quiz_id },
      select: { id: true, publishedJson: true, shop: { select: { shopDomain: true, source: true, engagementDefaults: true } } },
    });
  } catch (err) {
    reportError(err, { scope: "reward", msg: "quiz lookup failed" });
    return json({ error: "lookup failed" }, 500);
  }
  if (!quiz?.publishedJson || !quiz.shop) return json({ error: "quiz not found" }, 404);

  // Reward config from the PUBLISHED doc, resolved against account defaults.
  const parsedDoc = Quiz.safeParse(quiz.publishedJson);
  const accountParsed = EngagementSettings.safeParse(quiz.shop.engagementDefaults ?? {});
  const engagement = resolveEngagement(
    parsedDoc.success ? parsedDoc.data.engagement : undefined,
    accountParsed.success ? accountParsed.data : undefined,
  );
  const reward = engagement.reward;
  if (!reward.enabled) return json({ reward: null }); // not offered on this quiz
  if (reward.emailGated && !email) return json({ error: "email required", reward: null }, 400);

  // Shopify capability, needed by both the repair path and the mint below.
  const shopDomain = quiz.shop.shopDomain;
  const shopifyCapable = quiz.shop.source !== "standalone" && shopDomain.endsWith(".myshopify.com");

  // Idempotency — a reward already issued for this session is returned as-is.
  const existing = await prisma.quizReward.findUnique({
    where: { quizId_sessionId: { quizId: quiz.id, sessionId: session_id } },
  });
  if (existing) {
    // Audit M2 — crash-window repair: the row may have been reserved without
    // its Shopify discount (process killed between reserve and mint), which
    // would hand back a dead code forever. Best-effort re-create with the
    // STORED code+value: a "code already exists" userError means the discount
    // is live (the common case); ok means we just backfilled it. Skipped for
    // expired rewards (nothing to honor) and standalone shops (never minted).
    const live = existing.expiresAt === null || existing.expiresAt.getTime() > Date.now();
    if (live && shopifyCapable) {
      try {
        const { admin } = await unauthenticated.admin(shopDomain);
        const storedType = existing.rewardType as "percentage" | "fixed" | "free_shipping";
        await createCodeDiscount(
          admin,
          rewardToDiscountConfig({ ...reward, type: storedType }, existing.value, existing.expiresAt!.toISOString()),
          existing.code,
          new Date().toISOString(),
        ); // result deliberately unchecked — "exists" and "created" are both healthy
      } catch (err) {
        reportError(err, { scope: "reward", msg: "existing-reward backfill check failed" });
      }
    }
    return json({
      reward: { code: existing.code, type: existing.rewardType, value: existing.value, expires_at: existing.expiresAt },
    });
  }

  // Shopify discounts need an offline admin session — standalone workspaces
  // (no myshopify domain) can't mint codes, so the reward is skipped there.
  if (!shopifyCapable) {
    return json({ reward: null, reason: "no_shopify" });
  }

  // §M3 usage cap — a per-quiz ceiling on TOTAL codes minted (real discount $).
  // The per-session QuizReward row is the exact per-shopper lock; this bounds the
  // total across shoppers. Counted AFTER the idempotency short-circuit, so a
  // returning shopper who already claimed never consumes the cap twice. Soft
  // semantics: under high concurrency a tiny overshoot is possible — this is a
  // spend guardrail, not a hard ledger, and every minted code stays single-use.
  // `exhausted` (distinct from `no_shopify`/disabled) lets the reveal show the
  // merchant's fallback message instead of vanishing (build-tab §10).
  if (reward.usageCap !== undefined) {
    const minted = await prisma.quizReward.count({ where: { quizId: quiz.id } });
    if (rewardCapReached(minted, reward.usageCap)) {
      return json({ reward: null, reason: "exhausted" });
    }
  }

  const nowMs = Date.now();
  const expiresAtISO = rewardExpiresAt(nowMs, reward.expiryHours);
  const code = rewardCode();
  // Audit M4 — seed the value pick with the crypto-random CODE, not the
  // client-chosen session_id (which was offline-grindable to always land
  // rangeMax). The reserved row stores the value, so retries stay stable.
  const value = pickRewardValue({ value: reward.value, rangeMax: reward.rangeMax, odds: reward.odds }, code);
  const cfg = rewardToDiscountConfig(reward, value, expiresAtISO);

  // Reserve the row FIRST (the unique index is the per-session lock) so a
  // double-submit can never mint two Shopify codes. On the race loser, re-read
  // and return the winner's reward.
  try {
    await prisma.quizReward.create({
      data: {
        quizId: quiz.id,
        sessionId: session_id,
        code,
        rewardType: reward.type ?? "percentage",
        value,
        email: email ?? null,
        expiresAt: new Date(expiresAtISO),
      },
    });
  } catch {
    const winner = await prisma.quizReward.findUnique({
      where: { quizId_sessionId: { quizId: quiz.id, sessionId: session_id } },
    });
    if (winner) {
      return json({ reward: { code: winner.code, type: winner.rewardType, value: winner.value, expires_at: winner.expiresAt } });
    }
    return json({ error: "reward failed" }, 500);
  }

  // Create the actual single-use Shopify discount. If it fails, roll back the
  // reservation so the shopper can retry (and no dead row lingers).
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const created = await createCodeDiscount(admin, cfg, code, new Date(nowMs).toISOString());
    if (!created.ok) {
      await prisma.quizReward.deleteMany({ where: { quizId: quiz.id, sessionId: session_id } });
      reportError(new Error(created.warning ?? "discount create failed"), { scope: "reward", msg: "discount create failed" });
      return json({ error: "reward unavailable" }, 502);
    }
  } catch (err) {
    await prisma.quizReward.deleteMany({ where: { quizId: quiz.id, sessionId: session_id } });
    reportError(err, { scope: "reward", msg: "admin/discount failed" });
    return json({ error: "reward unavailable" }, 502);
  }

  return json({ reward: { code, type: reward.type, value, expires_at: expiresAtISO } });
};
