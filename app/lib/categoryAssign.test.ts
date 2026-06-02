import { describe, expect, it } from "vitest";
import { assignProducts } from "./categoryAssign";

describe("assignProducts", () => {
  it("buckets a product into its highest-overlap category", () => {
    const buckets = assignProducts(
      [
        { key: "cozy", tags: ["cozy", "warm", "soft"] },
        { key: "adventure", tags: ["rugged", "outdoor", "durable"] },
      ],
      [
        {
          productId: "p1",
          tags: ["cozy", "soft", "fleece"],
          title: "Fleece Throw",
        },
      ],
    );
    expect(buckets.get("cozy")).toEqual(["p1"]);
    expect(buckets.get("adventure")).toEqual([]);
  });

  it("assigns a product to its top two categories when it overlaps multiple", () => {
    const buckets = assignProducts(
      [
        { key: "cozy", tags: ["cozy", "soft"] },
        { key: "lounge", tags: ["soft", "lounge"] },
        { key: "outdoor", tags: ["rugged"] },
      ],
      [
        {
          productId: "p1",
          tags: ["cozy", "soft", "lounge"],
          title: "Lounge Robe",
        },
      ],
    );
    // p1 overlaps cozy (2 matches: cozy, soft) and lounge (2 matches: soft, lounge)
    // top 2 by score → both should contain p1, outdoor stays empty
    expect(buckets.get("cozy")).toContain("p1");
    expect(buckets.get("lounge")).toContain("p1");
    expect(buckets.get("outdoor")).toEqual([]);
  });

  it("falls back to title-token matching when no tags overlap", () => {
    const buckets = assignProducts(
      [
        { key: "running", tags: ["running", "runner", "shoe"] },
        { key: "yoga", tags: ["yoga", "stretch", "mat"] },
      ],
      [
        {
          productId: "p1",
          tags: ["polyester", "size-9"], // no overlap with either category's tags
          title: "Trail Running Shoe",
        },
      ],
    );
    // "running" appears in both the category tags and the product title
    expect(buckets.get("running")).toEqual(["p1"]);
    expect(buckets.get("yoga")).toEqual([]);
  });

  it("matches product type / title against the bucket NAME when tags are empty", () => {
    // The live bug: AI buckets have names but tags:[]. Assignment must still
    // route by product_type/title vs the bucket name (prefix-tolerant, so
    // 'snowboard' → 'Snowboards', 'serum' → 'Serums').
    const buckets = assignProducts(
      [
        { key: "boards", name: "Snowboards", tags: [] },
        { key: "skin", name: "Serums", tags: [] },
      ],
      [
        { productId: "b1", tags: [], title: "The Minimal Snowboard", productType: "snowboard" },
        { productId: "s1", tags: [], title: "Vitamin C Serum", productType: "Serum" },
      ],
    );
    expect(buckets.get("boards")).toEqual(["b1"]);
    expect(buckets.get("skin")).toEqual(["s1"]);
  });

  it("balances pure-noise products across buckets (no catch-all dump)", () => {
    // 30 products with zero tag/name/title signal must NOT all land in bucket[0]
    // (the old behavior, which produced the 97-in-one-bucket snowboard bug).
    const categories = [
      { key: "a", name: "Alpha", tags: ["alpha"] },
      { key: "b", name: "Beta", tags: ["beta"] },
      { key: "c", name: "Gamma", tags: ["gamma"] },
    ];
    const products = Array.from({ length: 30 }, (_, i) => ({
      productId: `n${i}`,
      tags: ["zzz"], // matches nothing
      title: "Mystery Object",
    }));
    const buckets = assignProducts(categories, products);
    const sizes = [...buckets.values()].map((b) => b.length);
    // round-robin least-full → perfectly balanced (10/10/10), certainly no catch-all
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(Math.max(...sizes)).toBeLessThan(products.length); // not all in one
  });

  it("normalizes tags case-insensitively", () => {
    const buckets = assignProducts(
      [{ key: "warm", tags: ["WARM", "Soft"] }],
      [{ productId: "p1", tags: ["warm", "soft"], title: "x" }],
    );
    expect(buckets.get("warm")).toEqual(["p1"]);
  });

  it("returns empty buckets when no categories are provided", () => {
    const buckets = assignProducts(
      [],
      [{ productId: "p1", tags: ["x"], title: "y" }],
    );
    expect(buckets.size).toBe(0);
  });

  it("orphans nothing — every input product lands in at least one bucket", () => {
    const categories = [
      { key: "a", tags: ["alpha"] },
      { key: "b", tags: ["beta"] },
      { key: "c", tags: ["gamma"] },
    ];
    const products = Array.from({ length: 30 }, (_, i) => ({
      productId: `p${i}`,
      tags: i % 3 === 0 ? ["alpha"] : i % 3 === 1 ? ["beta"] : ["gamma"],
      title: `Product ${i}`,
    }));
    const buckets = assignProducts(categories, products);
    const assignedIds = new Set<string>();
    for (const bucket of buckets.values()) {
      for (const id of bucket) assignedIds.add(id);
    }
    expect(assignedIds.size).toBe(products.length);
  });
});
