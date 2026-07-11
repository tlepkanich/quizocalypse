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

// Crypto-random fixed-length suffix. 32 divides 2^32 → no modulo bias.
// globalThis.crypto keeps this module client-safe (Node 20 + browsers).
function randomSuffix(len: number): string {
  const buf = new Uint32Array(len);
  globalThis.crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i]! % ALPHABET.length];
  return s;
}

/** Public referral token for a referrer's session. Shareable; carries no
 *  session-bearer capability. RANDOM at mint (audit hardening — the earlier
 *  deterministic (quiz, session) hash had ≤32 bits of real entropy, so
 *  birthday collisions on the @unique column 500'd mints at scale). Stability
 *  across re-mints comes from the ReferralToken ROW (unique quizId+sessionId):
 *  the endpoint upserts and returns the STORED token, never recomputes it. */
export function newReferralToken(): string {
  return `R${randomSuffix(10)}`;
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

/** Random single-use code for a granted give/get discount. Random so a retry
 *  after a partial Shopify failure mints fresh codes instead of colliding with
 *  a half-created one; the Referral row's status CAS is the idempotency guard.
 *  CRYPTO random by default (audit m3 — Math.random's xorshift state is
 *  recoverable from a few outputs, letting an attacker predict others' codes
 *  and spend them first); `rand` stays injectable for tests.
 *  QZG = the referrer's "give", QZF = the friend's "get". */
export function referralGrantCode(kind: "give" | "get", rand?: () => number): string {
  const prefix = kind === "give" ? "QZG" : "QZF";
  if (!rand) return `${prefix}-${randomSuffix(8)}`;
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
