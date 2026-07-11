import { describe, it, expect } from "vitest";
import {
  referralToken,
  isSelfReferral,
  capReached,
  referralDiscountConfig,
  pickGrantableReferral,
  referralGrantCode,
  describeReferralReward,
  type GrantCandidate,
  type ResolvedReferral,
} from "./referral";
import { ENGAGEMENT_DEFAULTS } from "./engagementSchema";

describe("§M6 referral helpers", () => {
  it("referralToken is deterministic per (quiz, session) + prefixed", () => {
    expect(referralToken("q", "s1")).toBe(referralToken("q", "s1"));
    expect(referralToken("q", "s1")).not.toBe(referralToken("q", "s2"));
    expect(referralToken("q1", "s")).not.toBe(referralToken("q2", "s"));
    expect(referralToken("q", "s1")).toMatch(/^R[A-Z0-9]{8}$/);
  });

  it("isSelfReferral blocks same email (case-insensitive), allows different/absent", () => {
    expect(isSelfReferral("A@B.com", "a@b.com ")).toBe(true);
    expect(isSelfReferral("a@b.com", "c@d.com")).toBe(false);
    expect(isSelfReferral(null, "a@b.com")).toBe(false);
    expect(isSelfReferral("a@b.com", undefined)).toBe(false);
  });

  it("capReached only when a positive cap is met/exceeded", () => {
    expect(capReached(10, 10)).toBe(true);
    expect(capReached(11, 10)).toBe(true);
    expect(capReached(9, 10)).toBe(false);
    expect(capReached(100, undefined)).toBe(false);
    expect(capReached(0, 0)).toBe(false);
  });

  it("referralDiscountConfig maps a give/get to a single-use discount (not email-gated)", () => {
    const cfg = referralDiscountConfig("percentage", 15, "2026-01-02T00:00:00.000Z");
    expect(cfg.kind).toBe("percentage");
    expect(cfg.value).toBe(15);
    expect(cfg.usage_limit).toBe(1);
    expect(cfg.ends_at).toBe("2026-01-02T00:00:00.000Z");
    expect(referralDiscountConfig("free_shipping", 0, "x").kind).toBe("free_shipping");
    expect(referralDiscountConfig("fixed", 10, "x").kind).toBe("amount");
  });
});

const settings = (over: Partial<ResolvedReferral> = {}): ResolvedReferral => ({
  ...ENGAGEMENT_DEFAULTS.referral,
  enabled: true,
  ...over,
});

const candidate = (over: Partial<GrantCandidate> = {}): GrantCandidate => ({
  id: "r1",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  referrerEmail: "referrer@example.com",
  qualifiedCount: 0,
  settings: settings(),
  ...over,
});

describe("§M6 pickGrantableReferral (grant step)", () => {
  const order = { email: "friend@example.com", subtotal: 40 };

  it("grants an eligible pending redemption", () => {
    expect(pickGrantableReferral(order, [candidate()])?.id).toBe("r1");
  });

  it("skips a quiz whose referral is not currently enabled", () => {
    expect(pickGrantableReferral(order, [candidate({ settings: settings({ enabled: false }) })])).toBeNull();
  });

  it("enforces qualifyingSubtotal (≥, not >) and the 0 default admits any order", () => {
    const gated = candidate({ settings: settings({ qualifyingSubtotal: 50 }) });
    expect(pickGrantableReferral({ ...order, subtotal: 49.99 }, [gated])).toBeNull();
    expect(pickGrantableReferral({ ...order, subtotal: 50 }, [gated])?.id).toBe("r1");
    expect(pickGrantableReferral({ ...order, subtotal: 0 }, [candidate()])?.id).toBe("r1");
  });

  it("blocks self-referral against the ORDER email (grant-time authoritative check)", () => {
    const self = candidate({ referrerEmail: "Friend@Example.com" });
    expect(pickGrantableReferral(order, [self])).toBeNull();
    expect(pickGrantableReferral({ ...order, email: null }, [self])?.id).toBe("r1"); // no email → no self signal
  });

  it("enforces the redemption cap against GRANTED rewards", () => {
    const capped = candidate({ qualifiedCount: 2, settings: settings({ redemptionCap: 2 }) });
    expect(pickGrantableReferral(order, [capped])).toBeNull();
    expect(pickGrantableReferral(order, [candidate({ qualifiedCount: 1, settings: settings({ redemptionCap: 2 }) })])?.id).toBe("r1");
  });

  it("first touch wins: oldest ELIGIBLE candidate, at most one per order", () => {
    const older = candidate({ id: "old", createdAt: new Date("2026-06-01T00:00:00Z") });
    const newer = candidate({ id: "new", createdAt: new Date("2026-07-01T00:00:00Z") });
    expect(pickGrantableReferral(order, [newer, older])?.id).toBe("old");
    // an ineligible oldest must not block a newer eligible one
    const disabledOld = candidate({ id: "old", createdAt: new Date("2026-06-01T00:00:00Z"), settings: settings({ enabled: false }) });
    expect(pickGrantableReferral(order, [disabledOld, newer])?.id).toBe("new");
  });
});

describe("§M6 grant codes + reward phrasing", () => {
  it("referralGrantCode: QZG-/QZF- prefixed, 8 chars, injectable rand", () => {
    expect(referralGrantCode("give")).toMatch(/^QZG-[A-Z2-9]{8}$/);
    expect(referralGrantCode("get")).toMatch(/^QZF-[A-Z2-9]{8}$/);
    expect(referralGrantCode("give", () => 0)).toBe("QZG-AAAAAAAA");
    expect(referralGrantCode("give")).not.toBe(referralGrantCode("give")); // random, not deterministic
  });

  it("describeReferralReward covers all three reward types", () => {
    expect(describeReferralReward("percentage", 10)).toBe("10% off your order");
    expect(describeReferralReward("fixed", 10)).toBe("10 off your order");
    expect(describeReferralReward("free_shipping", 0)).toBe("free shipping");
  });
});
