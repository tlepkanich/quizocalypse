import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { action } from "../routes/webhooks.refunds.create";

// refunds/create → order_refunded events (ANALYTICS-HANDOFF.md, Data work 2).
// Lives in app/lib so Remix's Vite plugin doesn't treat it as a route.
vi.mock("../shopify.server", () => ({ authenticate: { webhook: vi.fn() } }));
vi.mock("../db.server", () => ({
  default: {
    shop: { findUnique: vi.fn() },
    event: { findMany: vi.fn(), findFirst: vi.fn(), createMany: vi.fn() },
  },
}));

const webhook = (authenticate as unknown as { webhook: Mock }).webhook;
const p = prisma as unknown as {
  shop: { findUnique: Mock };
  event: { findMany: Mock; findFirst: Mock; createMany: Mock };
};

const args = () =>
  ({ request: new Request("https://app.example/webhook", { method: "POST" }), params: {}, context: {} }) as unknown as ActionFunctionArgs;

const REFUND = {
  id: 77,
  order_id: 1234,
  processed_at: "2026-09-08T00:00:00Z",
  refund_line_items: [
    { quantity: 1, restock_type: "return", line_item: { product_id: 11 } },
    { quantity: 1, restock_type: "cancel", line_item: { product_id: 12 } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  webhook.mockResolvedValue({ topic: "REFUNDS_CREATE", shop: "s.myshopify.com", payload: REFUND });
  p.shop.findUnique.mockResolvedValue({ id: "shop1" });
  p.event.findMany.mockResolvedValue([
    { quizId: "q1", sessionId: "s1", payload: { order_id: "1234", order_created_at: "2026-09-01T00:00:00Z" }, ts: new Date() },
    { quizId: "q1", sessionId: "s2", payload: { order_id: "1234" }, ts: new Date("2026-09-02T00:00:00Z") },
  ]);
  p.event.findFirst.mockResolvedValue(null);
  p.event.createMany.mockResolvedValue({ count: 2 });
});

describe("webhooks.refunds.create", () => {
  it("writes one order_refunded copy per session holding the attributed order, returns only", async () => {
    const res = await action(args());
    expect(res.status).toBe(200);
    expect(p.event.findMany.mock.calls[0]![0].where).toMatchObject({
      eventType: "order_attributed",
      quiz: { shopId: "shop1" },
      payload: { path: ["order_id"], equals: "1234" },
    });
    const data = p.event.createMany.mock.calls[0]![0].data as Array<{ sessionId: string; eventType: string; payload: Record<string, unknown> }>;
    expect(data.map((d) => d.sessionId)).toEqual(["s1", "s2"]);
    expect(data[0]!.eventType).toBe("order_refunded");
    expect(data[0]!.payload).toMatchObject({
      order_id: "1234",
      refund_id: "77",
      refunded_at: "2026-09-08T00:00:00.000Z",
      order_created_at: "2026-09-01T00:00:00Z",
      returns: [{ product_id: "gid://shopify/Product/11", quantity: 1 }],
    });
    // An older order event without order_created_at falls back to its receipt time.
    expect(data[1]!.payload.order_created_at).toBe("2026-09-02T00:00:00.000Z");
  });

  it("is idempotent on the refund id (Shopify retries)", async () => {
    p.event.findFirst.mockResolvedValue({ id: "e1" });
    await action(args());
    expect(p.event.createMany).not.toHaveBeenCalled();
  });

  it("ignores refunds of orders the quiz was not credited with", async () => {
    p.event.findMany.mockResolvedValue([]);
    await action(args());
    expect(p.event.createMany).not.toHaveBeenCalled();
  });

  it("ignores refunds with no return lines without reading anything", async () => {
    webhook.mockResolvedValue({
      topic: "REFUNDS_CREATE",
      shop: "s.myshopify.com",
      payload: { ...REFUND, refund_line_items: [{ quantity: 1, restock_type: "no_restock", line_item: { product_id: 11 } }] },
    });
    await action(args());
    expect(p.event.findMany).not.toHaveBeenCalled();
  });
});
