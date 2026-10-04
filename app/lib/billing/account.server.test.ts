import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../../db.server";
import { sendEmail } from "../email.server";
import { billEmailLinks, loadCycleFiguresIfStarted, runAccountIntentForShop } from "./account.server";

vi.mock("../../db.server", () => ({
  default: {
    shopBill: { findFirst: vi.fn() },
    shopBilling: { findUnique: vi.fn() },
    shop: { findUnique: vi.fn() },
    quiz: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    creditUse: { groupBy: vi.fn() },
    creditGrant: { groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../email.server", () => ({ sendEmail: vi.fn() }));
vi.mock("../log.server", () => ({ reportError: vi.fn() }));

const p = prisma as unknown as {
  shopBill: { findFirst: Mock };
  shopBilling: { findUnique: Mock };
  shop: { findUnique: Mock };
  quiz: { findMany: Mock };
  event: { findMany: Mock };
  creditUse: { groupBy: Mock };
  creditGrant: { groupBy: Mock };
  $transaction: Mock;
};
const send = sendEmail as unknown as Mock;

const SHOP = { id: "s1", shopDomain: "store.myshopify.com", source: "shopify" };
const BILL = {
  id: "bill1",
  shopId: "s1",
  billDate: new Date("2026-10-19T00:00:00Z"),
  plan: "growth",
  creditsAvailable: 2380,
  creditsUsed: 2511,
  creditsOver: 131,
  lines: [
    { label: "Growth", cents: 20000 },
    { label: "131 extra credits", cents: 1310 },
  ],
  totalCents: 21310,
};

function receiptIntent(billId = "bill1"): FormData {
  const form = new FormData();
  form.set("intent", "email-receipt");
  form.set("billId", billId);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  p.shopBill.findFirst.mockResolvedValue(BILL);
  p.shopBilling.findUnique.mockResolvedValue({ billEmails: ["a@store.com", "b@store.com"] });
  send.mockResolvedValue({ sent: true, transport: "gmail" });
});

describe("the email-receipt intent (Past bills → Email receipt)", () => {
  it("sends that bill's receipt to every saved address", async () => {
    const result = await runAccountIntentForShop(SHOP, receiptIntent());
    expect(result).toEqual({ ok: true, message: "Receipt for Oct 19, 2026 sent to 2 addresses." });
    expect(p.shopBill.findFirst).toHaveBeenCalledWith({ where: { id: "bill1", shopId: "s1" } });
    expect(send.mock.calls.map((call) => call[0].to)).toEqual(["a@store.com", "b@store.com"]);
    expect(send.mock.calls[0]?.[0].subject).toBe("Your Wiskr receipt for Oct 19, 2026");
    expect(send.mock.calls[0]?.[0].text).toContain("131 extra credits: $13.10");
    expect(send.mock.calls[0]?.[0].text).toContain("https://admin.shopify.com/store/store/settings/billing");
  });

  it("names the address when the receipt reached one", async () => {
    send.mockResolvedValueOnce({ sent: true, transport: "gmail" }).mockResolvedValueOnce({ sent: false, transport: "gmail" });
    const result = await runAccountIntentForShop(SHOP, receiptIntent());
    expect(result).toEqual({ ok: true, message: "Receipt for Oct 19, 2026 sent to a@store.com." });
  });

  it("with no address saved, says to save one first and sends nothing", async () => {
    p.shopBilling.findUnique.mockResolvedValue({ billEmails: [] });
    const result = await runAccountIntentForShop(SHOP, receiptIntent());
    expect(result).toEqual({ ok: false, status: 422, message: "Save an email under Bill emails first." });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a bill that is not this shop's", async () => {
    p.shopBill.findFirst.mockResolvedValue(null);
    const result = await runAccountIntentForShop(SHOP, receiptIntent("someone-elses"));
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(send).not.toHaveBeenCalled();
  });

  it("says so when no send went through", async () => {
    send.mockResolvedValueOnce({ sent: false, transport: "none" }).mockRejectedValueOnce(new Error("network"));
    const result = await runAccountIntentForShop(SHOP, receiptIntent());
    expect(result).toEqual({ ok: false, status: 502, message: "The receipt wasn't sent. Try again." });
  });
});

describe("closing a cycle writes its bill", () => {
  const OLD_START = new Date("2026-09-01T00:00:00Z");
  const OLD_END = new Date("2026-10-01T00:00:00Z");
  const NOW = new Date("2026-10-05T12:00:00Z");

  /** A Growth shop whose cycle ended four days ago, with 180 added credits. */
  function endedCycle(overrides: Record<string, unknown> = {}) {
    return {
      id: "b1",
      shopId: "s1",
      plan: "growth",
      status: "active",
      cycleStart: OLD_START,
      cycleEnd: OLD_END,
      everyCycleCredits: 180,
      pendingPlan: null,
      cancelAt: null,
      shopifySubscriptionId: "gid://shopify/AppSubscription/1",
      billEmails: ["a@store.com"],
      emailReceipt: true,
      ...overrides,
    };
  }

  /** The transaction's client. `closed` is how many rows the cycleEnd guard matched. */
  function transaction(stored: ReturnType<typeof endedCycle>, closed = 1) {
    const tx = {
      shopBilling: {
        updateMany: vi.fn().mockResolvedValue({ count: closed }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...stored,
          cycleStart: OLD_END,
          cycleEnd: new Date("2026-10-31T00:00:00Z"),
        }),
      },
      creditGrant: { create: vi.fn() },
      shopBill: { create: vi.fn().mockResolvedValue({ id: "bill-new" }) },
    };
    p.$transaction.mockImplementation(async (run: (client: typeof tx) => unknown) => run(tx));
    return tx;
  }

  /** `engaged` shoppers in the closed cycle: 2,380 are available (2,200 + 180). */
  function usage(engaged: number) {
    p.quiz.findMany.mockResolvedValue([{ id: "q1", name: "Quiz" }]);
    p.event.findMany.mockResolvedValue(
      Array.from({ length: engaged }, (_, i) => ({ quizId: "q1", sessionId: `s${i}` })),
    );
    p.creditUse.groupBy.mockResolvedValue([]);
    p.creditGrant.groupBy.mockResolvedValue([]);
  }

  /** Let the fire-and-forget receipt run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    p.shop.findUnique.mockResolvedValue(SHOP);
    p.shopBill.findFirst.mockResolvedValue({ ...BILL, id: "bill-new" });
  });

  it("stores the bill for a shop with a Shopify subscription, and sends its receipt", async () => {
    const stored = endedCycle();
    p.shopBilling.findUnique.mockResolvedValue(stored);
    usage(2511);
    const tx = transaction(stored);

    await loadCycleFiguresIfStarted("s1", NOW);
    await settle();

    expect(tx.shopBill.create).toHaveBeenCalledTimes(1);
    expect(tx.shopBill.create).toHaveBeenCalledWith({
      data: {
        shopId: "s1",
        billDate: OLD_END,
        plan: "growth",
        creditsAvailable: 2380,
        creditsUsed: 2511,
        creditsOver: 131,
        lines: [
          { label: "Growth", cents: 20000 },
          { label: "180 added credits", cents: 1800 },
          { label: "131 extra credits", cents: 1310 },
        ],
        totalCents: 23110,
      },
    });
    expect(p.shopBill.findFirst).toHaveBeenCalledWith({ where: { id: "bill-new", shopId: "s1" } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stores no bill and sends nothing while Shopify billing is not connected", async () => {
    const stored = endedCycle({ shopifySubscriptionId: null });
    p.shopBilling.findUnique.mockResolvedValue(stored);
    usage(2511);
    const tx = transaction(stored);

    await loadCycleFiguresIfStarted("s1", NOW);
    await settle();

    expect(tx.shopBilling.updateMany).toHaveBeenCalledTimes(1); // the cycle still closes
    expect(tx.shopBill.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("stores the bill but sends no receipt when the receipt switch is off", async () => {
    const stored = endedCycle({ emailReceipt: false });
    p.shopBilling.findUnique.mockResolvedValue(stored);
    usage(100);
    const tx = transaction(stored);

    await loadCycleFiguresIfStarted("s1", NOW);
    await settle();

    expect(tx.shopBill.create).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("stores nothing when another load already closed the cycle", async () => {
    const stored = endedCycle();
    p.shopBilling.findUnique.mockResolvedValue(stored);
    usage(100);
    const tx = transaction(stored, 0);

    await loadCycleFiguresIfStarted("s1", NOW);
    await settle();

    expect(tx.shopBill.create).not.toHaveBeenCalled();
    expect(tx.creditGrant.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("billEmailLinks", () => {
  const saved = process.env.SHOPIFY_APP_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.SHOPIFY_APP_URL;
    else process.env.SHOPIFY_APP_URL = saved;
  });

  it("builds the links from the app's configured URL", () => {
    process.env.SHOPIFY_APP_URL = "https://app.example/";
    expect(billEmailLinks()).toEqual({
      account: "https://app.example/studio/account",
      changePlan: "https://app.example/studio/account/plan",
    });
  });

  it("gives no links when the URL is missing or not http(s)", () => {
    delete process.env.SHOPIFY_APP_URL;
    expect(billEmailLinks()).toEqual({ account: null, changePlan: null });
    process.env.SHOPIFY_APP_URL = "ftp://app.example";
    expect(billEmailLinks()).toEqual({ account: null, changePlan: null });
  });
});
