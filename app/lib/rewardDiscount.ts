import type { DiscountConfig } from "./quizSchema";
import type { ResolvedEngagement } from "./engagementSchema";

// ════════════════════════════════════════════════════════════════════════════
// §M3/§L L3 — reward → Shopify discount mapping. Pure + testable. Turns the
// engagement reward config (§L RewardSettings) + a server-picked value into a
// SINGLE-USE, EXPIRING DiscountConfig that the proven `buildDiscountInput`
// (discount.server.ts) then shapes into a discountCodeBasicCreate mutation.
// The per-shopper code is deterministic by sessionId so a retry reuses it (the
// QuizReward row is the primary idempotency guard; this is the backstop).
// ════════════════════════════════════════════════════════════════════════════

export type ResolvedReward = ResolvedEngagement["reward"];

/** Map the reward config + picked value → a single-use, expiring DiscountConfig.
 *  `expiresAtISO` is computed by the caller (keeps this pure — no Date.now). */
export function rewardToDiscountConfig(
  reward: ResolvedReward,
  value: number,
  expiresAtISO: string,
): DiscountConfig {
  const kind: DiscountConfig["kind"] =
    reward.type === "fixed" ? "amount" : reward.type === "free_shipping" ? "free_shipping" : "percentage";
  return {
    enabled: true,
    kind,
    value,
    applies_to: "all",
    applies_collection_ids: [],
    applies_product_ids: [],
    once_per_customer: true,
    usage_limit: 1, // single-use per shopper (E1 anti-abuse)
    ends_at: expiresAtISO,
    ...(reward.minSpend != null ? { minimum_subtotal: reward.minSpend } : {}),
    title: "Your quiz reward",
  };
}

// Crypto-random fixed-length suffix. 32-char alphabet (no ambiguous chars);
// 32 divides 2^32, so Uint32 % 32 has zero modulo bias. globalThis.crypto is
// universal (Node 20 + browsers) — keeps this module client-safe.
function codeSuffix(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(len);
  globalThis.crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[buf[i]! % alphabet.length];
  return s;
}

/** Per-shopper reward code. RANDOM (audit M3) — the earlier deterministic
 *  session hash was 32-bit, shop-global, and offline-forgeable (an attacker
 *  could pre-mint a victim session's code and permanently block it; organic
 *  collisions 502-looped at scale). Idempotency does NOT need determinism:
 *  the QuizReward row (unique quizId+sessionId, reserved BEFORE the mint)
 *  stores the code, and retries return the stored one. */
export function rewardCode(): string {
  return `QZR-${codeSuffix(8)}`;
}

/** ISO expiry from a base time + the reward's expiryHours (default 24). */
export function rewardExpiresAt(nowMs: number, expiryHours: number | undefined): string {
  const hrs = expiryHours && expiryHours > 0 ? expiryHours : 24;
  return new Date(nowMs + hrs * 3_600_000).toISOString();
}

/**
 * §M3 usage cap — has the per-quiz reward ceiling been reached? `usageCap`
 * undefined = uncapped (always false). A soft business cap on total codes
 * minted (spend guardrail); the exact per-shopper lock is the QuizReward row.
 */
export function rewardCapReached(mintedCount: number, usageCap: number | undefined): boolean {
  return usageCap !== undefined && mintedCount >= usageCap;
}
