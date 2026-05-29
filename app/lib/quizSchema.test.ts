import { describe, expect, it } from "vitest";
import {
  AskAIData,
  EndData,
  IntegrationData,
  MessageData,
  ProductCardsData,
  Quiz,
  QuizNode,
  QuestionData,
  QuestionInputConfig,
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

describe("Freeform question types (text / email)", () => {
  const baseAnswer = {
    id: "a1",
    text: "Your input",
    tags: ["user-provided"],
    edge_handle_id: "h1",
  };

  it("accepts a text question with a single seed answer", () => {
    const parsed = QuestionData.parse({
      text: "What's your favorite color?",
      question_type: "text",
      answers: [baseAnswer],
    });
    expect(parsed.question_type).toBe("text");
    expect(parsed.answers).toHaveLength(1);
  });

  it("accepts an email question with a single seed answer", () => {
    const parsed = QuestionData.parse({
      text: "Where should we send your results?",
      question_type: "email",
      answers: [baseAnswer],
    });
    expect(parsed.question_type).toBe("email");
  });

  it("still rejects single_select with only one answer", () => {
    expect(() =>
      QuestionData.parse({
        text: "Pick one",
        question_type: "single_select",
        answers: [baseAnswer],
      }),
    ).toThrow(/at least 2 answers/);
  });

  it("allows input_config for freeform types", () => {
    const parsed = QuestionData.parse({
      text: "Tell us more",
      question_type: "text",
      answers: [baseAnswer],
      input_config: { placeholder: "Type here…", max_length: 200 },
    });
    expect(parsed.input_config?.placeholder).toBe("Type here…");
    expect(parsed.input_config?.max_length).toBe(200);
  });

  it("input_config caps max_length at 500", () => {
    expect(() =>
      QuestionInputConfig.parse({ max_length: 501 }),
    ).toThrow();
  });

  it("input_config defaults max_length to 120", () => {
    const parsed = QuestionInputConfig.parse({});
    expect(parsed.max_length).toBe(120);
    expect(parsed.placeholder).toBe("");
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

describe("IntegrationData", () => {
  it("requires at least one action", () => {
    expect(() => IntegrationData.parse({ actions: [] })).toThrow();
  });

  it("defaults continue_on_error to true", () => {
    const parsed = IntegrationData.parse({
      actions: [{ kind: "webhook", url: "https://x.example.com/h" }],
    });
    expect(parsed.continue_on_error).toBe(true);
    expect(parsed.label).toBe("Integration");
  });

  it("rejects non-URL webhook targets", () => {
    expect(() =>
      IntegrationData.parse({
        actions: [{ kind: "webhook", url: "not-a-url" }],
      }),
    ).toThrow();
  });

  it("accepts a webhook with secret + label", () => {
    const parsed = IntegrationData.parse({
      label: "Klaviyo sync",
      actions: [
        {
          kind: "webhook",
          url: "https://hooks.example.com/in",
          secret: "topsecret",
          label: "Klaviyo profile update",
        },
      ],
      continue_on_error: false,
    });
    const first = parsed.actions[0];
    if (first?.kind === "webhook") {
      expect(first.secret).toBe("topsecret");
    }
    expect(parsed.continue_on_error).toBe(false);
  });

  it("accepts a klaviyo action with list_id", () => {
    const parsed = IntegrationData.parse({
      actions: [
        {
          kind: "klaviyo",
          api_key: "pk_test",
          list_id: "UPxyz1",
        },
      ],
    });
    const first = parsed.actions[0];
    expect(first?.kind).toBe("klaviyo");
    if (first?.kind === "klaviyo") {
      expect(first.api_key).toBe("pk_test");
      expect(first.list_id).toBe("UPxyz1");
      expect(first.label).toBe("Klaviyo profile sync");
    }
  });

  it("rejects a klaviyo action without api_key", () => {
    expect(() =>
      IntegrationData.parse({
        actions: [{ kind: "klaviyo", api_key: "" }],
      }),
    ).toThrow();
  });
});

describe("ProductCardsData", () => {
  it("requires headline + ≥1 product id", () => {
    expect(() =>
      ProductCardsData.parse({ headline: "", product_ids: ["gid://x/1"] }),
    ).toThrow();
    expect(() =>
      ProductCardsData.parse({ headline: "Picks", product_ids: [] }),
    ).toThrow();
  });

  it("caps product_ids at 6", () => {
    expect(() =>
      ProductCardsData.parse({
        headline: "Picks",
        product_ids: Array.from({ length: 7 }, (_, i) => `gid://x/${i}`),
      }),
    ).toThrow();
  });

  it("applies cta_label and continue_label defaults", () => {
    const parsed = ProductCardsData.parse({
      headline: "Have a look",
      product_ids: ["gid://x/1"],
    });
    expect(parsed.cta_label).toBe("Shop");
    expect(parsed.continue_label).toBe("Continue");
    expect(parsed.subtext).toBe("");
  });
});

describe("integration + product_cards node integration", () => {
  it("parses both new node types under the discriminated union", () => {
    const intNode = QuizNode.parse({
      id: "int1",
      type: "integration",
      position: { x: 0, y: 0 },
      data: {
        actions: [{ kind: "webhook", url: "https://x.example.com/h" }],
      },
    });
    expect(intNode.type).toBe("integration");

    const pcNode = QuizNode.parse({
      id: "pc1",
      type: "product_cards",
      position: { x: 0, y: 0 },
      data: {
        headline: "Picks for you",
        product_ids: ["gid://shopify/Product/1"],
      },
    });
    expect(pcNode.type).toBe("product_cards");
  });
});

describe("Phase 6 question types", () => {
  it("accepts question_type=searchable with ≥2 answers", () => {
    expect(() =>
      QuestionData.parse({
        text: "Pick a brand",
        question_type: "searchable",
        answers: [
          { id: "a1", text: "Nike", tags: ["nike"], edge_handle_id: "h1" },
          { id: "a2", text: "Adidas", tags: ["adidas"], edge_handle_id: "h2" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects searchable with only 1 answer", () => {
    expect(() =>
      QuestionData.parse({
        text: "Pick a brand",
        question_type: "searchable",
        answers: [{ id: "a1", text: "Nike", tags: [], edge_handle_id: "h1" }],
      }),
    ).toThrow(/at least 2 answers/);
  });

  it("accepts image_picker with ≥2 answers", () => {
    expect(() =>
      QuestionData.parse({
        text: "Pick a style",
        question_type: "image_picker",
        answers: [
          {
            id: "a1",
            text: "Casual",
            tags: ["casual"],
            edge_handle_id: "h1",
            image_url: "https://example.com/casual.jpg",
          },
          {
            id: "a2",
            text: "Formal",
            tags: ["formal"],
            edge_handle_id: "h2",
            image_url: "https://example.com/formal.jpg",
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("LauncherConfig", () => {
  it("defaults to disabled with sparkle/bottom-right", () => {
    const parsed = Quiz.parse({
      quiz_id: "test",
      scope: { collection_ids: [] },
      nodes: [
        {
          id: "intro",
          type: "intro",
          position: { x: 0, y: 0 },
          data: { headline: "Hi" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 100, y: 0 },
          data: { headline: "Bye" },
        },
      ],
    });
    expect(parsed.launcher_config.enabled).toBe(false);
    expect(parsed.launcher_config.icon).toBe("sparkle");
    expect(parsed.launcher_config.corner).toBe("bottom-right");
    expect(parsed.launcher_config.label).toBe("");
  });

  it("accepts custom icon + color + label", () => {
    const parsed = Quiz.parse({
      quiz_id: "test",
      scope: { collection_ids: [] },
      launcher_config: {
        enabled: true,
        icon: "star",
        corner: "top-left",
        color: "#FF3D00",
        label: "Take the quiz",
      },
      nodes: [
        {
          id: "intro",
          type: "intro",
          position: { x: 0, y: 0 },
          data: { headline: "Hi" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 100, y: 0 },
          data: { headline: "Bye" },
        },
      ],
    });
    expect(parsed.launcher_config.enabled).toBe(true);
    expect(parsed.launcher_config.icon).toBe("star");
    expect(parsed.launcher_config.color).toBe("#FF3D00");
    expect(parsed.launcher_config.label).toBe("Take the quiz");
  });

  it("rejects unknown icon values", () => {
    expect(() =>
      Quiz.parse({
        quiz_id: "test",
        scope: { collection_ids: [] },
        launcher_config: { enabled: true, icon: "rocket" },
        nodes: [
          {
            id: "intro",
            type: "intro",
            position: { x: 0, y: 0 },
            data: { headline: "Hi" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 100, y: 0 },
            data: { headline: "Bye" },
          },
        ],
      }),
    ).toThrow();
  });
});
