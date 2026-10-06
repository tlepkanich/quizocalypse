import { describe, expect, it } from "vitest";
import { lineRevenueByProduct, orderLineItems, readLineItems } from "./orderLines";

const G = (n: number) => `gid://shopify/Product/${n}`;

describe("orderLineItems", () => {
  it("saves product, variant, quantity and the line total after discounts", () => {
    const lines = orderLineItems([
      { product_id: 1, variant_id: 11, quantity: 2, price: "38.00", discount_allocations: [{ amount: "6.00" }] },
      { product_id: 2, variant_id: null, quantity: 1, price: "24.50", total_discount: "0.00" },
    ]);
    expect(lines).toEqual([
      { product_id: G(1), variant_id: "gid://shopify/ProductVariant/11", quantity: 2, line_total: "70.00" },
      { product_id: G(2), variant_id: null, quantity: 1, line_total: "24.50" },
    ]);
  });

  it("order-level discount allocations win over the line's own total_discount", () => {
    const [line] = orderLineItems([
      { product_id: 1, quantity: 1, price: "50.00", total_discount: "5.00", discount_allocations: [{ amount: "10.00" }] },
    ]);
    expect(line!.line_total).toBe("40.00");
  });

  it("drops lines with no product and never goes negative", () => {
    const lines = orderLineItems([
      { product_id: null, quantity: 1, price: "5.00" },
      { product_id: 3, quantity: 1, price: "5.00", discount_allocations: [{ amount: "9.00" }] },
    ]);
    expect(lines).toEqual([{ product_id: G(3), variant_id: null, quantity: 1, line_total: "0.00" }]);
  });
});

describe("readLineItems", () => {
  it("is null for an order saved before line items were captured", () => {
    expect(readLineItems({ order_id: "o1", line_item_product_ids: [G(1)] })).toBeNull();
    expect(readLineItems({ order_id: "o1", line_items: [] })).toEqual([]);
  });
});

describe("lineRevenueByProduct", () => {
  const order = (id: string, lines: unknown, ts = 1000, createdAt?: string) => ({
    ts,
    payload: { order_id: id, line_items: lines, ...(createdAt ? { order_created_at: createdAt } : {}) },
  });

  it("dedupes by order_id: one order that won two sessions counts once", () => {
    const lines = [{ product_id: G(1), variant_id: null, quantity: 2, line_total: "70.00" }];
    const sum = lineRevenueByProduct([order("o1", lines), order("o1", lines)]);
    expect(sum.byProduct.get(G(1))).toEqual({ revenue: 70, units: 2, orders: 1 });
    expect(sum.ordersWithLines).toBe(1);
  });

  it("two variants of one product in one order are one order of it", () => {
    const sum = lineRevenueByProduct([
      order("o1", [
        { product_id: G(1), variant_id: "v1", quantity: 1, line_total: "10.00" },
        { product_id: G(1), variant_id: "v2", quantity: 3, line_total: "30.00" },
      ]),
    ]);
    expect(sum.byProduct.get(G(1))).toEqual({ revenue: 40, units: 4, orders: 1 });
  });

  it("skips orders without saved lines and reports the earliest order that has them", () => {
    const sum = lineRevenueByProduct([
      { ts: 500, payload: { order_id: "old", line_item_product_ids: [G(1)] } },
      order("o2", [{ product_id: G(1), variant_id: null, quantity: 1, line_total: "5.00" }], 9000, "2026-10-01T00:00:00.000Z"),
      order("o3", [{ product_id: G(2), variant_id: null, quantity: 1, line_total: "7.00" }], 4000),
    ]);
    expect(sum.ordersWithLines).toBe(2);
    expect(sum.since).toBe(4000);
    expect(sum.byProduct.get(G(1))!.orders).toBe(1);
  });
});
