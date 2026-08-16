import { describe, it, expect, vi } from "vitest";
import { collectCustomerData, redactCustomer, redactOrders, redactShop } from "./gdpr.server";

function mockPrisma(shop: { id: string } | null) {
  return {
    shop: {
      findUnique: vi.fn().mockResolvedValue(shop),
      deleteMany: vi.fn().mockResolvedValue({ count: shop ? 1 : 0 }),
    },
    emailCapture: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ email: "a@b.com", firstName: null, phone: null, quizId: "q", capturedAt: new Date() }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    backInStockRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    quizReward: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    referralToken: {
      findMany: vi.fn().mockResolvedValue([]),
      // Audit hardening: erasure NULLS token emails (never deleteMany — the
      // Referral cascade would destroy third-party redemption rows).
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    referral: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    event: {
      // 1st call = the rows being redacted; 2nd = surviving orders on those
      // sessions (none, unless a test overrides).
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          { quizId: "q1", sessionId: "s1" },
          { quizId: "q1", sessionId: "s1" }, // same session twice — one order, two rows
          { quizId: "q1", sessionId: "s2" },
        ])
        .mockResolvedValue([]),
      deleteMany: vi.fn().mockReturnValue({ count: 3 }),
    },
    quizSession: { updateMany: vi.fn().mockReturnValue({ count: 1 }) },
    session: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    // Promise.all copes with both shapes: real prisma ops are promises,
    // the redactOrders mocks return plain {count} objects.
    $transaction: vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
}

describe("gdpr X6 — data-subject requests", () => {
  it("collectCustomerData gathers captures scoped to the shop via the quiz relation", async () => {
    const p = mockPrisma({ id: "shop1" });
    const data = await collectCustomerData(p as never, "s.myshopify.com", "a@b.com");
    expect(data.captures.length).toBe(1);
    expect(p.emailCapture.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "a@b.com", quiz: { shopId: "shop1" } } }),
    );
  });

  it("collectCustomerData returns empty for an unknown shop", async () => {
    const data = await collectCustomerData(mockPrisma(null) as never, "x", "a@b.com");
    expect(data).toEqual({ captures: [], backInStock: [], rewards: [], referrals: [] });
  });

  it("redactCustomer deletes captures + back-in-stock and returns counts", async () => {
    const p = mockPrisma({ id: "shop1" });
    const res = await redactCustomer(p as never, "s", "a@b.com");
    expect(res).toEqual({ captures: 2, backInStock: 1, rewards: 0, referrals: 0 });
    expect(p.$transaction).toHaveBeenCalled();
  });

  it("redactCustomer no-ops for an unknown shop", async () => {
    const res = await redactCustomer(mockPrisma(null) as never, "x", "a@b.com");
    expect(res).toEqual({ captures: 0, backInStock: 0, rewards: 0, referrals: 0 });
  });

  it("redactShop clears sessions + the shop row (idempotent)", async () => {
    const p = mockPrisma({ id: "shop1" });
    const res = await redactShop(p as never, "s.myshopify.com");
    expect(p.session.deleteMany).toHaveBeenCalledWith({ where: { shop: "s.myshopify.com" } });
    expect(res.shop).toBe(1);
  });
});


