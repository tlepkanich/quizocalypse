import { describe, it, expect } from "vitest";
import { referralToken, isSelfReferral, capReached, referralDiscountConfig } from "./referral";

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
