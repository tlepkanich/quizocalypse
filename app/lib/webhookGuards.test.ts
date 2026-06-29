import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { action as productsAction } from "../routes/webhooks.products";
import { action as collectionsAction } from "../routes/webhooks.collections";
import { action as scopesAction } from "../routes/webhooks.app.scopes_update";

// HII-2 — the Shopify webhook processors guard their Prisma write so a failed
// upsert/delete/update returns 500 (Shopify REDELIVERS the idempotent op) instead
// of acking an empty 200 with stale state. authenticate.webhook validates HMAC
// FIRST and throws on failure, so we never 500 an unauthenticated request — these
// tests mock it as already-authenticated and exercise only the write guard.
// Lives in app/lib (not app/routes) so Remix's Vite plugin doesn't treat the
// *.test.ts as a route (HII-1 build lesson). vi.mock is hoisted above the imports.
vi.mock("../shopify.server", () => ({ authenticate: { webhook: vi.fn() } }));
vi.mock("../db.server", () => ({
  default: {
    shop: { findUnique: vi.fn() },
    product: { upsert: vi.fn(), deleteMany: vi.fn() },
    collection: { upsert: vi.fn() },
    session: { update: vi.fn() },
  },
}));

const webhook = (authenticate as unknown as { webhook: Mock }).webhook;
const p = prisma as unknown as {
  shop: { findUnique: Mock };
  product: { upsert: Mock; deleteMany: Mock };
  collection: { upsert: Mock };
  session: { update: Mock };
};

function args(): ActionFunctionArgs {
  return {
    request: new Request("https://app.example/webhook", { method: "POST" }),
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  p.shop.findUnique.mockResolvedValue({ id: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("webhooks.products write guard", () => {
  beforeEach(() => {
    webhook.mockResolvedValue({
      topic: "PRODUCTS_UPDATE",
      shop: "x.myshopify.com",
      payload: { id: 1, title: "Board", handle: "board", variants: [] },
    });
  });

  it("200 on a successful upsert (success path unchanged → Shopify acks)", async () => {
    p.product.upsert.mockResolvedValue({});
    expect((await productsAction(args())).status).toBe(200);
  });

  it("500 when the upsert throws → Shopify redelivers", async () => {
    p.product.upsert.mockRejectedValue(new Error("db down"));
    expect((await productsAction(args())).status).toBe(500);
  });

  it("guards the delete branch too: 500 when deleteMany throws, 200 on success", async () => {
    webhook.mockResolvedValue({ topic: "PRODUCTS_DELETE", shop: "x.myshopify.com", payload: { id: 1 } });
    p.product.deleteMany.mockRejectedValue(new Error("db down"));
    expect((await productsAction(args())).status).toBe(500);
    p.product.deleteMany.mockResolvedValue({ count: 1 });
    expect((await productsAction(args())).status).toBe(200);
  });

  it("unknown shop → 200 (don't redeliver for a shop we don't have)", async () => {
    p.shop.findUnique.mockResolvedValue(null);
    expect((await productsAction(args())).status).toBe(200);
    expect(p.product.upsert).not.toHaveBeenCalled();
  });
});

describe("webhooks.collections write guard", () => {
  beforeEach(() => {
    webhook.mockResolvedValue({
      topic: "COLLECTIONS_UPDATE",
      shop: "x.myshopify.com",
      payload: { id: 9, title: "Snow", handle: "snow" },
    });
  });

  it("200 on a successful upsert", async () => {
    p.collection.upsert.mockResolvedValue({});
    expect((await collectionsAction(args())).status).toBe(200);
  });

  it("500 when the upsert throws → Shopify redelivers", async () => {
    p.collection.upsert.mockRejectedValue(new Error("db down"));
    expect((await collectionsAction(args())).status).toBe(500);
  });
});

describe("webhooks.app.scopes_update write guard", () => {
  it("200 on a successful scope update", async () => {
    webhook.mockResolvedValue({
      topic: "APP_SCOPES_UPDATE",
      shop: "x.myshopify.com",
      payload: { current: ["read_products"] },
      session: { id: "sess1" },
    });
    p.session.update.mockResolvedValue({});
    expect((await scopesAction(args())).status).toBe(200);
  });

  it("500 when the scope update throws → Shopify redelivers", async () => {
    webhook.mockResolvedValue({
      topic: "APP_SCOPES_UPDATE",
      shop: "x.myshopify.com",
      payload: { current: ["read_products"] },
      session: { id: "sess1" },
    });
    p.session.update.mockRejectedValue(new Error("db down"));
    expect((await scopesAction(args())).status).toBe(500);
  });

  it("no session → 200 (no write attempted)", async () => {
    webhook.mockResolvedValue({
      topic: "APP_SCOPES_UPDATE",
      shop: "x.myshopify.com",
      payload: { current: [] },
      session: null,
    });
    expect((await scopesAction(args())).status).toBe(200);
    expect(p.session.update).not.toHaveBeenCalled();
  });
});
