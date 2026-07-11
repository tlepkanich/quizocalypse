import { beforeEach, describe, expect, it, vi } from "vitest";
import { grantReferralForOrder, repairCodelessReferrals } from "./referralGrant.server";
import prisma from "../db.server";
import { createCodeDiscount } from "./discount.server";
import { sendEmail } from "./email.server";
import { unauthenticated } from "../shopify.server";
import { reportError } from "./log.server";

// §M6 grant-step orchestration. The pure eligibility rules are covered in
// referral.test.ts — these tests pin the I/O shell: the CAS lock, mint order,
// revert-on-failure, and detached delivery.

vi.mock("../db.server", () => ({
  default: {
    referral: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn() },
}));
vi.mock("./discount.server", () => ({ createCodeDiscount: vi.fn() }));
vi.mock("./email.server", () => ({ sendEmail: vi.fn() }));
vi.mock("./log.server", () => ({
  logFor: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  reportError: vi.fn(),
}));

const db = vi.mocked(prisma as unknown as {
  referral: {
    findMany: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
});
const mockedMint = vi.mocked(createCodeDiscount);
const mockedSend = vi.mocked(sendEmail);
const mockedAdmin = vi.mocked(unauthenticated.admin);
const mockedReport = vi.mocked(reportError);

const NOW = Date.parse("2026-07-11T00:00:00.000Z");

// Referral is enabled via ACCOUNT defaults (Shop.engagementDefaults) so the
// quiz doc can stay unparseable ({}) — resolveEngagement falls through, which
// is also the dual-model-safe path (no doc is ever written here).
const baseOrder = {
  shopId: "shop1",
  shopDomain: "test.myshopify.com",
  shopSource: "shopify",
  engagementDefaults: { referral: { enabled: true } },
  orderEmail: "friend@example.com",
  subtotal: 40,
  nowMs: NOW,
};

const pendingRow = (over: Record<string, unknown> = {}) => ({
  id: "ref1",
  tokenValue: "RTOKEN01",
  redeemerEmail: "friend@example.com",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  token: { email: "referrer@example.com" },
  quiz: { publishedJson: {} },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.referral.findMany.mockResolvedValue([pendingRow()]);
  db.referral.groupBy.mockResolvedValue([]);
  db.referral.updateMany.mockResolvedValue({ count: 1 });
  db.referral.update.mockResolvedValue({});
  mockedAdmin.mockResolvedValue({ admin: { graphql: vi.fn() } } as never);
  mockedMint.mockResolvedValue({ ok: true });
  mockedSend.mockResolvedValue({ sent: true, transport: "resend" });
});

describe("grantReferralForOrder", () => {
  it("no order email → no queries at all", async () => {
    await grantReferralForOrder({ ...baseOrder, orderEmail: null });
    expect(db.referral.findMany).not.toHaveBeenCalled();
  });

  it("no pending redemption for this email → no-op", async () => {
    db.referral.findMany.mockResolvedValue([]);
    await grantReferralForOrder(baseOrder);
    expect(db.referral.updateMany).not.toHaveBeenCalled();
  });

  it("happy path: CAS → mint give+get → store codes → deliver both emails", async () => {
    await grantReferralForOrder(baseOrder);

    // CAS lock: only a still-pending row flips.
    expect(db.referral.updateMany).toHaveBeenCalledWith({
      where: { id: "ref1", status: "pending" },
      data: { status: "qualified" },
    });

    expect(mockedMint).toHaveBeenCalledTimes(2);
    const [giveCall, getCall] = mockedMint.mock.calls;
    const giveCode = giveCall?.[2] ?? "";
    const getCode = getCall?.[2] ?? "";
    expect(giveCode).toMatch(/^QZG-/);
    expect(getCode).toMatch(/^QZF-/);
    // Both configs are single-use with the shared expiry.
    expect(giveCall?.[1].usage_limit).toBe(1);
    expect(giveCall?.[1].ends_at).toBe(getCall?.[1].ends_at);

    expect(db.referral.update).toHaveBeenCalledWith({
      where: { id: "ref1" },
      data: { giveCode, getCode },
    });

    // Delivery is detached — flush it, then assert referrer + friend sends.
    await vi.waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(2));
    const [toReferrer, toFriend] = mockedSend.mock.calls;
    expect(toReferrer?.[0].to).toBe("referrer@example.com");
    expect(toReferrer?.[0].text).toContain(giveCode);
    expect(toFriend?.[0].to).toBe("friend@example.com");
    expect(toFriend?.[0].text).toContain(getCode);
  });

  it("subtotal below qualifyingSubtotal → stays pending (no CAS)", async () => {
    await grantReferralForOrder({
      ...baseOrder,
      engagementDefaults: { referral: { enabled: true, qualifyingSubtotal: 50 } },
      subtotal: 49,
    });
    expect(db.referral.updateMany).not.toHaveBeenCalled();
  });

  it("referral disabled (the default) → no grant", async () => {
    await grantReferralForOrder({ ...baseOrder, engagementDefaults: {} });
    expect(db.referral.updateMany).not.toHaveBeenCalled();
  });

  it("redemption cap counts qualified grants for the token", async () => {
    db.referral.groupBy.mockResolvedValue([{ tokenValue: "RTOKEN01", _count: { _all: 10 } }]);
    await grantReferralForOrder(baseOrder); // default cap = 10
    expect(db.referral.updateMany).not.toHaveBeenCalled();
  });

  it("standalone / non-Shopify shop → leaves the row pending, mints nothing", async () => {
    await grantReferralForOrder({ ...baseOrder, shopSource: "standalone", shopDomain: "studio.local" });
    expect(db.referral.updateMany).not.toHaveBeenCalled();
    expect(mockedMint).not.toHaveBeenCalled();
  });

  it("CAS race lost (webhook redelivery) → no mint", async () => {
    db.referral.updateMany.mockResolvedValue({ count: 0 });
    await grantReferralForOrder(baseOrder);
    expect(mockedMint).not.toHaveBeenCalled();
    expect(db.referral.update).not.toHaveBeenCalled();
  });

  it("mint failure → reverts qualified back to pending, no codes stored, no email", async () => {
    mockedMint.mockResolvedValue({ ok: false, warning: "boom" });
    await grantReferralForOrder(baseOrder);
    expect(db.referral.updateMany).toHaveBeenLastCalledWith({
      where: { id: "ref1", status: "qualified" },
      data: { status: "pending" },
    });
    expect(db.referral.update).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedReport).toHaveBeenCalled();
  });

  it("second mint failure (give ok, get fails) also reverts — retry uses fresh codes", async () => {
    mockedMint.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, warning: "get failed" });
    await grantReferralForOrder(baseOrder);
    expect(db.referral.updateMany).toHaveBeenLastCalledWith({
      where: { id: "ref1", status: "qualified" },
      data: { status: "pending" },
    });
    expect(db.referral.update).not.toHaveBeenCalled();
  });

  it("referrer email unknown → give code stored, only the friend is emailed", async () => {
    db.referral.findMany.mockResolvedValue([pendingRow({ token: { email: null } })]);
    await grantReferralForOrder(baseOrder);
    expect(db.referral.update).toHaveBeenCalled();
    await vi.waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(1));
    expect(mockedSend.mock.calls[0]?.[0].to).toBe("friend@example.com");
  });

  it("never throws — a DB failure is reported, the webhook survives", async () => {
    db.referral.findMany.mockRejectedValue(new Error("db down"));
    await expect(grantReferralForOrder(baseOrder)).resolves.toBeUndefined();
    expect(mockedReport).toHaveBeenCalled();
  });
});

