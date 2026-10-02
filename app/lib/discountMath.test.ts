import { describe, it, expect } from "vitest";
import { cutItemPrice, discountedItemPrice } from "./discountMath";

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

describe("cutItemPrice", () => {
  it("takes a percentage cut like the per-item discount", () => {
    expect(cutItemPrice(100, { kind: "percentage", value: 10 })).toBe(90);
  });

  it("takes a fixed per-card amount, never below zero", () => {
    expect(cutItemPrice(100, { kind: "amount", value: 5 })).toBe(95);
    expect(cutItemPrice(3, { kind: "amount", value: 5 })).toBe(0);
  });

  it("returns null when there is nothing to strike", () => {
    expect(cutItemPrice(100, { kind: "amount", value: 0 })).toBeNull();
    expect(cutItemPrice(0, { kind: "amount", value: 5 })).toBeNull();
    expect(cutItemPrice(100, { kind: "percentage", value: 0 })).toBeNull();
  });
});
