import { describe, expect, it } from "vitest";
import {
  AskAIData,
  BlockStyle,
  ContentBlock,
  EndData,
  IntegrationData,
  MessageData,
  ProductCardsData,
  Quiz,
  QuizNode,
  QuestionData,
  QuestionInputConfig,
  isFreeformType,
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

describe("B6 scale_config (rating / slider / numeric range + labels)", () => {
  const seed = { id: "a1", text: "0", tags: [], edge_handle_id: "h1" };

  it("is byte-stable when unset (no key in the parsed output)", () => {
    const input = { text: "How active?", question_type: "slider", answers: [seed] };
    const parsed = QuestionData.parse(input);
    expect(parsed.scale_config).toBeUndefined();
    // No new key introduced → JSON shape identical for legacy quizzes.
    expect(Object.prototype.hasOwnProperty.call(parsed, "scale_config")).toBe(false);
  });

  it("round-trips a full scale_config", () => {
    const parsed = QuestionData.parse({
      text: "Rate your skill",
      question_type: "slider",
      answers: [seed],
      scale_config: {
        min: 1,
        max: 10,
        step: 0.5,
        endpoint_label_min: "Beginner",
        endpoint_label_max: "Expert",
      },
    });
    expect(parsed.scale_config?.min).toBe(1);
    expect(parsed.scale_config?.max).toBe(10);
    expect(parsed.scale_config?.step).toBe(0.5);
    expect(parsed.scale_config?.endpoint_label_min).toBe("Beginner");
  });

  it("rejects a non-positive step", () => {
    expect(() =>
      QuestionData.parse({
        text: "Rate",
        question_type: "slider",
        answers: [seed],
        scale_config: { step: 0 },
      }),
    ).toThrow();
  });

  it("rejects an over-long endpoint label", () => {
    expect(() =>
      QuestionData.parse({
        text: "Rate",
        question_type: "slider",
        answers: [seed],
        scale_config: { endpoint_label_min: "x".repeat(41) },
      }),
    ).toThrow();
  });
});

describe("B6 per-question image_url", () => {
  const a2 = [
    { id: "a1", text: "One", tags: [], edge_handle_id: "h1" },
    { id: "a2", text: "Two", tags: [], edge_handle_id: "h2" },
  ];

  it("is byte-stable when unset (no key)", () => {
    const parsed = QuestionData.parse({ text: "Q", question_type: "single_select", answers: a2 });
    expect(parsed.image_url).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, "image_url")).toBe(false);
  });

  it("round-trips a valid image URL", () => {
    const parsed = QuestionData.parse({
      text: "Q",
      question_type: "single_select",
      answers: a2,
      image_url: "https://cdn.example.com/q.png",
    });
    expect(parsed.image_url).toBe("https://cdn.example.com/q.png");
  });

  it("rejects a non-URL image_url", () => {
    expect(() =>
      QuestionData.parse({
        text: "Q",
        question_type: "single_select",
        answers: a2,
        image_url: "not a url",
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

describe("ContentBlock (Phase 2 visual builder)", () => {
  it("parses each block type from just { id, type } with defaults", () => {
    expect(ContentBlock.parse({ id: "b1", type: "heading" })).toMatchObject({
      level: "h2",
      bind: "none",
      text: "",
      style: {},
    });
    expect(ContentBlock.parse({ id: "b2", type: "text" })).toMatchObject({
      bind: "none",
      supports_merge_tags: false,
    });
    expect(ContentBlock.parse({ id: "b3", type: "image" })).toMatchObject({
      bind: "none",
      fit: "cover",
      aspect: "auto",
    });
    expect(ContentBlock.parse({ id: "b4", type: "spacer" })).toMatchObject({ size: 24 });
    expect(ContentBlock.parse({ id: "b5", type: "divider" })).toMatchObject({ thickness: 1 });
    expect(ContentBlock.parse({ id: "b6", type: "button" })).toMatchObject({
      bind: "none",
      variant: "primary",
    });
    expect(ContentBlock.parse({ id: "b7", type: "answers" })).toMatchObject({
      layout: "auto",
    });
    expect(ContentBlock.parse({ id: "b8", type: "recommendations" })).toMatchObject({
      stage: "all",
    });
    for (const type of ["email_input", "ai_chat", "product_grid"]) {
      expect(ContentBlock.parse({ id: "x", type })).toMatchObject({ type, style: {} });
    }
  });

  it("rejects unknown block types and missing id", () => {
    expect(() => ContentBlock.parse({ id: "b", type: "carousel" })).toThrow();
    expect(() => ContentBlock.parse({ type: "heading" })).toThrow();
  });

  it("BlockStyle clamps ranges and is fully optional", () => {
    expect(BlockStyle.parse({})).toEqual({});
    expect(() => BlockStyle.parse({ margin_top: 9999 })).toThrow();
    expect(() => BlockStyle.parse({ font_weight: 50 })).toThrow();
    expect(BlockStyle.parse({ align: "center", padding: 8 })).toEqual({
      align: "center",
      padding: 8,
    });
  });
});

describe("node_layouts / node_css (Phase 2)", () => {
  it("default to empty maps when omitted (byte-identical back-compat)", () => {
    const parsed = Quiz.parse(validQuiz);
    expect(parsed.node_layouts).toEqual({});
    expect(parsed.node_css).toEqual({});
  });

  it("round-trips a populated node_layouts + node_css", () => {
    const parsed = Quiz.parse({
      ...validQuiz,
      node_layouts: {
        intro: [{ id: "h", type: "heading", bind: "headline" }],
      },
      node_css: { intro: ".x { color: #222 }" },
    });
    expect(parsed.node_layouts.intro?.[0]).toMatchObject({ type: "heading", level: "h2" });
    expect(parsed.node_css.intro).toBe(".x { color: #222 }");
  });
});

describe("Phase 5 — discount, phone, question types", () => {
  const base = {
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Pick",
          question_type: "dropdown",
          min_selections: 2,
          answers: [
            { id: "a1", text: "A", edge_handle_id: "h1", video_url: "https://x.test/v.mp4" },
            { id: "a2", text: "B", edge_handle_id: "h2" },
          ],
        },
      },
    ],
    edges: [{ id: "e1", source: "intro", target: "q1" }],
  };

  it("discount_config defaults to disabled", () => {
    expect(Quiz.parse(base).discount_config).toMatchObject({ enabled: false, kind: "percentage" });
  });

  it("parses dropdown type + min_selections + answer video_url", () => {
    const parsed = Quiz.parse(base);
    const q = parsed.nodes.find((n) => n.id === "q1")!;
    expect(q.type === "question" && q.data.question_type).toBe("dropdown");
    expect(q.type === "question" && q.data.min_selections).toBe(2);
    expect(q.type === "question" && q.data.answers[0]!.video_url).toBe("https://x.test/v.mp4");
  });

  it("email_gate collect_phone defaults to false", () => {
    const parsed = Quiz.parse({
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: "eg",
          type: "email_gate",
          position: { x: 2, y: 0 },
          data: { headline: "Email" },
        },
      ],
    });
    const eg = parsed.nodes.find((n) => n.id === "eg")!;
    expect(eg.type === "email_gate" && eg.data.collect_phone).toBe(false);
  });
});

describe("isFreeformType + numeric/date question types", () => {
  it("classifies freeform vs card types from one source", () => {
    for (const t of ["text", "email", "numeric", "date"]) {
      expect(isFreeformType(t)).toBe(true);
    }
    for (const t of ["single_select", "multi_select", "image_tile", "dropdown", "rating"]) {
      expect(isFreeformType(t)).toBe(false);
    }
  });

  it("numeric/date questions are valid with a single seed answer", () => {
    for (const question_type of ["numeric", "date"] as const) {
      const q = QuestionData.parse({
        text: question_type === "numeric" ? "What's your budget?" : "When's the event?",
        question_type,
        answers: [{ id: "a1", text: "seed", edge_handle_id: "h1" }],
      });
      expect(q.question_type).toBe(question_type);
      expect(q.answers).toHaveLength(1);
    }
  });

  it("rating (card type) still requires ≥2 answers", () => {
    expect(() =>
      QuestionData.parse({
        text: "Rate it",
        question_type: "rating",
        answers: [{ id: "a1", text: "1", edge_handle_id: "h1" }],
      }),
    ).toThrow();
  });
});

describe("editor revamp P3 — answer icons + answer_columns (additive)", () => {
  const base = {
    text: "Pick one",
    question_type: "single_select",
    answers: [
      { id: "a1", text: "A", edge_handle_id: "h1" },
      { id: "a2", text: "B", edge_handle_id: "h2" },
    ],
  };

  it("docs without the new fields still parse (additive)", () => {
    const q = QuestionData.parse(base);
    expect(q.answers[0]!.icon).toBeUndefined();
    expect(q.answer_columns).toBeUndefined();
  });

  it("accepts an emoji icon and an explicit column count", () => {
    const q = QuestionData.parse({
      ...base,
      answer_columns: 2,
      answers: [
        { id: "a1", text: "A", edge_handle_id: "h1", icon: "🏔️" },
        { id: "a2", text: "B", edge_handle_id: "h2" },
      ],
    });
    expect(q.answers[0]!.icon).toBe("🏔️");
    expect(q.answer_columns).toBe(2);
  });

  it("rejects over-long icons and out-of-range columns", () => {
    expect(() =>
      QuestionData.parse({
        ...base,
        answers: [
          { id: "a1", text: "A", edge_handle_id: "h1", icon: "x".repeat(17) },
          { id: "a2", text: "B", edge_handle_id: "h2" },
        ],
      }),
    ).toThrow();
    expect(() => QuestionData.parse({ ...base, answer_columns: 3 })).toThrow();
  });
});

describe("BIC P7 — review_enrichment_sources (additive, editor-only)", () => {
  const base = {
    quiz_id: "qz_src",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "r1",
        type: "result",
        position: { x: 1, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/1" },
      },
    ],
    edges: [{ id: "e1", source: "intro", target: "r1" }],
  };

  it("absent on old docs; round-trips when present", () => {
    expect(Quiz.parse(base).review_enrichment_sources).toBeUndefined();
    const withSrc = Quiz.parse({
      ...base,
      review_enrichment_sources: {
        text: "Loved it, never caught an edge.",
        url: "https://example.com/reviews",
        enriched_at: "2026-06-10T00:00:00.000Z",
      },
    });
    expect(withSrc.review_enrichment_sources?.text).toContain("never caught an edge");
  });
});

