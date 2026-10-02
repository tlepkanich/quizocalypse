import { describe, expect, it } from "vitest";
import { listStoreDiscounts, toStoreDiscount } from "./discountList.server";

const basic = (over: Record<string, unknown> = {}) => ({
  id: "gid://shopify/DiscountCodeNode/1",
  codeDiscount: {
    __typename: "DiscountCodeBasic",
    title: "Welcome",
    summary: "15% off entire order",
    endsAt: null,
    tags: [],
    codes: { nodes: [{ code: "WELCOME15" }] },
    minimumRequirement: null,
    customerGets: { items: { __typename: "AllDiscountItems" }, value: { __typename: "DiscountPercentage", percentage: 0.15 } },
    ...over,
  },
});

describe("toStoreDiscount", () => {
  it("reads a percentage order discount in the quiz's own keys", () => {
    expect(toStoreDiscount(basic())).toEqual({
      id: "gid://shopify/DiscountCodeNode/1",
      code: "WELCOME15",
      title: "Welcome",
      summary: "15% off entire order",
      facts: { kind: "percentage", value: 15, applies_to: "all" },
    });
  });

  it("reads a fixed amount on picked items, with its minimum and end", () => {
    const d = toStoreDiscount(
      basic({
        endsAt: "2026-12-01T00:00:00Z",
        minimumRequirement: { greaterThanOrEqualToSubtotal: { amount: "50.0" } },
        customerGets: {
          items: { __typename: "DiscountCollections" },
          value: { __typename: "DiscountAmount", amount: { amount: "10.0" } },
        },
      }),
    );
    expect(d?.facts).toEqual({
      kind: "amount",
      value: 10,
      applies_to: "collections",
      minimum_subtotal: 50,
      ends_at: "2026-12-01T00:00:00Z",
    });
  });

  it("reads a quantity minimum", () => {
    const d = toStoreDiscount(basic({ minimumRequirement: { greaterThanOrEqualToQuantity: "2" } }));
    expect(d?.facts.minimum_quantity).toBe(2);
  });

  it("reads free shipping", () => {
    const d = toStoreDiscount({
      id: "gid://shopify/DiscountCodeNode/2",
      codeDiscount: { __typename: "DiscountCodeFreeShipping", title: "Ship", codes: { nodes: [{ code: "SHIPFREE" }] } },
    });
    expect(d?.facts).toEqual({ kind: "free_shipping", value: 0, applies_to: "all" });
  });

  it("never offers the app's own per-shopper pools", () => {
    expect(toStoreDiscount(basic({ tags: ["wiskr-quiz", "wiskr-quiz-abc"] }))).toBeNull();
  });

  it("skips kinds the quiz cannot describe, and discounts with no code", () => {
    expect(toStoreDiscount({ id: "x", codeDiscount: { __typename: "DiscountCodeBxgy", codes: { nodes: [{ code: "B" }] } } })).toBeNull();
    expect(toStoreDiscount(basic({ codes: { nodes: [] } }))).toBeNull();
    expect(toStoreDiscount({ id: "x", codeDiscount: null })).toBeNull();
  });
});

describe("listStoreDiscounts", () => {
  it("returns only the pickable discounts", async () => {
    const admin = {
      graphql: async () =>
        new Response(
          JSON.stringify({ data: { codeDiscountNodes: { nodes: [basic(), basic({ tags: ["wiskr-quiz"] })] } } }),
        ),
    };
    expect((await listStoreDiscounts(admin)).map((d) => d.code)).toEqual(["WELCOME15"]);
  });

  it("throws on an Admin API error", async () => {
    const admin = { graphql: async () => new Response(JSON.stringify({ errors: [{ message: "nope" }] })) };
    await expect(listStoreDiscounts(admin)).rejects.toThrow(/Admin API error/);
  });
});
