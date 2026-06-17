import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeShopDomain, adminClientFromToken } from "./shopifyConnect.server";

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
