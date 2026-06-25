import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { computeBucketCoverage, type CoverageBucket } from "./bucketCoverage";

// Quiz with 3 questions whose answers point at buckets via tags + points.
function doc(answerSets: { tags?: string[]; points?: Record<string, number> }[][]) {
  const nodes: unknown[] = [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
  ];
  answerSets.forEach((answers, qi) => {
    nodes.push({
      id: `q${qi}`,
      type: "question",
      position: { x: 0, y: 0 },
      data: {
        text: `q${qi}`,
        question_type: "single_select",
        answers: answers.map((a, ai) => ({
          id: `q${qi}_a${ai}`,
          text: `a${ai}`,
          tags: a.tags ?? [],
          edge_handle_id: `q${qi}_h${ai}`,
          ...(a.points ? { points: a.points } : {}),
        })),
      },
    });
  });
  nodes.push({
    id: "r1",
    type: "result",
    position: { x: 0, y: 0 },
    data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
  });
  return Quiz.parse({ quiz_id: "q", scope: { collection_ids: [] }, nodes, edges: [] });
}

const buckets: CoverageBucket[] = [
  { id: "cat-oily", name: "Oily", tags: ["oily"] },
  { id: "cat-dry", name: "Dry", tags: ["dry"] },
  { id: "cat-bare", name: "Bare", tags: ["nothing-matches"] },
];

describe("computeBucketCoverage", () => {
  it("counts tag overlap per bucket and classifies relative to the top", () => {
    const d = doc([
      [{ tags: ["oily"] }, { tags: ["dry"] }],
      [{ tags: ["Oily"] }, { tags: ["oily"] }], // case-insensitive; oily=3 total
    ]);
    const cov = computeBucketCoverage(d, buckets);
    const oily = cov.find((c) => c.id === "cat-oily")!;
    const dry = cov.find((c) => c.id === "cat-dry")!;
    const bare = cov.find((c) => c.id === "cat-bare")!;
    expect(oily.count).toBe(3);
    expect(dry.count).toBe(1); // 1/3 < 50% → weak
    expect(bare.count).toBe(0);
    expect(oily.level).toBe("strong");
    expect(dry.level).toBe("weak");
    expect(bare.level).toBe("none");
  });

  it("counts points entries as coverage", () => {
    const d = doc([[{ points: { "cat-dry": 2 } }, { points: { "cat-dry": 1 } }]]);
    const cov = computeBucketCoverage(d, buckets);
    expect(cov.find((c) => c.id === "cat-dry")!.count).toBe(2);
    expect(cov.find((c) => c.id === "cat-dry")!.level).toBe("strong");
  });

  it("all buckets are 'none' when nothing matches", () => {
    const d = doc([[{ tags: ["unrelated"] }, { tags: ["also-nope"] }]]);
    const cov = computeBucketCoverage(d, buckets);
    expect(cov.every((c) => c.level === "none")).toBe(true);
  });
});
