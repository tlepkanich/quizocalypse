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

// FNV-1a → a fixed-length base32-ish suffix. Deterministic per seed.
function codeSuffix(seed: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let n = h >>> 0;
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length) + ((n % alphabet.length) + 7); // spread
  }
  return s;
}

/** Per-shopper reward code, deterministic by session (retry-safe). */
export function rewardCode(sessionId: string): string {
  return `QZR-${codeSuffix(sessionId)}`;
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
