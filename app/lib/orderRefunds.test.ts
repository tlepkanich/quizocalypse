import { describe, expect, it } from "vitest";
import { refundReturnLines, refundTime, returnsByProduct } from "./orderRefunds";

describe("refundReturnLines", () => {
  it("keeps only lines Shopify marks as a return, merged per product", () => {
    const lines = refundReturnLines({
      refund_line_items: [
        { quantity: 1, restock_type: "return", line_item: { product_id: 11 } },
        { quantity: 2, restock_type: "return", line_item: { product_id: 11, variant_id: 5 } },
        { quantity: 1, restock_type: "cancel", line_item: { product_id: 12 } },
        { quantity: 1, restock_type: "no_restock", line_item: { product_id: 13 } },
        { quantity: 0, restock_type: "return", line_item: { product_id: 14 } },
        { quantity: 1, restock_type: "return", line_item: null },
      ],
    });
    expect(lines).toEqual([{ product_id: "gid://shopify/Product/11", quantity: 3 }]);
  });

  it("a refund with no return lines yields nothing", () => {
    expect(refundReturnLines({ refund_line_items: [] })).toEqual([]);
    expect(refundReturnLines({})).toEqual([]);
  });
});

describe("refundTime", () => {
  it("prefers processed_at, then created_at, then the fallback", () => {
    const fb = new Date("2026-01-01T00:00:00Z");
    expect(refundTime({ processed_at: "2026-02-02T00:00:00Z", created_at: "2026-02-01T00:00:00Z" }, fb).toISOString()).toBe(
      "2026-02-02T00:00:00.000Z",
    );
    expect(refundTime({ created_at: "2026-02-01T00:00:00Z" }, fb).toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(refundTime({}, fb)).toBe(fb);
  });
});

describe("returnsByProduct", () => {
  const ev = (refundId: string, orderId: string, ordered: string, refunded: string, returns: Array<[string, number]>) => ({
    payload: {
      order_id: orderId,
      refund_id: refundId,
      order_created_at: ordered,
      refunded_at: refunded,
      returns: returns.map(([product_id, quantity]) => ({ product_id, quantity })),
    },
  });

  it("dedupes a refund copied onto several sessions, and takes the median days", () => {
    const out = returnsByProduct([
      ev("r1", "o1", "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", [["p1", 1]]),
      ev("r1", "o1", "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", [["p1", 1]]),
      ev("r2", "o2", "2026-09-01T00:00:00Z", "2026-09-11T00:00:00Z", [["p1", 2], ["p2", 1]]),
    ]);
    expect(out.get("p1")).toEqual({ units: 3, medianDays: 7 });
    expect(out.get("p2")).toEqual({ units: 1, medianDays: 10 });
  });

  it("counts only the orders being reported on", () => {
    const out = returnsByProduct(
      [ev("r1", "o1", "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", [["p1", 1]])],
      new Set(["o2"]),
    );
    expect(out.size).toBe(0);
  });
});
