import { describe, it, expect } from "vitest";
import { rewardToDiscountConfig, rewardCode, rewardExpiresAt, rewardCapReached, type ResolvedReward } from "./rewardDiscount";

const reward = (over: Partial<ResolvedReward> = {}): ResolvedReward =>
  ({ enabled: true, type: "percentage", odds: "equal", reveal: "tap", expiryHours: 24, emailGated: true, ...over }) as ResolvedReward;

describe("§M3 reward → discount mapping", () => {
  it("percentage → kind=percentage, single-use, expiring", () => {
    const cfg = rewardToDiscountConfig(reward({ type: "percentage" }), 15, "2026-01-02T00:00:00.000Z");
    expect(cfg.kind).toBe("percentage");
    expect(cfg.value).toBe(15);
    expect(cfg.usage_limit).toBe(1);
    expect(cfg.once_per_customer).toBe(true);
    expect(cfg.ends_at).toBe("2026-01-02T00:00:00.000Z");
    expect(cfg.enabled).toBe(true);
  });

  it("fixed → kind=amount; free_shipping → kind=free_shipping", () => {
    expect(rewardToDiscountConfig(reward({ type: "fixed" }), 10, "x").kind).toBe("amount");
    expect(rewardToDiscountConfig(reward({ type: "free_shipping" }), 0, "x").kind).toBe("free_shipping");
  });

  it("minSpend maps to minimum_subtotal (omitted when absent)", () => {
    expect(rewardToDiscountConfig(reward({ minSpend: 50 }), 15, "x").minimum_subtotal).toBe(50);
    expect(rewardToDiscountConfig(reward(), 15, "x").minimum_subtotal).toBeUndefined();
  });

  it("rewardCode is deterministic per session + prefixed", () => {
    expect(rewardCode("sess-1")).toBe(rewardCode("sess-1"));
    expect(rewardCode("sess-1")).not.toBe(rewardCode("sess-2"));
    expect(rewardCode("sess-1")).toMatch(/^QZR-[A-Z0-9]{6}$/);
  });

  it("rewardExpiresAt adds expiryHours (default 24)", () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    expect(rewardExpiresAt(base, 24)).toBe("2026-01-02T00:00:00.000Z");
    expect(rewardExpiresAt(base, undefined)).toBe("2026-01-02T00:00:00.000Z");
    expect(rewardExpiresAt(base, 1)).toBe("2026-01-01T01:00:00.000Z");
  });

  it("rewardCapReached — uncapped is always false; cap is inclusive (>=)", () => {
    // undefined cap = uncapped: never reached, regardless of count.
    expect(rewardCapReached(0, undefined)).toBe(false);
    expect(rewardCapReached(9999, undefined)).toBe(false);
    // below cap → false; at/over cap → true (the Nth code is the last one issued
    // BEFORE the count hits the cap, so count===cap means exhausted).
    expect(rewardCapReached(0, 100)).toBe(false);
    expect(rewardCapReached(99, 100)).toBe(false);
    expect(rewardCapReached(100, 100)).toBe(true);
    expect(rewardCapReached(101, 100)).toBe(true);
    // cap of 1: first claim (count 0) allowed, second (count 1) blocked.
    expect(rewardCapReached(0, 1)).toBe(false);
    expect(rewardCapReached(1, 1)).toBe(true);
  });
});
