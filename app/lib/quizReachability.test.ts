import { describe, expect, it } from "vitest";
import { computeReachability } from "./quizReachability";

// ANALYTICS P0 — doc-static reachability from the baked target map (rule A2).

const BASE = {
  logic_model: "decider",
  product_index: [
    { product_id: "p1", title: "Serum", collection_ids: ["colA"] },
    { product_id: "p2", title: "Cream", collection_ids: [] },
    { product_id: "p3", title: "Mist", collection_ids: ["colX"] },
  ],
  target_product_ids_map: { t1: ["p1"] },
  nodes: [{ type: "result", data: { fallback_collection_id: "colF" } }],
  rec_page_settings: { global: {} },
};

describe("computeReachability", () => {
  it("a product in no target, no fallback and no safety net is provably unreachable", () => {
    const r = computeReachability(BASE)!;
    expect(r.mapped).toBe(3);
    expect(r.targetCount).toBe(1);
    expect(r.unreachable.map((u) => u.productId).sort()).toEqual(["p2", "p3"]);
    expect(r.stateById.get("p1")).toBe("reachable");
  });

  it("a fallback or safety-net collection rescues its members", () => {
    const r = computeReachability({
      ...BASE,
      nodes: [{ type: "result", data: { fallback_collection_id: "colX" } }],
      rec_page_settings: { global: { safetyNetCol: "colA" } },
    })!;
    // p3 via the result fallback, p1 via target + safety net; only p2 remains.
    expect(r.unreachable.map((u) => u.productId)).toEqual(["p2"]);
  });

  it("legacy docs (no baked map) return null — never a guess", () => {
    expect(computeReachability({ product_index: BASE.product_index })).toBeNull();
    expect(computeReachability(null)).toBeNull();
    expect(computeReachability({ logic_model: "decider" })).toBeNull();
  });
});
