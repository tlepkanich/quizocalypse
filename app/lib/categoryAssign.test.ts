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

  it("falls back to the first category when even title tokens don't match", () => {
    const buckets = assignProducts(
      [
        { key: "a", tags: ["alpha"] },
        { key: "b", tags: ["beta"] },
      ],
      [{ productId: "p1", tags: ["gamma"], title: "Mystery Object" }],
    );
    expect(buckets.get("a")).toEqual(["p1"]);
    expect(buckets.get("b")).toEqual([]);
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
