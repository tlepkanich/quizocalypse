import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../../db.server";
import { sendEmail } from "../email.server";
import { billEmailLinks, runAccountIntentForShop } from "./account.server";

vi.mock("../../db.server", () => ({
  default: { shopBill: { findFirst: vi.fn() }, shopBilling: { findUnique: vi.fn() } },
}));
vi.mock("../email.server", () => ({ sendEmail: vi.fn() }));

const p = prisma as unknown as { shopBill: { findFirst: Mock }; shopBilling: { findUnique: Mock } };
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
    expect(result).toEqual({ ok: true, message: "Receipt sent to 2 addresses." });
    expect(p.shopBill.findFirst).toHaveBeenCalledWith({ where: { id: "bill1", shopId: "s1" } });
    expect(send.mock.calls.map((call) => call[0].to)).toEqual(["a@store.com", "b@store.com"]);
    expect(send.mock.calls[0]?.[0].subject).toBe("Your Wiskr receipt for Oct 19, 2026");
    expect(send.mock.calls[0]?.[0].text).toContain("131 extra credits: $13.10");
    expect(send.mock.calls[0]?.[0].text).toContain("https://admin.shopify.com/store/store/settings/billing");
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
