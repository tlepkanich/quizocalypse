import type { DiscountConfig } from "./quizSchema";
import type { ResolvedEngagement } from "./engagementSchema";
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

export type ResolvedReferral = ResolvedEngagement["referral"];

/** One pending redemption as seen by the grant step: the Referral row + its
 *  referrer context + the quiz's RESOLVED referral settings. The caller (order
 *  webhook) does the DB reads; this stays pure. */
export interface GrantCandidate {
  /** Referral row id. */
  id: string;
  createdAt: Date;
  /** ReferralToken.email — the referrer, when known. */
  referrerEmail: string | null;
  /** Redemptions of this referrer's token already granted ("qualified"). */
  qualifiedCount: number;
  settings: ResolvedReferral;
}

/**
 * §M6 grant step — pick which pending referral (if any) a qualifying order
 * grants. First-touch attribution: the OLDEST eligible redemption wins, and an
 * order grants AT MOST ONE referral (a shopper who clicked several referral
 * links must not multiply one purchase into several rewards). Eligibility
 * re-checks every fraud guard at grant time — redeem-time checks ran against
 * whatever emails were known THEN; the order email is the authoritative one:
 *  - referral currently enabled on that quiz (merchant can disable mid-flight)
 *  - order subtotal ≥ qualifyingSubtotal (the E fraud guard)
 *  - not a self-referral (referrer email vs the order email)
 *  - the referrer's redemption cap counts GRANTED rewards, not clicks
 */
export function pickGrantableReferral(
  order: { email: string | null; subtotal: number },
  candidates: GrantCandidate[],
): GrantCandidate | null {
  const eligible = candidates.filter((c) => {
    if (c.settings.enabled !== true) return false;
    if (!(order.subtotal >= (c.settings.qualifyingSubtotal ?? 0))) return false;
    if (isSelfReferral(c.referrerEmail, order.email)) return false;
    if (capReached(c.qualifiedCount, c.settings.redemptionCap)) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((oldest, c) => (c.createdAt < oldest.createdAt ? c : oldest));
}

/** Random single-use code for a granted give/get discount. RANDOM (unlike the
 *  deterministic per-session reward codes) so a retry after a partial Shopify
 *  failure mints fresh codes instead of colliding with a half-created one; the
 *  Referral row's status CAS is the idempotency guard. `rand` injectable for
 *  tests. QZG = the referrer's "give", QZF = the friend's "get". */
export function referralGrantCode(kind: "give" | "get", rand: () => number = Math.random): string {
  const prefix = kind === "give" ? "QZG" : "QZF";
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length];
  return `${prefix}-${s}`;
}

/** Human phrasing of a give/get reward for delivery emails. No currency symbol
 *  on fixed amounts — the shop's currency isn't known at this layer. */
export function describeReferralReward(type: "percentage" | "fixed" | "free_shipping", value: number): string {
  if (type === "free_shipping") return "free shipping";
  if (type === "fixed") return `${value} off your order`;
  return `${value}% off your order`;
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
