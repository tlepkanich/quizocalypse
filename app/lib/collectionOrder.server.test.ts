import { describe, expect, it } from "vitest";
import { fetchCollectionOrder, fetchCollectionOrders } from "./collectionOrder.server";

// A mock Admin GraphQL client returning canned collection pages.
function mockAdmin(pages: Array<{ ids: string[]; hasNext: boolean; cursor?: string }>) {
  let call = 0;
  const seenVars: Array<Record<string, unknown>> = [];
  return {
    admin: {
      graphql: async (_q: string, options?: { variables?: Record<string, unknown> }) => {
        seenVars.push(options?.variables ?? {});
        const page = pages[Math.min(call, pages.length - 1)]!;
        call++;
        return {
          json: async () => ({
            data: {
              collection: {
                products: {
                  nodes: page.ids.map((id) => ({ id })),
                  pageInfo: { hasNextPage: page.hasNext, endCursor: page.cursor ?? null },
                },
              },
            },
          }),
        };
      },
    },
    seenVars,
  };
}

describe("fetchCollectionOrder — the merchant's Shopify sort, paged", () => {
  it("walks pages in order and concatenates ids", async () => {
    const { admin, seenVars } = mockAdmin([
      { ids: ["p1", "p2"], hasNext: true, cursor: "c1" },
      { ids: ["p3"], hasNext: false },
    ]);
    const ids = await fetchCollectionOrder(admin, "gid://shopify/Collection/1");
    expect(ids).toEqual(["p1", "p2", "p3"]);
    expect(seenVars[0]?.after).toBeNull();
    expect(seenVars[1]?.after).toBe("c1");
  });

  it("a missing collection yields an empty list (partial-degrade, no throw)", async () => {
    const admin = {
      graphql: async () => ({ json: async () => ({ data: { collection: null } }) }),
    };
    expect(await fetchCollectionOrder(admin, "gone")).toEqual([]);
  });

  it("fetchCollectionOrders keys results by targetId", async () => {
    const { admin } = mockAdmin([{ ids: ["x"], hasNext: false }]);
    const out = await fetchCollectionOrders(admin, [
      { targetId: "cat_a", collectionRef: "gid://shopify/Collection/9" },
    ]);
    expect(out).toEqual({ cat_a: ["x"] });
  });
});
