import { describe, expect, it } from "vitest";
import { buildDiscountInput, buildFreeShippingInput } from "./discount.server";
import { DiscountConfig } from "./quizSchema";

const ISO = "2026-06-01T00:00:00.000Z";
const base = DiscountConfig.parse({
  enabled: true,
  kind: "percentage",
  value: 10,
  once_per_customer: true,
  title: "Quiz reward",
});

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

  it("scopes items to specific collections / products (spec §4 applies-to)", () => {
    const coll = buildDiscountInput(
      { ...base, applies_to: "collections", applies_collection_ids: ["gid://c/1"] },
      "C",
      ISO,
    ) as any;
    expect(coll.customerGets.items).toEqual({ collections: { add: ["gid://c/1"] } });
    const prod = buildDiscountInput(
      { ...base, applies_to: "products", applies_product_ids: ["gid://p/9"] },
      "C",
      ISO,
    ) as any;
    expect(prod.customerGets.items).toEqual({ products: { productsToAdd: ["gid://p/9"] } });
  });

  it("carries usage cap, end date, and minimum requirement (spec §4)", () => {
    const subtotal = buildDiscountInput(
      { ...base, usage_limit: 100, ends_at: ISO, minimum_subtotal: 50 },
      "C",
      ISO,
    ) as any;
    expect(subtotal.usageLimit).toBe(100);
    expect(subtotal.endsAt).toBe(ISO);
    expect(subtotal.minimumRequirement).toEqual({
      subtotal: { greaterThanOrEqualToSubtotal: "50" },
    });
    const qty = buildDiscountInput({ ...base, minimum_quantity: 3 }, "C", ISO) as any;
    expect(qty.minimumRequirement).toEqual({
      quantity: { greaterThanOrEqualToQuantity: "3" },
    });
  });
});

describe("buildFreeShippingInput", () => {
  it("builds a free-shipping discount to all destinations with shared terms", () => {
    const input = buildFreeShippingInput(
      { ...base, kind: "free_shipping", usage_limit: 10 },
      "FREESHIP",
      ISO,
    ) as any;
    expect(input.code).toBe("FREESHIP");
    expect(input.destination).toEqual({ all: true });
    expect(input.customerSelection).toEqual({ all: true });
    expect(input.usageLimit).toBe(10);
    // free shipping has no customerGets.value/items
    expect(input.customerGets).toBeUndefined();
  });
});