// ── orders_to_redact (the compliance gap this closes) ──────────────────────
// Shopify's customers/redact carries order ids alongside the customer and
// requires that anything held ABOUT those orders is erased. Before this, the
// field was parsed by nobody and the obligation was silently unmet.
describe("gdpr — redactOrders", () => {
  it("deletes the order_attributed events for exactly the requested ids, shop-scoped", async () => {
    const p = mockPrisma({ id: "shop1" });
    const res = await redactOrders(p as never, "s.myshopify.com", [1234, 5678]);
    expect(res.orderEvents).toBe(3);
    const where = p.event.deleteMany.mock.calls[0]![0].where;
    expect(where.eventType).toBe("order_attributed");
    expect(where.quiz).toEqual({ shopId: "shop1" });
    // Ids arrive as NUMBERS but are stored as strings by the orders webhook.
    expect(where.OR).toEqual([
      { payload: { path: ["order_id"], equals: "1234" } },
      { payload: { path: ["order_id"], equals: "5678" } },
    ]);
  });

  it("clears QuizSession.converted for sessions left with no other order", async () => {
    const p = mockPrisma({ id: "shop1" });
    const res = await redactOrders(p as never, "s.myshopify.com", [1234]);
    // Two DISTINCT sessions among the three deleted rows.
    expect(p.quizSession.updateMany).toHaveBeenCalledTimes(2);
    expect(res.sessionsUnconverted).toBe(2);
    expect(p.quizSession.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { quizId: "q1", sessionId: "s1", converted: true },
      data: { converted: false },
    });
  });

  it("KEEPS converted when another, non-redacted order still backs the session", async () => {
    const p = mockPrisma({ id: "shop1" });
    // Both touched sessions still hold a NON-redacted order.
    p.event.findMany
      .mockReset()
      .mockResolvedValueOnce([
        { quizId: "q1", sessionId: "s1" },
        { quizId: "q1", sessionId: "s2" },
      ])
      .mockResolvedValue([
        { quizId: "q1", sessionId: "s1" },
        { quizId: "q1", sessionId: "s2" },
      ]);
    const res = await redactOrders(p as never, "s.myshopify.com", [1234]);
    expect(p.quizSession.updateMany).not.toHaveBeenCalled();
    expect(res.sessionsUnconverted).toBe(0);
    // The events themselves are still deleted — only the derived flag is kept.
    expect(res.orderEvents).toBe(3);
  });

  it("the survivor lookup EXCLUDES the ids being redacted", async () => {
    const p = mockPrisma({ id: "shop1" });
    await redactOrders(p as never, "s.myshopify.com", [1234]);
    const survivorWhere = p.event.findMany.mock.calls[1]![0].where;
    expect(survivorWhere.NOT).toEqual({
      OR: [{ payload: { path: ["order_id"], equals: "1234" } }],
    });
    expect(survivorWhere.sessionId).toEqual({ in: ["s1", "s2"] });
  });

  it("deletes and clears in ONE transaction, so a crash can't strand `converted`", async () => {
    const p = mockPrisma({ id: "shop1" });
    await redactOrders(p as never, "s.myshopify.com", [1234]);
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    // delete + one update per session left with no surviving order
    expect(p.$transaction.mock.calls[0]![0]).toHaveLength(3);
  });

  it("reads the affected sessions BEFORE deleting, or they'd be unrecoverable", async () => {
    const p = mockPrisma({ id: "shop1" });
    await redactOrders(p as never, "s.myshopify.com", [1234]);
    const readOrder = p.event.findMany.mock.invocationCallOrder[0]!;
    const deleteOrder = p.event.deleteMany.mock.invocationCallOrder[0]!;
    expect(readOrder).toBeLessThan(deleteOrder);
  });

  it("de-dupes ids and ignores blanks; an empty list touches nothing", async () => {
    const p = mockPrisma({ id: "shop1" });
    await redactOrders(p as never, "s.myshopify.com", [7, 7, " ", ""]);
    expect(p.event.deleteMany.mock.calls[0]![0].where.OR).toEqual([
      { payload: { path: ["order_id"], equals: "7" } },
    ]);

    const q = mockPrisma({ id: "shop1" });
    const res = await redactOrders(q as never, "s.myshopify.com", []);
    expect(res).toEqual({ orderEvents: 0, sessionsUnconverted: 0 });
    expect(q.event.deleteMany).not.toHaveBeenCalled();
    // An empty list must not even look the shop up.
    expect(q.shop.findUnique).not.toHaveBeenCalled();
  });

  it("unknown shop is a no-op, never a throw", async () => {
    const p = mockPrisma(null);
    expect(await redactOrders(p as never, "gone.myshopify.com", [1])).toEqual({
      orderEvents: 0,
      sessionsUnconverted: 0,
    });
    expect(p.event.deleteMany).not.toHaveBeenCalled();
  });
});
