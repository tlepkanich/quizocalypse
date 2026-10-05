import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { loadAccountForShop, runAccountIntentForShop } from "./billing/account.server";
import { action as accountAction, loader as accountLoader } from "../routes/app.account";
import { loader as planLoader } from "../routes/app.account_.plan";

// The embedded /app Account and Change plan routes: thin wrappers over the
// shared account.server seam. What matters here is WHICH shop they act on —
// always the one in the Shopify session — and that an unauthenticated request
// never reaches the data. Lives in app/lib (not app/routes) per the
// Remix-route-test rule.
vi.mock("../db.server", () => ({ default: { shop: { findUnique: vi.fn() } } }));
vi.mock("../shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("./billing/account.server", () => ({
  loadAccountForShop: vi.fn(),
  runAccountIntentForShop: vi.fn(),
}));

const p = prisma as unknown as { shop: { findUnique: Mock } };
const admin = authenticate.admin as unknown as Mock;
const load = loadAccountForShop as unknown as Mock;
const run = runAccountIntentForShop as unknown as Mock;

const SHOP = { id: "s1", shopDomain: "store.myshopify.com", source: "shopify" };
const ACCOUNT = { shopDomain: "store.myshopify.com", planKey: "starter" };

function get(path: string): LoaderFunctionArgs {
  return { request: new Request(`https://app.example${path}`), params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

function post(fields: Record<string, string>): ActionFunctionArgs {
  const body = new URLSearchParams(fields);
  const request = new Request("https://app.example/app/account", { method: "POST", body });
  return { request, params: {}, context: {} } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue({ session: { shop: "store.myshopify.com" } });
  p.shop.findUnique.mockResolvedValue(SHOP);
  load.mockResolvedValue(ACCOUNT);
});

describe.each([
  ["/app/account", accountLoader],
  ["/app/account/plan", planLoader],
])("%s loader", (path, loader) => {
  it("loads the account of the shop in the Shopify session", async () => {
    const res = await loader(get(path));
    expect(p.shop.findUnique).toHaveBeenCalledWith({ where: { shopDomain: "store.myshopify.com" } });
    expect(load).toHaveBeenCalledWith(SHOP);
    expect(await res.json()).toEqual({ account: ACCOUNT });
  });

  it("gives no account, and starts no trial, before the Shop row exists", async () => {
    p.shop.findUnique.mockResolvedValue(null);
    const res = await loader(get(path));
    expect(await res.json()).toEqual({ account: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("reads nothing when Shopify auth refuses the request", async () => {
    admin.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(loader(get(path))).rejects.toBeInstanceOf(Response);
    expect(p.shop.findUnique).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});

describe("/app/account action", () => {
  it("runs the intent for the session's shop and passes its result through", async () => {
    run.mockResolvedValue({ ok: true, message: "Turned on." });
    const res = await accountAction(post({ intent: "set-switch", key: "near", on: "true" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Turned on." });
    expect(run.mock.calls[0]?.[0]).toBe(SHOP);
    expect((run.mock.calls[0]?.[1] as FormData).get("intent")).toBe("set-switch");
  });

  it("answers a refusal with its own status", async () => {
    run.mockResolvedValue({ ok: false, status: 422, message: "Save an email under Bill emails first." });
    const res = await accountAction(post({ intent: "email-receipt", billId: "b1" }));
    expect(res.status).toBe(422);
  });

  it("404s, and writes nothing, before the Shop row exists", async () => {
    p.shop.findUnique.mockResolvedValue(null);
    const res = await accountAction(post({ intent: "add-email", email: "a@store.com" }));
    expect(res.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("writes nothing when Shopify auth refuses the request", async () => {
    admin.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(accountAction(post({ intent: "add-email", email: "a@store.com" }))).rejects.toBeInstanceOf(Response);
    expect(run).not.toHaveBeenCalled();
  });
});
