import type { DiscountConfig } from "./quizSchema";
import { rewardToDiscountConfig, type ResolvedReward } from "./rewardDiscount";

// ════════════════════════════════════════════════════════════════════════════
// §M6 — referral give-get: pure helpers (token, fraud guards, give/get → the
// single-use discount config). The referrer's SHARE TOKEN is public + stable
// (E5 — NOT the session bearer): a friend redeems with it, both get a reward.
// The actual grant-on-qualified-order lives server-side; this module holds the
// testable logic the endpoint + the (Shopify) order webhook share.
// ════════════════════════════════════════════════════════════════════════════

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

// FNV-1a → fixed-length base32-ish suffix. Deterministic per (quiz, session).
function suffix(seed: string, len: number): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let n = h >>> 0;
  let s = "";
  for (let i = 0; i < len; i++) {
    s += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length) + ((n % ALPHABET.length) + 13);
  }
  return s;
}

/** Public, stable referral token for a referrer's session. Shareable; carries
 *  no session-bearer capability. Deterministic so a re-mint returns the same. */
export function referralToken(quizId: string, sessionId: string): string {
  return `R${suffix(`${quizId}:${sessionId}`, 8)}`;
}

const norm = (e: string | null | undefined): string => (e ?? "").trim().toLowerCase();

/** Self-referral guard — a referrer can't redeem their own link (same email). */
export function isSelfReferral(referrerEmail: string | null | undefined, redeemerEmail: string | null | undefined): boolean {
  const a = norm(referrerEmail);
  const b = norm(redeemerEmail);
  return a !== "" && a === b;
}

/** Redemption cap guard — has the referrer already rewarded `cap` friends? */
export function capReached(redemptions: number, cap: number | undefined): boolean {
  return typeof cap === "number" && cap > 0 && redemptions >= cap;
}

/** A give/get reward (fixed type + value) → the single-use discount config,
 *  reusing the §M3 reward→discount mapping (never email-gated: the code is the
 *  incentive, delivered to a known recipient). */
export function referralDiscountConfig(
  type: "percentage" | "fixed" | "free_shipping",
  value: number,
  expiresAtISO: string,
): DiscountConfig {
  const reward = {
    enabled: true,
    type,
    value,
    odds: "equal",
    reveal: "tap",
    expiryHours: 0,
    emailGated: false,
  } as unknown as ResolvedReward;
  return rewardToDiscountConfig(reward, value, expiresAtISO);
}