// Step 1 S2 — build_session + TemplateOption seams (additive, draft-only).
describe("build_session (Step 1 funnel scratch state)", () => {
  it("is optional — an existing quiz parses without it", () => {
    const parsed = Quiz.parse(validQuiz);
    expect(parsed.build_session).toBeUndefined();
  });

  it("preserves a build_session through parse (survives autosave)", () => {
    const parsed = Quiz.parse({
      ...validQuiz,
      build_session: {
        stage: "goal",
        grouping: { dimension: "collection", confirmed_category_ids: ["c1", "c2"] },
        goal: { goal_text: "Help shoppers find the right board", struggle_text: "too many specs" },
        template_options: [
          {
            id: "match-1",
            experience_type: "product_match",
            title: "Find your board",
            angle: "Match by terrain + skill",
            sample_questions: ["Where do you ride?", "What's your level?"],
          },
        ],
      },
    });
    expect(parsed.build_session?.stage).toBe("goal");
    expect(parsed.build_session?.grouping?.dimension).toBe("collection");
    expect(parsed.build_session?.template_options).toHaveLength(1);
    expect(parsed.build_session?.template_options[0]!.sample_questions).toHaveLength(2);
  });

  it("rejects a TemplateOption with fewer than 2 sample questions", () => {
    expect(() =>
      Quiz.parse({
        ...validQuiz,
        build_session: {
          template_options: [
            { id: "x", experience_type: "survey", title: "t", angle: "a", sample_questions: ["only one"] },
          ],
        },
      }),
    ).toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-1) — schema seams + the byte-stability harness.
// The dual-model migration rests on ONE invariant: no legacy doc ever grows a
// v2 field through parse→write cycles. These tests are the permanent gate.
// ════════════════════════════════════════════════════════════════════════════
describe("LOGIC v2 schema seams (logic_model / role / target_id / rules / rec_page_settings)", () => {
  it("legacy docs stay byte-identical through parse→write cycles — no v2 field is ever injected", () => {
    const wire1 = JSON.parse(JSON.stringify(Quiz.parse(validQuiz)));
    // No v2 field materializes on a legacy doc.
    expect(wire1).not.toHaveProperty("logic_model");
    expect(wire1).not.toHaveProperty("decision_rules");
    expect(wire1).not.toHaveProperty("rec_page_settings");
    const q = wire1.nodes.find((n: { type: string }) => n.type === "question");
    expect(q.data).not.toHaveProperty("role");
    for (const a of q.data.answers) expect(a).not.toHaveProperty("target_id");
    // Parse is byte-IDEMPOTENT: re-parsing the wire form reproduces it exactly.
    const wire2 = JSON.parse(JSON.stringify(Quiz.parse(wire1)));
    expect(JSON.stringify(wire2)).toBe(JSON.stringify(wire1));
  });

  it("a decider doc round-trips: model, roles, target mappings, rules, rec-page settings", () => {
    const decider = {
      ...validQuiz,
      logic_model: "decider",
      decision_rules: [
        {
          id: "rule_1",
          conditions: [
            { question_id: "q1", answer_id: "a1", op: "is" },
            { question_id: "q1", answer_id: "a2", op: "is_not" },
          ],
          target_id: "cat_backcountry",
        },
      ],
      rec_page_settings: {
        global: {
          headline: "Your perfect match",
          heroLogic: "collection_order",
          gridMax: 3,
          gridSort: "bestseller",
          heroOos: "next",
          emptyFallback: "collection",
          emptyFallbackCol: "bestsellers",
          safetyNetCol: "all-products",
          incentivePos: "below-headline",
        },
        overrides: {
          cat_dry: { headline: "Dry-skin picks", heroLogic: "newest" },
        },
      },
      nodes: validQuiz.nodes.map((n) =>
        n.id === "q1"
          ? {
              ...n,
              data: {
                ...n.data,
                role: "decides",
                answers: (n.data as { answers: { id: string }[] }).answers.map((a, i) => ({
                  ...a,
                  target_id: i === 0 ? "cat_oily" : "cat_dry",
                })),
              },
            }
          : n,
      ),
    };
    const parsed = Quiz.parse(decider);
    expect(parsed.logic_model).toBe("decider");
    expect(parsed.decision_rules?.[0]?.conditions).toHaveLength(2);
    expect(parsed.decision_rules?.[0]?.conditions[1]?.op).toBe("is_not");
    expect(parsed.decision_rules?.[0]?.target_id).toBe("cat_backcountry");
    expect(parsed.rec_page_settings?.global.heroLogic).toBe("collection_order");
    expect(parsed.rec_page_settings?.overrides["cat_dry"]?.heroLogic).toBe("newest");
    const q = parsed.nodes.find((n) => n.id === "q1");
    expect(q?.type === "question" && q.data.role).toBe("decides");
    expect(q?.type === "question" && q.data.answers[0]?.target_id).toBe("cat_oily");
    // Values survive a wire round-trip unchanged.
    const rewire = Quiz.parse(JSON.parse(JSON.stringify(parsed)));
    expect(rewire.rec_page_settings?.global.gridMax).toBe(3);
  });

  it("rejects invalid v2 values — incl. the RETIRED relevance/match signals (rec-page-spec-V2 §4)", () => {
    const bad = (patch: Record<string, unknown>) => ({ ...validQuiz, ...patch });
    // The v1 "match"/"relevance" signals do not exist in the v2 enums.
    expect(() =>
      Quiz.parse(bad({ rec_page_settings: { global: { heroLogic: "match" } } })),
    ).toThrow();
    expect(() =>
      Quiz.parse(bad({ rec_page_settings: { global: { gridSort: "relevance" } } })),
    ).toThrow();
    // gridMax bounds 1–12.
    expect(() =>
      Quiz.parse(bad({ rec_page_settings: { global: { gridMax: 0 } } })),
    ).toThrow();
    expect(() =>
      Quiz.parse(bad({ rec_page_settings: { global: { gridMax: 13 } } })),
    ).toThrow();
    // Rule conditions only support is / is_not.
    expect(() =>
      Quiz.parse(
        bad({
          decision_rules: [
            {
              id: "r",
              conditions: [{ question_id: "q1", answer_id: "a1", op: "contains" }],
              target_id: "t",
            },
          ],
        }),
      ),
    ).toThrow();
    // logic_model only accepts "decider".
    expect(() => Quiz.parse(bad({ logic_model: "weighted" }))).toThrow();
  });
});
