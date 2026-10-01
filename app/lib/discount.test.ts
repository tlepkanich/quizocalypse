import { describe, expect, it } from "vitest";
import { buildDiscountInput, buildFreeShippingInput, withoutDiscountCode } from "./discount.server";
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
    expect(input.context).toEqual({ all: "ALL" });
    expect(input).not.toHaveProperty("customerSelection");
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
    expect(input.context).toEqual({ all: "ALL" });
    expect(input).not.toHaveProperty("customerSelection");
    expect(input.usageLimit).toBe(10);
    // free shipping has no customerGets.value/items
    expect(input.customerGets).toBeUndefined();
  });
});

describe("withoutDiscountCode (Duplicate — results handoff §4 defect 2)", () => {
  it("drops only discount_config.code", () => {
    const draft = { quiz_id: "q", discount_config: { enabled: true, code: "QUIZ-AB12CD", value: 10 } };
    expect(withoutDiscountCode(draft)).toEqual({ quiz_id: "q", discount_config: { enabled: true, value: 10 } });
    expect(draft.discount_config.code).toBe("QUIZ-AB12CD");
  });
  it("passes through a draft with no code, or no object at all", () => {
    const draft = { quiz_id: "q", discount_config: { enabled: false } };
    expect(withoutDiscountCode(draft)).toBe(draft);
    expect(withoutDiscountCode(null)).toBeNull();
  });
});

// Results handoff §8/§12 — every editor field reaches its Shopify field, and
// a legacy config (none of the new keys) sends nothing new.
type BasicInput = {
  combinesWith: Record<string, boolean>;
  customerGets: {
    appliesOnOneTimePurchase: boolean;
    appliesOnSubscription: boolean;
    value: { discountAmount: { appliesOnEachItem: boolean } };
  };
  recurringCycleLimit: number;
};
type ShippingInput = {
  destination: unknown;
  maximumShippingPrice: number;
  appliesOnOneTimePurchase: boolean;
  appliesOnSubscription: boolean;
  combinesWith: Record<string, boolean>;
};
describe("editor fields → Admin input (2026-04)", () => {
  it("a legacy config sends no new keys", () => {
    const input = buildDiscountInput(DiscountConfig.parse({ enabled: true }), "C", "2026-01-01T00:00:00Z");
    expect(Object.keys(input).sort()).toEqual(
      ["appliesOncePerCustomer", "code", "context", "customerGets", "startsAt", "title"].sort(),
    );
    expect(Object.keys(input.customerGets as object).sort()).toEqual(["items", "value"]);
  });
  it("maps combinations, purchase type, recurring limit and once-per-order", () => {
    const cfg = DiscountConfig.parse({
      enabled: true,
      kind: "amount",
      value: 10,
      applies_to: "products",
      applies_product_ids: ["gid://shopify/Product/1"],
      applies_on_each_item: true,
      combines: { product: true, order: false, shipping: true },
      purchase: "both",
      recurring_limit: 0,
    });
    const input = buildDiscountInput(cfg, "C", "2026-01-01T00:00:00Z") as unknown as BasicInput;
    expect(input.combinesWith).toEqual({ productDiscounts: true, orderDiscounts: false, shippingDiscounts: true });
    expect(input.customerGets.appliesOnOneTimePurchase).toBe(true);
    expect(input.customerGets.appliesOnSubscription).toBe(true);
    expect(input.customerGets.value.discountAmount.appliesOnEachItem).toBe(true);
    expect(input.recurringCycleLimit).toBe(0);
  });
  it("free shipping: countries, rate cap, top-level purchase flags, no shipping combination", () => {
    const cfg = DiscountConfig.parse({
      enabled: true,
      kind: "free_shipping",
      shipping_countries: ["US", "CA"],
      max_shipping_price: 12,
      purchase: "onetime",
      combines: { product: true, order: true, shipping: true },
    });
    const input = buildFreeShippingInput(cfg, "C", "2026-01-01T00:00:00Z") as unknown as ShippingInput;
    expect(input.destination).toEqual({ countries: { add: ["US", "CA"] } });
    expect(input.maximumShippingPrice).toBe(12);
    expect(input.appliesOnOneTimePurchase).toBe(true);
    expect(input.appliesOnSubscription).toBe(false);
    expect(input).not.toHaveProperty("recurringCycleLimit");
    expect(input.combinesWith).toEqual({ productDiscounts: true, orderDiscounts: true });
  });
});
