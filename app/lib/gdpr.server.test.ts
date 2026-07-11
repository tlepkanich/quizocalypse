import { describe, it, expect, vi } from "vitest";
import { collectCustomerData, redactCustomer, redactShop } from "./gdpr.server";

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
    session: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
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
