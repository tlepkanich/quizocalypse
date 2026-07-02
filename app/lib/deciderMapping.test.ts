import { describe, expect, it } from "vitest";
import { mapAnswersToTargets, pickDeciderIndex } from "./deciderMapping";
import { deciderAddendum } from "./claude";

const buckets = [
  { id: "cat_dry", tags: ["dry", "hydration"] },
  { id: "cat_oily", tags: ["oily", "matte"] },
  { id: "cat_combo", tags: ["combo"] },
];

describe("mapAnswersToTargets — argmax tag overlap + total coverage", () => {
  it("argmax overlap wins, case-insensitively; ties go to the earlier bucket", () => {
    const out = mapAnswersToTargets(
      [
        { tags: ["DRY"] }, // → cat_dry (case-insensitive)
        { tags: ["oily", "matte"] }, // overlap 2 → cat_oily
        { tags: ["dry", "oily"] }, // 1 vs 1 tie → earlier bucket wins
      ],
      buckets,
    );
    expect(out).toEqual(["cat_dry", "cat_oily", "cat_dry"]);
  });

  it("no-overlap answers fill UNUSED buckets first, then wrap positionally", () => {
    const out = mapAnswersToTargets(
      [
        { tags: ["dry"] }, // → cat_dry
        { tags: [] }, // unused fill → cat_oily
        { tags: [] }, // unused fill → cat_combo
        { tags: [] }, // exhausted → j % len = 3 % 3 → cat_dry
      ],
      buckets,
    );
    expect(out).toEqual(["cat_dry", "cat_oily", "cat_combo", "cat_dry"]);
    // EVERY answer got a target — V4 by construction.
    expect(out.every(Boolean)).toBe(true);
  });

  it("empty buckets → empty mapping (the degenerate guard)", () => {
    expect(mapAnswersToTargets([{ tags: ["x"] }], [])).toEqual([]);
  });
});

describe("pickDeciderIndex — distinct-coverage score, earliest tie-break", () => {
  it("picks the question whose answers map to the most DISTINCT targets", () => {
    const questions = [
      // 2 answers → both argmax to cat_dry → 1 distinct
      { question_type: "single_select", answers: [{ tags: ["dry"] }, { tags: ["hydration"] }] },
      // 3 answers → 3 distinct targets
      {
        question_type: "single_select",
        answers: [{ tags: ["dry"] }, { tags: ["oily"] }, { tags: ["combo"] }],
      },
    ];
    expect(pickDeciderIndex(questions, buckets)).toBe(1);
  });

  it("ties go to the EARLIEST eligible question in the flow", () => {
    const q = {
      question_type: "single_select",
      answers: [{ tags: ["dry"] }, { tags: ["oily"] }],
    };
    expect(pickDeciderIndex([q, { ...q }], buckets)).toBe(0);
  });

  it("multi_select and freeform questions are never eligible (§2.2)", () => {
    const questions = [
      { question_type: "multi_select", answers: [{ tags: ["dry"] }, { tags: ["oily"] }] },
      { question_type: "text", answers: [{ tags: ["dry"] }, { tags: ["oily"] }] },
      { question_type: "rating", answers: [{ tags: ["dry"] }, { tags: ["oily"] }] },
    ];
    expect(pickDeciderIndex(questions, buckets)).toBe(2);
  });

  it("returns -1 when nothing is eligible", () => {
    expect(
      pickDeciderIndex(
        [{ question_type: "multi_select", answers: [{ tags: ["dry"] }] }],
        buckets,
      ),
    ).toBe(-1);
  });
});

describe("deciderAddendum — prompt byte-stability", () => {
  it("absent flag returns the EMPTY string (legacy system prompt identical)", () => {
    expect(deciderAddendum(undefined)).toBe("");
  });
  it("decider flag returns a non-empty addendum", () => {
    expect(deciderAddendum("decider")).toContain("ONE-DECIDER");
  });
});
