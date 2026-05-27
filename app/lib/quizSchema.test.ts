import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";

const validQuiz = {
  quiz_id: "q_test_1",
  status: "draft",
  scope: { collection_ids: ["gid://shopify/Collection/1"] },
  nodes: [
    {
      id: "intro",
      type: "intro",
      position: { x: 0, y: 0 },
      data: { headline: "Welcome" },
    },
    {
      id: "q1",
      type: "question",
      position: { x: 300, y: 0 },
      data: {
        text: "What's your skin type?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "Oily", tags: ["oily"], edge_handle_id: "h1" },
          { id: "a2", text: "Dry", tags: ["dry"], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "r1",
      type: "result",
      position: { x: 600, y: 0 },
      data: {
        headline: "Your match",
        fallback_collection_id: "gid://shopify/Collection/1",
      },
    },
  ],
  edges: [
    { id: "e1", source: "intro", target: "q1" },
    { id: "e2", source: "q1", target: "r1" },
  ],
  recommendation_logic: [
    {
      question_id: "q1",
      answer_id: "a1",
      tags: ["oily"],
    },
  ],
  results_pages: [
    {
      id: "r1",
      headline: "Your match",
      product_ids: ["gid://shopify/Product/1"],
    },
  ],
};

describe("Quiz schema", () => {
  it("accepts a minimal valid quiz", () => {
    const parsed = Quiz.parse(validQuiz);
    expect(parsed.quiz_id).toBe("q_test_1");
    expect(parsed.nodes).toHaveLength(3);
  });

  it("rejects a question with fewer than 2 answers", () => {
    const bad = structuredClone(validQuiz);
    (bad.nodes[1] as { data: { answers: unknown[] } }).data.answers = [
      { id: "a1", text: "Only one", tags: [], edge_handle_id: "h1" },
    ];
    expect(() => Quiz.parse(bad)).toThrow();
  });

  it("rejects an unknown node type", () => {
    const bad = structuredClone(validQuiz);
    (bad.nodes[0] as { type: string }).type = "banana";
    expect(() => Quiz.parse(bad)).toThrow();
  });

  it("rejects a result node missing fallback_collection_id", () => {
    const bad = structuredClone(validQuiz);
    delete (bad.nodes[2] as { data: { fallback_collection_id?: string } }).data.fallback_collection_id;
    expect(() => Quiz.parse(bad)).toThrow();
  });

  it("defaults optional fields", () => {
    const parsed = Quiz.parse(validQuiz);
    expect(parsed.design_tokens).toEqual({});
    expect(parsed.design_overrides).toEqual({});
  });
});
