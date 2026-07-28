import { describe, expect, it } from "vitest";
import {
  MAX_PREPICK_KEYS,
  foldGoalBrief,
  friendlyPrepickError,
  resolveGoalPickRows,
  type BucketResolveInputs,
} from "./goalPrepick";
import type { GroupingProduct } from "./categoryGrouping";
import { hydrateCollectionProducts } from "./categoryGrouping";

// FLOW-1 — the goal pre-pick's pure half: brief folding (the shape-goal-build
// shape), AI-key resolution (dedupe/cap/hallucination-drop through the same
// bucketRowsFor trust boundary the browser uses), and the four-outcome copy.

const products: GroupingProduct[] = [
  { productId: "gid://p/1", title: "All-mountain board", tags: ["all-mountain"], productType: "Board", collectionIds: ["c1"] },
  { productId: "gid://p/2", title: "Park board", tags: ["park"], productType: "Board", collectionIds: ["c1"] },
  { productId: "gid://p/3", title: "Beginner bindings", tags: ["beginner"], productType: "Binding", collectionIds: ["c2"] },
];

function inputs(): BucketResolveInputs {
  return {
    products,
    collections: hydrateCollectionProducts(
      [
        { collectionId: "c1", title: "Boards" },
        { collectionId: "c2", title: "Bindings" },
      ],
      products,
    ),
    productTitleById: new Map(products.map((p) => [p.productId, p.title])),
    collectionTitleById: new Map([
      ["c1", "Boards"],
      ["c2", "Bindings"],
    ]),
  };
}

describe("foldGoalBrief", () => {
  it("folds audience + factors into the stored goal text", () => {
    expect(foldGoalBrief("Find the right board", "New riders", "Terrain, budget")).toBe(
      "Find the right board\nAudience: New riders\nDeciding factors: Terrain, budget",
    );
  });

  it("omits empty sharpeners (the plain-goal shape)", () => {
    expect(foldGoalBrief("Find the right board", "  ", "")).toBe("Find the right board");
  });

  it("caps the field lengths (goal 500, sharpeners 200)", () => {
    const folded = foldGoalBrief("g".repeat(600), "a".repeat(300), "");
    const [goalLine, audLine] = folded.split("\n");
    expect(goalLine).toHaveLength(500);
    expect(audLine).toBe(`Audience: ${"a".repeat(200)}`);
  });
});

describe("resolveGoalPickRows", () => {
  it("resolves collection keys to member-bearing rows", () => {
    const rows = resolveGoalPickRows({ strategy: "collection", keys: ["c1", "c2"] }, inputs());
    expect(rows.map((r) => r.sourceRef)).toEqual(["c1", "c2"]);
    expect(rows[0]?.productIds).toEqual(["gid://p/1", "gid://p/2"]);
  });

  it("drops hallucinated keys silently and keeps the valid ones", () => {
    const rows = resolveGoalPickRows(
      { strategy: "product", keys: ["gid://p/1", "gid://p/999"] },
      inputs(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceRef).toBe("gid://p/1");
  });

  it("de-duplicates and caps the key set", () => {
    const keys = [
      "gid://p/1",
      "gid://p/1", // dupe
      ...Array.from({ length: 20 }, (_, i) => `gid://p/x${i}`),
    ];
    const rows = resolveGoalPickRows({ strategy: "product", keys }, inputs());
    // Only p/1 resolves, but the CAP is applied before resolution: at most
    // MAX_PREPICK_KEYS distinct keys are even attempted.
    expect(rows).toHaveLength(1);
    expect(MAX_PREPICK_KEYS).toBe(8);
  });

  it("returns empty when nothing resolves (the fallback trigger)", () => {
    const rows = resolveGoalPickRows({ strategy: "tag", keys: ["no-such-tag"] }, inputs());
    expect(rows).toEqual([]);
  });
});

describe("friendlyPrepickError (four-outcome copy)", () => {
  it("maps credit depletion to the unavailable class", () => {
    expect(friendlyPrepickError(new Error("400 credit balance is too low"))).toMatch(
      /temporarily unavailable/,
    );
  });
  it("maps rate limits to the busy class", () => {
    expect(friendlyPrepickError(new Error("429 rate_limit_error"))).toMatch(/busy right now/);
  });
  it("maps everything else to the generic failed class without leaking the raw error", () => {
    const msg = friendlyPrepickError(new Error("ZodError: strategy invalid"));
    expect(msg).toMatch(/couldn't pick products/);
    expect(msg).not.toMatch(/Zod/);
  });
});
