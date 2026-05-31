import { describe, expect, it } from "vitest";
import { buildDiscountInput } from "./discount.server";
import type { DiscountConfig } from "./quizSchema";

const ISO = "2026-06-01T00:00:00.000Z";
const base: DiscountConfig = {
  enabled: true,
  kind: "percentage",
  value: 10,
  once_per_customer: true,
  title: "Quiz reward",
};

describe("buildDiscountInput", () => {
  it("builds a percentage discount as a 0–1 fraction on all items", () => {
    const input = buildDiscountInput(base, "QUIZ-ABC123", ISO) as any;
    expect(input.code).toBe("QUIZ-ABC123");
    expect(input.title).toBe("Quiz reward");
    expect(input.startsAt).toBe(ISO);
    expect(input.appliesOncePerCustomer).toBe(true);
    expect(input.customerSelection).toEqual({ all: true });
    expect(input.customerGets.items).toEqual({ all: true });
    expect(input.customerGets.value).toEqual({ percentage: 0.1 });
  });

  it("clamps an out-of-range percentage to [0,1]", () => {
    expect((buildDiscountInput({ ...base, value: 150 }, "C", ISO) as any).customerGets.value).toEqual({
      percentage: 1,
    });
  });

  it("builds a fixed-amount discount", () => {
    const input = buildDiscountInput({ ...base, kind: "amount", value: 5 }, "C", ISO) as any;
    expect(input.customerGets.value).toEqual({
      discountAmount: { amount: "5", appliesOnEachItem: false },
    });
  });

  it("respects once_per_customer = false and a custom title", () => {
    const input = buildDiscountInput(
      { ...base, once_per_customer: false, title: "VIP" },
      "C",
      ISO,
    ) as any;
    expect(input.appliesOncePerCustomer).toBe(false);
    expect(input.title).toBe("VIP");
  });
});
