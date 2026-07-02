import { describe, expect, it } from "vitest";
import { draftDeciderBake } from "./draftDeciderBake";

const cat = (
  id: string,
  source: string | null,
  productIds: string[],
  name = `Bucket ${id}`,
) => ({ id, name, source, productIds });

describe("draftDeciderBake — draft-time decider bake for previews", () => {
  it("maps every bucket to its ORDERED member ids + a shaped index entry", () => {
    const out = draftDeciderBake([
      cat("c1", "collection", ["p2", "p1", "p3"]),
      cat("c2", "tag", ["p9"]),
    ]);
    expect(out.targetProductIdsMap).toEqual({
      c1: ["p2", "p1", "p3"], // bucket order preserved — it IS collection_order pre-publish
      c2: ["p9"],
    });
    expect(out.targetIndex.c1).toEqual({ type: "collection", name: "Bucket c1" });
    expect(out.targetIndex.c2).toEqual({ type: "tag", name: "Bucket c2" });
  });

  it("individual-product buckets keep the hero-only shape (§4.1)", () => {
    const out = draftDeciderBake([cat("cp", "product", ["p1"])]);
    expect(out.targetIndex.cp?.type).toBe("product");
  });

  it("unknown / null sources map to the general collection shape", () => {
    const out = draftDeciderBake([
      cat("cm", "manual", ["p1"]),
      cat("cs", "smart_collection", ["p2"]),
      cat("cn", null, ["p3"]),
    ]);
    expect(out.targetIndex.cm?.type).toBe("collection");
    expect(out.targetIndex.cs?.type).toBe("collection");
    expect(out.targetIndex.cn?.type).toBe("collection");
  });

  it("empty categories → empty maps (the no-buckets draft)", () => {
    expect(draftDeciderBake([])).toEqual({ targetProductIdsMap: {}, targetIndex: {} });
  });
});
