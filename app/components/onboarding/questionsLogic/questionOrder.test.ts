import { describe, expect, it } from "vitest";
import { Quiz } from "../../../lib/quizSchema";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import {
  orderedQuestions,
  answerBucketId,
  isAnswerMapped,
  questionHasUnmappedAnswer,
  orphanedBucketIds,
  bucketMappedCounts,
  bucketCoverageTier,
  answerSkipValue,
} from "./questionOrder";
import { answerPassesFilter, GAP_FILTER } from "./tableFilters";
import { setAnswerRoute, routeAnswerToEnd } from "../../../lib/quizMutations";

// intro → q1 (single_select, a1→cat_oily, a2 unmapped) → q2 (text/freeform) → result.
function buildDoc(a2Bucket?: string): QuizDoc {
  const ans = (id: string, bucket?: string) => ({
    id,
    text: id,
    tags: [] as string[],
    edge_handle_id: `h_${id}`,
    ...(bucket ? { points: { [bucket]: 1 } } : {}),
  });
  return Quiz.parse({
    quiz_id: "q",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Q1",
          question_type: "single_select",
          required: true,
          show_preview_after: false,
          answers: [ans("a1", "cat_oily"), ans("a2", a2Bucket)],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Q2",
          question_type: "text",
          required: true,
          show_preview_after: false,
          answers: [ans("b1")],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 0, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
      },
    ],
    edges: [
      { id: "e0", source: "intro", target: "q1" },
      { id: "e1", source: "q1", target: "q2" },
      { id: "e2", source: "q2", target: "r1" },
    ],
  });
}

const qNode = (d: QuizDoc, id: string) => {
  const n = d.nodes.find((x) => x.id === id);
  if (n?.type !== "question") throw new Error(`${id} not a question`);
  return n;
};

describe("orderedQuestions", () => {
  it("returns questions in flow order with 1-based numbers", () => {
    const got = orderedQuestions(buildDoc()).map((o) => [o.node.id, o.qIndex]);
    expect(got).toEqual([
      ["q1", 1],
      ["q2", 2],
    ]);
  });
});

describe("answer mapping predicates", () => {
  it("answerBucketId returns the first points key or null", () => {
    const q1 = qNode(buildDoc(), "q1");
    expect(answerBucketId(q1.data.answers[0]!)).toBe("cat_oily");
    expect(answerBucketId(q1.data.answers[1]!)).toBeNull();
  });

  it("isAnswerMapped is true only when points carries a key", () => {
    const q1 = qNode(buildDoc(), "q1");
    expect(isAnswerMapped(q1.data.answers[0]!)).toBe(true);
    expect(isAnswerMapped(q1.data.answers[1]!)).toBe(false);
  });

  it("questionHasUnmappedAnswer flags a card question with an unmapped answer", () => {
    expect(questionHasUnmappedAnswer(qNode(buildDoc(), "q1"))).toBe(true); // a2 unmapped
    // freeform (open-text) has nothing to map → never flagged
    expect(questionHasUnmappedAnswer(qNode(buildDoc(), "q2"))).toBe(false);
    // map every answer → no longer flagged
    expect(questionHasUnmappedAnswer(qNode(buildDoc("cat_dry"), "q1"))).toBe(false);
  });
});

describe("orphanedBucketIds", () => {
  it("returns bucket ids no answer maps to (explicit points only)", () => {
    expect(orphanedBucketIds(buildDoc(), ["cat_oily", "cat_dry"])).toEqual(["cat_dry"]);
    // once an answer maps to cat_dry it's no longer orphaned
    expect(orphanedBucketIds(buildDoc("cat_dry"), ["cat_oily", "cat_dry"])).toEqual([]);
  });
});

describe("bucketMappedCounts (QL3 coverage pills)", () => {
  it("counts answers mapping to each bucket; orphans read 0", () => {
    const counts = bucketMappedCounts(buildDoc("cat_oily"), ["cat_oily", "cat_dry"]);
    expect(counts.get("cat_oily")).toBe(2); // a1 + a2 both map to cat_oily
    expect(counts.get("cat_dry")).toBe(0); // orphaned
  });
});

describe("answerSkipValue (shared Builder/Table routing read)", () => {
  it("is '' by default, the target id when routed, and '__end__' for an end node", () => {
    const doc = buildDoc();
    const a1 = qNode(doc, "q1").data.answers[0]!;
    expect(answerSkipValue(doc, "q1", a1)).toBe(""); // no per-answer edge
    const routed = setAnswerRoute(doc, "q1", a1.id, "q2");
    expect(answerSkipValue(routed, "q1", a1)).toBe("q2");
    const ended = routeAnswerToEnd(doc, "q1", a1.id);
    expect(answerSkipValue(ended, "q1", a1)).toBe("__end__");
  });
});

describe("answerPassesFilter (QL2 Table filter)", () => {
  it("matches all / gap / specific bucket against the shared predicate", () => {
    const q1 = qNode(buildDoc(), "q1");
    const mapped = q1.data.answers[0]!; // cat_oily
    const unmapped = q1.data.answers[1]!;
    expect(answerPassesFilter(mapped, "")).toBe(true);
    expect(answerPassesFilter(mapped, "cat_oily")).toBe(true);
    expect(answerPassesFilter(mapped, "cat_dry")).toBe(false);
    expect(answerPassesFilter(mapped, GAP_FILTER)).toBe(false);
    expect(answerPassesFilter(unmapped, GAP_FILTER)).toBe(true);
    expect(answerPassesFilter(unmapped, "cat_oily")).toBe(false);
  });

  it("bucketCoverageTier: orphan(0) · weak(<50% of top) · strong(>=50%)", () => {
    const counts = new Map<string, number>([
      ["a", 10], // top
      ["b", 5], // exactly 50% → strong (the threshold is strict <)
      ["c", 4], // < 50% → weak
      ["d", 0], // orphan
    ]);
    expect(bucketCoverageTier(counts, "a")).toBe("strong");
    expect(bucketCoverageTier(counts, "b")).toBe("strong");
    expect(bucketCoverageTier(counts, "c")).toBe("weak");
    expect(bucketCoverageTier(counts, "d")).toBe("orphan");
    // a missing id is treated as 0 → orphan
    expect(bucketCoverageTier(counts, "missing")).toBe("orphan");
    // when every bucket is unmapped, all are orphan (max 0, never weak)
    const allZero = new Map<string, number>([["a", 0], ["b", 0]]);
    expect(bucketCoverageTier(allZero, "a")).toBe("orphan");
    // a single mapped bucket is strong (it IS the top)
    const one = new Map<string, number>([["a", 3], ["b", 0]]);
    expect(bucketCoverageTier(one, "a")).toBe("strong");
    expect(bucketCoverageTier(one, "b")).toBe("orphan");
  });
});
