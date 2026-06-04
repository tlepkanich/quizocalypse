import { describe, expect, it } from "vitest";
import { analyzeBucketBalance, bucketBalanceMessage } from "./bucketBalance";

describe("analyzeBucketBalance", () => {
  it("reports a balanced spread as not imbalanced", () => {
    const b = analyzeBucketBalance([10, 10, 10]);
    expect(b.imbalanced).toBe(false);
    expect(b.oversized).toEqual([]);
    expect(b.empty).toEqual([]);
  });

  it("flags the lopsided 7-bucket skincare case (66 of 124 = 53%)", () => {
    const b = analyzeBucketBalance([66, 10, 21, 6, 4, 5, 12]);
    expect(b.topIndex).toBe(0);
    expect(b.topShare).toBeCloseTo(0.532, 2);
    expect(b.oversized).toEqual([0]);
    expect(b.imbalanced).toBe(true);
  });

  it("flags empty buckets", () => {
    const b = analyzeBucketBalance([10, 0, 10]);
    expect(b.empty).toEqual([1]);
    expect(b.imbalanced).toBe(true);
  });

  it("requires a big share to flag with few buckets (50/50 is fine, 90/10 isn't)", () => {
    expect(analyzeBucketBalance([50, 50]).oversized).toEqual([]);
    expect(analyzeBucketBalance([90, 10]).oversized).toEqual([0]); // >75% with 2 buckets
  });

  it("handles all-empty / single-bucket without dividing by zero", () => {
    expect(analyzeBucketBalance([0, 0]).imbalanced).toBe(true); // both empty
    expect(analyzeBucketBalance([5]).imbalanced).toBe(false); // one bucket, nothing to balance
    expect(analyzeBucketBalance([]).imbalanced).toBe(false);
  });
});

describe("bucketBalanceMessage", () => {
  it("returns null when balanced", () => {
    expect(
      bucketBalanceMessage([
        { name: "A", count: 10 },
        { name: "B", count: 12 },
      ]),
    ).toBeNull();
  });

  it("prioritizes empty buckets over skew", () => {
    const msg = bucketBalanceMessage([
      { name: "Big", count: 80 },
      { name: "Empty", count: 0 },
      { name: "Mid", count: 20 },
    ]);
    expect(msg).toContain('"Empty"');
    expect(msg).toContain("fall back to the default collection");
  });

  it("describes an oversized bucket with its share", () => {
    const msg = bucketBalanceMessage([
      { name: "Beauty Enthusiast", count: 66 },
      { name: "Slope Ready", count: 12 },
      { name: "Everyday", count: 10 },
      { name: "Gear", count: 21 },
      { name: "Gift", count: 6 },
      { name: "Home", count: 4 },
      { name: "Premium", count: 5 },
    ]);
    expect(msg).toContain('"Beauty Enthusiast"');
    expect(msg).toContain("53%");
    expect(msg).toContain("skew");
  });
});
