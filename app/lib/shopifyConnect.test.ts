import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from "vitest";
import {
  normalizeShopDomain,
  adminClientFromToken,
  runConnectedSync,
} from "./shopifyConnect.server";
import prisma from "../db.server";
import { GENERIC_SYNC_ERROR, syncCatalogForShopId } from "../jobs/catalogSync";
import { reportError } from "./log.server";

vi.mock("../db.server", () => ({
  default: {
    shop: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../jobs/catalogSync", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  syncCatalogForShopId: vi.fn(),
}));

vi.mock("./crypto", () => ({
  encrypt: vi.fn((v: string) => v),
  decrypt: vi.fn(() => "shpat_decrypted"),
}));

vi.mock("./log.server", () => ({
  logFor: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  reportError: vi.fn(),
}));

describe("normalizeShopDomain", () => {
  it("appends .myshopify.com to a bare handle", () => {
    expect(normalizeShopDomain("acme")).toBe("acme.myshopify.com");
    expect(normalizeShopDomain("  Acme-Store  ")).toBe("acme-store.myshopify.com");
  });

  it("accepts a full host", () => {
    expect(normalizeShopDomain("acme.myshopify.com")).toBe("acme.myshopify.com");
  });

  it("strips scheme + path", () => {
    expect(normalizeShopDomain("https://acme.myshopify.com/admin")).toBe("acme.myshopify.com");
    expect(normalizeShopDomain("http://Acme.myshopify.com/")).toBe("acme.myshopify.com");
  });

  it("rejects non-myshopify hosts and junk", () => {
    expect(normalizeShopDomain("acme.com")).toBeNull();
    expect(normalizeShopDomain("evil.example.org")).toBeNull();
    expect(normalizeShopDomain("")).toBeNull();
    expect(normalizeShopDomain("   ")).toBeNull();
  });
});

describe("adminClientFromToken", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to the 2025-01 Admin GraphQL endpoint with the token header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { shop: { name: "Acme" } } })));

    const admin = adminClientFromToken("acme.myshopify.com", "shpat_secret");
    await admin.graphql("{ shop { name } }", { variables: { x: 1 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://acme.myshopify.com/admin/api/2025-01/graphql.json");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Shopify-Access-Token"]).toBe("shpat_secret");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "{ shop { name } }",
      variables: { x: 1 },
    });
  });
});

// The funnel's "Refresh catalog" awaits this and renders the returned error
// verbatim in the underrow — it must be curated copy, never a raw upstream
// message (BIC-2 A2(f) mirror of the catalogSync scrub).
describe("runConnectedSync", () => {
  const p = prisma as unknown as { shop: { findUnique: Mock; update: Mock } };
  const syncMock = syncCatalogForShopId as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    p.shop.update.mockResolvedValue({});
  });

  it("returns curated copy when no store is connected, and persists the status", async () => {
    p.shop.findUnique.mockResolvedValue({ shopifyConnectDomain: null, shopifyConnectToken: null });

    const res = await runConnectedSync("shop-1");

    expect(res).toEqual({ ok: false, error: "Not connected to Shopify." });
    expect(p.shop.update).toHaveBeenCalledWith({
      where: { id: "shop-1" },
      data: { lastSyncStatus: "error", lastSyncError: "Not connected to Shopify." },
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("syncs with the token-shim admin and returns ok", async () => {
    p.shop.findUnique.mockResolvedValue({
      shopifyConnectDomain: "acme.myshopify.com",
      shopifyConnectToken: "enc-token",
    });
    syncMock.mockResolvedValue({ productCount: 3 });

    const res = await runConnectedSync("shop-1");

    expect(res).toEqual({ ok: true });
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), "shop-1", {
      storefrontDomain: "acme.myshopify.com",
    });
  });

  it("returns AND persists the GENERIC copy on a sync failure — never the raw message", async () => {
    const raw = new Error("GraphqlQueryError: Throttled (token hint: shpat_…)");
    p.shop.findUnique.mockResolvedValue({
      shopifyConnectDomain: "acme.myshopify.com",
      shopifyConnectToken: "enc-token",
    });
    syncMock.mockRejectedValue(raw);

    const res = await runConnectedSync("shop-1");

    expect(res).toEqual({ ok: false, error: GENERIC_SYNC_ERROR });
    expect(res.error).not.toContain("Throttled");
    // A2(f) — lastSyncError reaches app._index and studio.products verbatim:
    // the persisted string must be the curated copy, the raw error must be
    // routed to the log seam in full.
    expect(p.shop.update).toHaveBeenCalledWith({
      where: { id: "shop-1" },
      data: expect.objectContaining({
        lastSyncStatus: "error",
        lastSyncError: GENERIC_SYNC_ERROR,
      }),
    });
    expect(reportError).toHaveBeenCalledWith(
      raw,
      expect.objectContaining({ scope: "shopifyConnect", shopId: "shop-1" }),
    );
  });
});
