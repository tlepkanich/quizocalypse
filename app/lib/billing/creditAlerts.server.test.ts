import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../../db.server";
import { sendEmail } from "../email.server";
import { loadCycleFiguresIfStarted } from "./account.server";
import { PLANS } from "./catalog";
import { checkCreditAlerts } from "./creditAlerts.server";
import { creditFigures } from "./creditMath";

vi.mock("../../db.server", () => ({
  default: { shopBilling: { updateMany: vi.fn() }, shop: { findUnique: vi.fn() } },
}));
vi.mock("../email.server", () => ({ sendEmail: vi.fn() }));
vi.mock("../log.server", () => ({
  reportError: vi.fn(),
  logFor: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("./account.server", () => ({
  loadCycleFiguresIfStarted: vi.fn(),
  billEmailLinks: () => ({ account: "https://app.example/studio/account", changePlan: "https://app.example/studio/account/plan" }),
}));

const p = prisma as unknown as { shopBilling: { updateMany: Mock }; shop: { findUnique: Mock } };
const send = sendEmail as unknown as Mock;
const load = loadCycleFiguresIfStarted as unknown as Mock;

const CYCLE_START = new Date("2026-10-01T00:00:00Z");
const NOW = new Date("2026-10-10T12:00:00Z");

/** A shop's state with `used` engagements on Starter (400 credits). */
function state(used: number, billing: Record<string, unknown> = {}) {
  return {
    billing: {
      id: "b1",
      shopId: "s1",
      plan: "starter",
      status: "active",
      cycleStart: CYCLE_START,
      cycleEnd: new Date("2026-10-31T00:00:00Z"),
      billEmails: ["a@store.com", "b@store.com"],
      emailAlertNear: true,
      emailAlertOut: true,
      alertNearSentFor: null,
      alertOutSentFor: null,
      ...billing,
    },
    figures: creditFigures(
      PLANS.starter,
      { everyCycle: 0, oneTime: 0, rolledOver: 0 },
      { engagements: used, ai: [] },
    ),
  };
}

// The check runs at most once a minute per shop, in process memory — each
// test uses its own shop id unless it tests that limit.
let shopCounter = 0;
const freshShop = () => `shop_${++shopCounter}`;

beforeEach(() => {
  vi.clearAllMocks();
  p.shopBilling.updateMany.mockResolvedValue({ count: 1 });
  p.shop.findUnique.mockResolvedValue({ shopDomain: "store.myshopify.com" });
  send.mockResolvedValue({ sent: true, transport: "gmail" });
});

describe("checkCreditAlerts", () => {
  it("does nothing for a shop with no plan record (only Account's first open starts a trial)", async () => {
    load.mockResolvedValue(null);
    await checkCreditAlerts(freshShop(), NOW);
    expect(p.shopBilling.updateMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing under 80%", async () => {
    load.mockResolvedValue(state(100));
    await checkCreditAlerts(freshShop(), NOW);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the 80% alert to every saved address and marks the cycle", async () => {
    load.mockResolvedValue(state(350));
    await checkCreditAlerts(freshShop(), NOW);
    expect(p.shopBilling.updateMany).toHaveBeenCalledTimes(1);
    expect(p.shopBilling.updateMany.mock.calls[0]?.[0]).toEqual({
      where: {
        id: "b1",
        cycleStart: CYCLE_START,
        OR: [{ alertNearSentFor: null }, { alertNearSentFor: { not: CYCLE_START } }],
      },
      data: { alertNearSentFor: CYCLE_START },
    });
    expect(send.mock.calls.map((call) => call[0].to)).toEqual(["a@store.com", "b@store.com"]);
    expect(send.mock.calls[0]?.[0].subject).toBe("88% of this cycle’s credits are used");
    expect(send.mock.calls[0]?.[0].text).toContain("each extra credit is $0.15");
  });

  it("sends the run-out alert when credits reach 0", async () => {
    load.mockResolvedValue(state(400, { alertNearSentFor: CYCLE_START }));
    await checkCreditAlerts(freshShop(), NOW);
    expect(p.shopBilling.updateMany.mock.calls[0]?.[0].data).toEqual({ alertOutSentFor: CYCLE_START });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].subject).toBe("This cycle’s credits are used up");
  });

  it("sends nothing when the alert already went out in this cycle", async () => {
    load.mockResolvedValue(state(350, { alertNearSentFor: CYCLE_START }));
    await checkCreditAlerts(freshShop(), NOW);
    expect(p.shopBilling.updateMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends again in a new cycle (the marker names an older cycle)", async () => {
    load.mockResolvedValue(state(350, { alertNearSentFor: new Date("2026-09-01T00:00:00Z") }));
    await checkCreditAlerts(freshShop(), NOW);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when another check won the claim", async () => {
    load.mockResolvedValue(state(350));
    p.shopBilling.updateMany.mockResolvedValue({ count: 0 });
    await checkCreditAlerts(freshShop(), NOW);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing, and claims nothing, with no saved address or with the switch off", async () => {
    load.mockResolvedValue(state(350, { billEmails: [] }));
    await checkCreditAlerts(freshShop(), NOW);
    load.mockResolvedValue(state(350, { emailAlertNear: false }));
    await checkCreditAlerts(freshShop(), NOW);
    expect(p.shopBilling.updateMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("gives the claim back when no send went through, so a later check tries again", async () => {
    load.mockResolvedValue(state(350));
    send.mockResolvedValueOnce({ sent: false, transport: "none" }).mockRejectedValueOnce(new Error("network"));
    await checkCreditAlerts(freshShop(), NOW);
    expect(p.shopBilling.updateMany).toHaveBeenCalledTimes(2);
    expect(p.shopBilling.updateMany.mock.calls[1]?.[0]).toEqual({
      where: { id: "b1", cycleStart: CYCLE_START },
      data: { alertNearSentFor: null },
    });
  });

  it("keeps the claim when at least one address got the email", async () => {
    load.mockResolvedValue(state(350));
    send.mockResolvedValueOnce({ sent: true, transport: "gmail" }).mockRejectedValueOnce(new Error("network"));
    await checkCreditAlerts(freshShop(), NOW);
    expect(p.shopBilling.updateMany).toHaveBeenCalledTimes(1);
  });

  it("runs at most once a minute per shop", async () => {
    const shopId = freshShop();
    load.mockResolvedValue(state(100));
    await checkCreditAlerts(shopId, NOW);
    await checkCreditAlerts(shopId, new Date(NOW.getTime() + 59_000));
    expect(load).toHaveBeenCalledTimes(1);
    await checkCreditAlerts(shopId, new Date(NOW.getTime() + 60_000));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("waits 15 minutes before it tries an unsent alert again", async () => {
    const shopId = freshShop();
    load.mockResolvedValue(state(350));
    send.mockResolvedValue({ sent: false, transport: "none" });
    await checkCreditAlerts(shopId, NOW);
    await checkCreditAlerts(shopId, new Date(NOW.getTime() + 14 * 60_000));
    expect(load).toHaveBeenCalledTimes(1);
    await checkCreditAlerts(shopId, new Date(NOW.getTime() + 15 * 60_000));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never rejects — a failure is reported, not thrown at the shopper's request", async () => {
    load.mockRejectedValue(new Error("db down"));
    await expect(checkCreditAlerts(freshShop(), NOW)).resolves.toBeUndefined();
  });
});
