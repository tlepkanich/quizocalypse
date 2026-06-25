import { describe, expect, it } from "vitest";
import { ContentBlock, type QuizNode } from "./quizSchema";
import { synthesizeLayout } from "./synthesizeLayout";

const pos = { x: 0, y: 0 };

function types(blocks: ReturnType<typeof synthesizeLayout>): string[] {
  return blocks.map((b) => b.type);
}

const intro = (extra?: Partial<{ subtext: string; hero: string }>): QuizNode => ({
  id: "intro1",
  type: "intro",
  position: pos,
  data: {
    headline: "Hi",
    subtext: extra?.subtext ?? "",
    button_label: "Start",
    ...(extra?.hero ? { hero_image_url: extra.hero } : {}),
  },
});

const question: QuizNode = {
  id: "q1",
  type: "question",
  position: pos,
  data: {
    text: "Pick one",
    question_type: "single_select",
    required: true,
    answers: [
      { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
      { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
    ],
    show_preview_after: false,
  },
};

const result = (subtext = ""): QuizNode => ({
  id: "r1",
  type: "result",
  position: pos,
  data: {
    headline: "Your match",
    subtext,
    slot_count: 3,
    cta_label: "Shop now",
    fallback_collection_id: "gid://c/1",
    match_ladder: ["tag"],
    conditional_rules: [],
    ranking: "relevance",
    min_products: 1,
    oos_behavior: "show_with_badge",
    include_discount: false,
    subscription_eligible: false,
    show_variants: false,
    show_descriptions: false,
    urgency_enabled: false,
    urgency_threshold: 5,
    results_summary_bar: false,
    retake_link: false,
    stages: [],
    why_bullets: [],
  },
});

const message = (mergeTags: boolean): QuizNode => ({
  id: "m1",
  type: "message",
  position: pos,
  data: { text: "Hello @name", supports_merge_tags: mergeTags },
});

const end = (withCta: boolean): QuizNode => ({
  id: "e1",
  type: "end",
  position: pos,
  data: {
    headline: "Bye",
    subtext: "",
    ...(withCta ? { cta_label: "Go", cta_url: "https://x.example" } : {}),
  },
});

const branch: QuizNode = {
  id: "br1",
  type: "branch",
  position: pos,
  data: {
    label: "Branch",
    mode: "rules",
    slots: [
      { id: "s1", label: "A", weight: 1 },
      { id: "s2", label: "B", weight: 1 },
    ],
  },
};

const integration: QuizNode = {
  id: "int1",
  type: "integration",
  position: pos,
  data: {
    label: "Integration",
    actions: [{ kind: "webhook", url: "https://x.example", label: "wh" }],
    continue_on_error: true,
  },
};

const askAi: QuizNode = {
  id: "ai1",
  type: "ask_ai",
  position: pos,
  data: {
    system_prompt: "Be helpful",
    persona_name: "Assistant",
    opening_message: "Hi there",
    suggested_questions: [],
    max_turns: 6,
    continue_label: "Continue",
  },
};

const productCards = (subtext = ""): QuizNode => ({
  id: "pc1",
  type: "product_cards",
  position: pos,
  data: {
    headline: "Check these out",
    subtext,
    product_ids: ["gid://p/1"],
    cta_label: "Shop",
    continue_label: "Continue",
  },
});

const emailGate = (subtext = ""): QuizNode => ({
  id: "eg1",
  type: "email_gate",
  position: pos,
  data: {
    headline: "Your email",
    subtext,
    email_required: true,
    name_optional: true,
    skip_allowed: false,
    collect_phone: false,
  },
});

describe("synthesizeLayout — per node type", () => {
  it("intro: image only when hero present; subtext only when non-empty", () => {
    expect(types(synthesizeLayout(intro()))).toEqual(["heading", "button"]);
    expect(types(synthesizeLayout(intro({ subtext: "go" })))).toEqual([
      "heading",
      "text",
      "button",
    ]);
    expect(types(synthesizeLayout(intro({ hero: "https://x/y.png", subtext: "go" })))).toEqual([
      "image",
      "heading",
      "text",
      "button",
    ]);
    // intro heading is the h1
    const h = synthesizeLayout(intro())[0];
    expect(h).toMatchObject({ type: "heading", level: "h1", bind: "headline" });
  });

  it("question: heading bound to text + answers smart block", () => {
    expect(types(synthesizeLayout(question))).toEqual(["heading", "answers"]);
    expect(synthesizeLayout(question)[0]).toMatchObject({ bind: "text", level: "h2" });
  });

  it("email_gate: heading + (subtext) + email_input", () => {
    expect(types(synthesizeLayout(emailGate()))).toEqual(["heading", "email_input"]);
    expect(types(synthesizeLayout(emailGate("x")))).toEqual([
      "heading",
      "text",
      "email_input",
    ]);
  });

  it("result: stages vs none both yield one recommendations block", () => {
    expect(types(synthesizeLayout(result()))).toEqual(["heading", "recommendations"]);
    expect(types(synthesizeLayout(result("desc")))).toEqual([
      "heading",
      "text",
      "recommendations",
    ]);
    const recs = synthesizeLayout(result()).find((b) => b.type === "recommendations");
    expect(recs).toMatchObject({ stage: "all" });
  });

  it("message: text carries supports_merge_tags + a Continue button", () => {
    const blocks = synthesizeLayout(message(true));
    expect(types(blocks)).toEqual(["text", "button"]);
    expect(blocks[0]).toMatchObject({ type: "text", bind: "text", supports_merge_tags: true });
    expect(synthesizeLayout(message(false))[0]).toMatchObject({ supports_merge_tags: false });
  });

  it("end: button only when a cta_url is set", () => {
    expect(types(synthesizeLayout(end(false)))).toEqual(["heading"]);
    expect(types(synthesizeLayout(end(true)))).toEqual(["heading", "button"]);
  });

  it("ask_ai: single ai_chat block", () => {
    expect(types(synthesizeLayout(askAi))).toEqual(["ai_chat"]);
  });

  it("product_cards: heading + (subtext) + product_grid + button", () => {
    expect(types(synthesizeLayout(productCards()))).toEqual([
      "heading",
      "product_grid",
      "button",
    ]);
    expect(types(synthesizeLayout(productCards("x")))).toEqual([
      "heading",
      "text",
      "product_grid",
      "button",
    ]);
  });

  it("branch / integration: empty (invisible auto-advance)", () => {
    expect(synthesizeLayout(branch)).toEqual([]);
    expect(synthesizeLayout(integration)).toEqual([]);
  });
});

describe("synthesizeLayout — round-trips through ContentBlock", () => {
  const all: QuizNode[] = [
    intro({ hero: "https://x/y.png", subtext: "go" }),
    question,
    emailGate("x"),
    result("desc"),
    message(true),
    end(true),
    askAi,
    productCards("x"),
  ];
  it("every synthesized block re-parses with no default drift", () => {
    for (const node of all) {
      for (const block of synthesizeLayout(node)) {
        const parsed = ContentBlock.parse(block);
        expect(parsed).toEqual(block);
      }
    }
  });
  it("block ids are unique within a stack", () => {
    for (const node of all) {
      const ids = synthesizeLayout(node).map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
