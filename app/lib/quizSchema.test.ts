import { describe, expect, it } from "vitest";
import {
  AskAIData,
  EndData,
  MessageData,
  Quiz,
  QuizNode,
} from "./quizSchema";

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
    expect(parsed.breakpoint_overrides).toEqual({});
  });

  it("accepts message and end node types", () => {
    const withMsgEnd = structuredClone(validQuiz);
    withMsgEnd.nodes.push({
      id: "m1",
      type: "message",
      position: { x: 900, y: 0 },
      data: { text: "Thanks @name!" },
    } as never);
    withMsgEnd.nodes.push({
      id: "end1",
      type: "end",
      position: { x: 1200, y: 0 },
      data: {
        headline: "All done",
        cta_label: "Shop now",
        cta_url: "https://example.com/shop",
      },
    } as never);
    const parsed = Quiz.parse(withMsgEnd);
    expect(parsed.nodes).toHaveLength(5);
    const m = parsed.nodes.find((n) => n.id === "m1");
    expect(m?.type).toBe("message");
    if (m?.type === "message") {
      expect(m.data.supports_merge_tags).toBe(true);
    }
  });

  it("accepts breakpoint_overrides on Quiz top-level", () => {
    const withBp = structuredClone(validQuiz);
    (withBp as { breakpoint_overrides?: unknown }).breakpoint_overrides = {
      q1: {
        desktop: { colors: { primary: "#111111" } },
        mobile: { colors: { primary: "#222222" } },
      },
    };
    const parsed = Quiz.parse(withBp);
    expect(parsed.breakpoint_overrides.q1?.desktop?.colors?.primary).toBe(
      "#111111",
    );
    expect(parsed.breakpoint_overrides.q1?.mobile?.colors?.primary).toBe(
      "#222222",
    );
  });
});

describe("MessageData", () => {
  it("requires non-empty text", () => {
    expect(() => MessageData.parse({ text: "" })).toThrow();
  });

  it("defaults supports_merge_tags to true", () => {
    const parsed = MessageData.parse({ text: "Hello" });
    expect(parsed.supports_merge_tags).toBe(true);
  });
});

describe("EndData", () => {
  it("requires headline", () => {
    expect(() => EndData.parse({})).toThrow();
    expect(() => EndData.parse({ headline: "" })).toThrow();
  });

  it("rejects invalid cta_url", () => {
    expect(() =>
      EndData.parse({ headline: "Done", cta_url: "not-a-url" }),
    ).toThrow();
  });

  it("accepts a valid configuration", () => {
    const parsed = EndData.parse({
      headline: "Done",
      subtext: "Thanks",
      cta_label: "Visit shop",
      cta_url: "https://example.com",
      redirect_url: "https://example.com/results",
    });
    expect(parsed.headline).toBe("Done");
    expect(parsed.cta_url).toBe("https://example.com");
  });
});

describe("QuizNode discriminator", () => {
  it("routes by type to the correct data shape", () => {
    const node = QuizNode.parse({
      id: "m1",
      type: "message",
      position: { x: 0, y: 0 },
      data: { text: "Hi", supports_merge_tags: false },
    });
    expect(node.type).toBe("message");
    if (node.type === "message") {
      expect(node.data.supports_merge_tags).toBe(false);
    }
  });
});

describe("AskAIData", () => {
  it("requires system_prompt and opening_message", () => {
    expect(() =>
      AskAIData.parse({ system_prompt: "", opening_message: "Hi" }),
    ).toThrow();
    expect(() =>
      AskAIData.parse({ system_prompt: "Be nice", opening_message: "" }),
    ).toThrow();
  });

  it("applies sensible defaults", () => {
    const parsed = AskAIData.parse({
      system_prompt: "Be a friendly assistant.",
      opening_message: "Hello!",
    });
    expect(parsed.persona_name).toBe("Assistant");
    expect(parsed.suggested_questions).toEqual([]);
    expect(parsed.max_turns).toBe(6);
    expect(parsed.continue_label).toBe("Continue");
  });

  it("caps max_turns at 20", () => {
    expect(() =>
      AskAIData.parse({
        system_prompt: "x",
        opening_message: "x",
        max_turns: 21,
      }),
    ).toThrow();
  });

  it("rejects max_turns below 1", () => {
    expect(() =>
      AskAIData.parse({
        system_prompt: "x",
        opening_message: "x",
        max_turns: 0,
      }),
    ).toThrow();
  });
});

describe("ask_ai node integration", () => {
  it("parses inside a Quiz as a discriminated node", () => {
    const node = QuizNode.parse({
      id: "ai1",
      type: "ask_ai",
      position: { x: 0, y: 0 },
      data: {
        system_prompt: "Be helpful.",
        opening_message: "Hi there.",
      },
    });
    expect(node.type).toBe("ask_ai");
    if (node.type === "ask_ai") {
      expect(node.data.persona_name).toBe("Assistant");
      expect(node.data.max_turns).toBe(6);
    }
  });
});
