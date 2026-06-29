import { describe, expect, it } from "vitest";
import { Quiz } from "../../../lib/quizSchema";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import {
  orderedQuestions,
  answerBucketId,
  isAnswerMapped,
  questionHasUnmappedAnswer,
  orphanedBucketIds,
} from "./questionOrder";

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
