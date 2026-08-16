import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { authenticate } from "../shopify.server";
import { redactCustomer, redactOrders } from "./gdpr.server";
import { action as redactAction } from "../routes/webhooks.customers.redact";

// The customers/redact ROUTE. gdpr.server.test.ts pins what each eraser does;
// what's pinned here is the routing — that BOTH halves of the payload are
// honoured, and specifically that they are independent.
//
// The gap this locks shut: `orders_to_redact` was never read, and the handler
// returned early when the customer had no email — so for an email-less
// customer nothing at all was erased, silently, while still acking 200.
//
// Lives in app/lib (not app/routes) so Remix's Vite plugin doesn't treat the
// *.test.ts as a route (HII-1 build lesson).
vi.mock("../shopify.server", () => ({ authenticate: { webhook: vi.fn() } }));
vi.mock("../db.server", () => ({ default: {} }));
vi.mock("./gdpr.server", () => ({
  redactCustomer: vi.fn().mockResolvedValue({ captures: 2, backInStock: 1, rewards: 0, referrals: 0 }),
  redactOrders: vi.fn().mockResolvedValue({ orderEvents: 3, sessionsUnconverted: 1 }),
}));

const webhook = (authenticate as unknown as { webhook: Mock }).webhook;
const rc = redactCustomer as unknown as Mock;
const ro = redactOrders as unknown as Mock;

function args(): ActionFunctionArgs {
  return {
    request: new Request("https://app.example/webhooks/customers/redact", { method: "POST" }),
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs;
}

function payload(p: Record<string, unknown>) {
  webhook.mockResolvedValue({ shop: "s.myshopify.com", topic: "CUSTOMERS_REDACT", payload: p });
}

beforeEach(() => {
  vi.clearAllMocks();
  rc.mockResolvedValue({ captures: 2, backInStock: 1, rewards: 0, referrals: 0 });
  ro.mockResolvedValue({ orderEvents: 3, sessionsUnconverted: 1 });
});

describe("customers/redact route", () => {
  it("honours BOTH halves when the payload carries a customer and orders", async () => {
    payload({ customer: { email: "a@b.com" }, orders_to_redact: [1, 2] });
    const res = await redactAction(args());
    expect(res.status).toBe(200);
    expect(rc).toHaveBeenCalledWith(expect.anything(), "s.myshopify.com", "a@b.com");
    expect(ro).toHaveBeenCalledWith(expect.anything(), "s.myshopify.com", [1, 2]);
  });

  it("REGRESSION: redacts the orders even when the customer has no email", async () => {
    // The old handler bailed on a missing email and erased nothing at all.
    payload({ customer: { email: null }, orders_to_redact: [99] });
    await redactAction(args());
    expect(rc).not.toHaveBeenCalled();
    expect(ro).toHaveBeenCalledWith(expect.anything(), "s.myshopify.com", [99]);
  });

  it("redacts the customer even when no orders are listed", async () => {
    payload({ customer: { email: "a@b.com" } });
    await redactAction(args());
    expect(rc).toHaveBeenCalled();
    // Still called, with an empty list — the eraser itself short-circuits.
    expect(ro).toHaveBeenCalledWith(expect.anything(), "s.myshopify.com", []);
  });

  it("a malformed orders_to_redact is treated as empty, never thrown on", async () => {
    payload({ customer: { email: "a@b.com" }, orders_to_redact: "nope" });
    const res = await redactAction(args());
    expect(res.status).toBe(200);
    expect(ro).toHaveBeenCalledWith(expect.anything(), "s.myshopify.com", []);
  });

  it("an empty payload acks 200 without erasing anything", async () => {
    payload({});
    const res = await redactAction(args());
    expect(res.status).toBe(200);
    expect(rc).not.toHaveBeenCalled();
    expect(ro).toHaveBeenCalledWith(expect.anything(), "s.myshopify.com", []);
  });

  it("trims a padded email rather than missing the match", async () => {
    payload({ customer: { email: "  a@b.com  " } });
    await redactAction(args());
    expect(rc).toHaveBeenCalledWith(expect.anything(), "s.myshopify.com", "a@b.com");
  });
});