// Audit M1 — the codeless-grant repair pass (exported separately so these
// mocks never collide with the grant tests above).
describe("repairCodelessReferrals", () => {
  const stuckRow = (over: Record<string, unknown> = {}) => ({
    id: "stuck1",
    redeemerEmail: "friend@example.com",
    token: { email: "referrer@example.com" },
    quiz: { publishedJson: {} },
    ...over,
  });

  it("no stuck rows → no admin session, no mints", async () => {
    db.referral.findMany.mockResolvedValue([]);
    await repairCodelessReferrals(baseOrder);
    expect(mockedAdmin).not.toHaveBeenCalled();
    expect(mockedMint).not.toHaveBeenCalled();
  });

  it("standalone shop → bails before any query", async () => {
    await repairCodelessReferrals({ ...baseOrder, shopSource: "standalone" });
    expect(db.referral.findMany).not.toHaveBeenCalled();
  });

  it("stuck row → mints give+get FIRST, then CAS-stores on giveCode:null, then delivers", async () => {
    db.referral.findMany.mockResolvedValue([stuckRow()]);
    await repairCodelessReferrals(baseOrder);
    expect(mockedMint).toHaveBeenCalledTimes(2);
    expect(db.referral.updateMany).toHaveBeenCalledWith({
      where: { id: "stuck1", status: "qualified", giveCode: null },
      data: { giveCode: expect.stringMatching(/^QZG-/), getCode: expect.stringMatching(/^QZF-/) },
    });
    await vi.waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(2));
  });

  it("mint failure → row stays codeless (no store, no email), retried later", async () => {
    db.referral.findMany.mockResolvedValue([stuckRow()]);
    mockedMint.mockResolvedValue({ ok: false, warning: "boom" });
    await repairCodelessReferrals(baseOrder);
    expect(db.referral.updateMany).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("CAS-store lost to a concurrent repairer → codes orphan, no delivery", async () => {
    db.referral.findMany.mockResolvedValue([stuckRow()]);
    db.referral.updateMany.mockResolvedValue({ count: 0 });
    await repairCodelessReferrals(baseOrder);
    expect(mockedMint).toHaveBeenCalledTimes(2);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("never throws — a DB failure is reported, the webhook survives", async () => {
    db.referral.findMany.mockRejectedValue(new Error("db down"));
    await expect(repairCodelessReferrals(baseOrder)).resolves.toBeUndefined();
    expect(mockedReport).toHaveBeenCalled();
  });
});
