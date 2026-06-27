import { describe, it, expect } from "vitest";
import { discountedItemPrice } from "./discountMath";

describe("discountedItemPrice", () => {
  it("applies a percentage off", () => {
    expect(discountedItemPrice(100, 20)).toBe(80);
    expect(discountedItemPrice(49.99, 10)).toBeCloseTo(44.991, 3);
  });

  it("returns null when there's no reduction to show", () => {
    expect(discountedItemPrice(100, 0)).toBeNull();
    expect(discountedItemPrice(100, -5)).toBeNull();
  });

  it("clamps a percentage above 100 to a free item", () => {
    expect(discountedItemPrice(100, 150)).toBe(0);
  });

  it("returns null for a non-positive or non-finite price", () => {
    expect(discountedItemPrice(0, 20)).toBeNull();
    expect(discountedItemPrice(-10, 20)).toBeNull();
    expect(discountedItemPrice(Number.NaN, 20)).toBeNull();
  });
});
