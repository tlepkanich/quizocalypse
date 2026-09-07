import { describe, expect, it } from "vitest";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import {
  productsWord,
  quizUsedRefs,
  ruleCoverage,
  rulesWord,
  ruleTargetIds,
  splitRecommendationGroups,
} from "./createRuleBand";

function cat(id: string, extra: Partial<BuilderCategory> = {}): BuilderCategory {
  return {
    id,
    name: id,
    description: "",
    tags: [],
    productIds: [],
    source: "ai",
    sourceRef: null,
    quizId: "q",
    ...extra,
  };
}

describe("ruleTargetIds", () => {
  it("prefers target_ids and falls back to the single target_id byte-form", () => {
    expect(ruleTargetIds({ target_id: "a", target_ids: ["a", "b"] })).toEqual(["a", "b"]);
    expect(ruleTargetIds({ target_id: "a" })).toEqual(["a"]);
    expect(ruleTargetIds({ target_id: "a", target_ids: [] as unknown as [string] })).toEqual(["a"]);
  });
});

describe("ruleCoverage", () => {
  it("counts rules per target — a count, never a flag", () => {
    const cov = ruleCoverage([
      { id: "r1", conditions: [], target_id: "acne" },
      { id: "r2", conditions: [], target_id: "acne", target_ids: ["acne", "firming"] },
      { id: "r3", conditions: [], target_id: "barrier" },
    ]);
    expect(cov.get("acne")).toBe(2);
    expect(cov.get("firming")).toBe(1);
    expect(cov.get("barrier")).toBe(1);
    expect(cov.get("missing")).toBeUndefined();
  });

  it("counts a rule once per target even when target_ids repeats an id", () => {
    const cov = ruleCoverage([
      { id: "r1", conditions: [], target_id: "acne", target_ids: ["acne", "acne"] },
    ]);
    expect(cov.get("acne")).toBe(1);
  });

  it("is empty for an absent ledger", () => {
    expect(ruleCoverage(undefined).size).toBe(0);
  });
});

describe("splitRecommendationGroups", () => {
  it("puts uncovered groups first, each half in category order", () => {
    const cats = [cat("acne"), cat("firming"), cat("barrier"), cat("glow")];
    const cov = new Map([
      ["acne", 2],
      ["barrier", 1],
    ]);
    const { needs, done } = splitRecommendationGroups(cats, cov);
    expect(needs.map((c) => c.id)).toEqual(["firming", "glow"]);
    expect(done.map((c) => c.id)).toEqual(["acne", "barrier"]);
  });
});

describe("quizUsedRefs", () => {
  const doc = {
    nodes: [
      {
        type: "question",
        data: {
          answers: [
            {
              tags: [" retinoid ", "peptide", ""],
              collection_filter: "col-1",
              collection_filters: ["col-2"],
              metafield_filters: [{ key: "custom.texture", value: "rich" }],
            },
            { tags: ["peptide"] },
          ],
        },
      },
      { type: "intro", data: {} },
    ],
  } as unknown as Quiz;

  it("collects trimmed tags, both collection fields and metafields as key: value", () => {
    const used = quizUsedRefs(doc, []);
    expect([...used.tags]).toEqual(["retinoid", "peptide"]);
    expect([...used.collections]).toEqual(["col-1", "col-2"]);
    expect([...used.metafields]).toEqual(["custom.texture: rich"]);
    expect(used.products.size).toBe(0);
  });

  it("adds the groups' products and the refs of materialised tag/collection groups", () => {
    const used = quizUsedRefs(doc, [
      cat("g1", { productIds: ["p1", "p2"] }),
      cat("g2", { source: "tag", sourceRef: "fragrance-free", productIds: ["p2"] }),
      cat("g3", { source: "collection", sourceRef: "col-9" }),
    ]);
    expect([...used.products]).toEqual(["p1", "p2"]);
    expect(used.tags.has("fragrance-free")).toBe(true);
    expect(used.collections.has("col-9")).toBe(true);
  });
});

describe("words", () => {
  it("pluralise", () => {
    expect(rulesWord(1)).toBe("1 rule");
    expect(rulesWord(3)).toBe("3 rules");
    expect(productsWord(1)).toBe("1 product");
    expect(productsWord(0)).toBe("0 products");
  });
});
