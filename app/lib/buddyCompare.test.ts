import { describe, expect, it } from "vitest";
import { compareBuddies } from "./buddyCompare";
import type { RecommendedProduct } from "./recommendationEngine";

const rec = (id: string): RecommendedProduct => ({
  product_id: id,
  title: id,
  handle: id,
  price: null,
  image_url: null,
  tags: [],
  collection_ids: [],
  inventory_in_stock: true,
  score: 1,
});

describe("compareBuddies", () => {
  it("finds shared top products and Jaccard agreement", () => {
    const out = compareBuddies({
      recsA: ["p1", "p2", "p3"].map(rec),
      recsB: ["p2", "p4"].map(rec),
      outcomeA: "r1",
      outcomeB: "r2",
    });
    expect(out.shared.map((r) => r.product_id)).toEqual(["p2"]);
    // union {p1,p2,p3,p4} = 4, shared 1 → 25%
    expect(out.agreementPct).toBe(25);
    expect(out.sameOutcome).toBe(false);
  });

  it("identical top-5 = 100%, same outcome flagged; caps at TOP_N", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"].map(rec);
    const out = compareBuddies({ recsA: seven, recsB: seven, outcomeA: "r1", outcomeB: "r1" });
    expect(out.agreementPct).toBe(100);
    expect(out.sameOutcome).toBe(true);
    expect(out.shared).toHaveLength(5); // top-5 cap, not 7
  });

  it("handles empty rec lists without dividing by zero", () => {
    const out = compareBuddies({ recsA: [], recsB: [], outcomeA: null, outcomeB: null });
    expect(out.agreementPct).toBe(0);
    expect(out.sameOutcome).toBe(false);
  });
});
