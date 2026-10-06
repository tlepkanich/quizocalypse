// FIX-1 — anti-slop generation standards: the prompt rules, the deterministic
// stripEmoji sanitizer, and the parse-boundary proof that an emoji-laden AI
// response lands clean (question + answer text only — tags/urls untouched).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClientModule from "./client";
import {
  QUESTION_WRITING_RULES,
  QUIZ_TYPES_SYSTEM_PROMPT,
  RICH_TEMPLATES_SYSTEM_PROMPT,
  QUIZ_DIRECTION_SYSTEM_PROMPT,
  stripEmoji,
  stripAnswerEmDash,
  generateQuestionFlow,
  generateQuestionPlan,
  generateQuizDirection,
  regenerateQuestion,
  writePlannedQuestions,
  type GenerateQuestionFlowInput,
} from "./generation";

const createMessageMock = vi.hoisted(() => vi.fn());
const warmPromptCacheMock = vi.hoisted(() => vi.fn());
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, createMessage: createMessageMock, warmPromptCache: warmPromptCacheMock };
});

describe("QUESTION_WRITING_RULES — anti-slop copy standards in the prompt", () => {
  it("bans emoji, exclamation enthusiasm, and Title Case; demands sentence case", () => {
    expect(QUESTION_WRITING_RULES).toContain("NEVER use emoji");
    expect(QUESTION_WRITING_RULES).toContain("exclamation-mark enthusiasm");
    expect(QUESTION_WRITING_RULES).toContain("sentence case");
    expect(QUESTION_WRITING_RULES).toContain("never Title Case");
  });

  it("bans the em-dash answer gloss (GEN-COPY, owner 2026-08-16)", () => {
    expect(QUESTION_WRITING_RULES).toContain("em-dash gloss");
    expect(QUESTION_WRITING_RULES).toContain('"Label — explanation"');
    expect(QUESTION_WRITING_RULES).toContain("Never use an em dash inside an answer option");
  });

  it("keeps the AUDIT-21 survey-methodology rules intact (additive, not a rewrite)", () => {
    expect(QUESTION_WRITING_RULES).toContain("double-barreled");
    expect(QUESTION_WRITING_RULES).toContain("mutually exclusive and collectively exhaustive");
    expect(QUESTION_WRITING_RULES).toContain("at most 7 options");
    expect(QUESTION_WRITING_RULES).toContain("max_selections");
  });
});

describe("stripEmoji — deterministic pictograph sanitizer", () => {
  it("strips plain emoji and collapses the doubled space they leave", () => {
    expect(stripEmoji("Find your ride 🏂")).toBe("Find your ride");
    expect(stripEmoji("Ready? 🎉🎊 Pick a board")).toBe("Ready? Pick a board");
    expect(stripEmoji("✨ Glow routine ✨")).toBe("Glow routine");
  });

  it("strips ZWJ sequences, skin tones, flags, and keycaps as whole units", () => {
    expect(stripEmoji("For the 👨‍👩‍👧‍👦 family")).toBe("For the family");
    expect(stripEmoji("Wave 👋🏽 hello")).toBe("Wave hello");
    expect(stripEmoji("Made in 🇺🇸 factories")).toBe("Made in factories");
    expect(stripEmoji("Option 1️⃣ first")).toBe("Option first");
  });

  it("keeps accents, CJK, and legitimate symbols (& % $ ° – © ® ™)", () => {
    expect(stripEmoji("Café & crème brûlée – 50% off, 10° flex, $20")).toBe(
      "Café & crème brûlée – 50% off, 10° flex, $20",
    );
    expect(stripEmoji("初心者向けのボード")).toBe("初心者向けのボード");
    expect(stripEmoji("GORE-TEX® shell™ ©2026")).toBe("GORE-TEX® shell™ ©2026");
  });

  it("never collapses an all-emoji string to empty", () => {
    expect(stripEmoji("🎉🎉")).toBe("🎉🎉");
  });
});

describe("Haiku card prompts — catalog grounding (GEN-GROUND)", () => {
  it("the types pass grounds in buckets/catalog and treats identity+research as form-only", () => {
    expect(QUIZ_TYPES_SYSTEM_PROMPT).toContain("GROUND EVERY TYPE");
    expect(QUIZ_TYPES_SYSTEM_PROMPT).toContain("IGNORE those categories");
    expect(QUIZ_TYPES_SYSTEM_PROMPT).toContain("no em dashes");
  });

  it("the templates pass carries the same grounding rule (its title names the quiz)", () => {
    expect(RICH_TEMPLATES_SYSTEM_PROMPT).toContain("GROUND EVERY TEMPLATE");
    expect(RICH_TEMPLATES_SYSTEM_PROMPT).toContain("no em dashes");
  });

  it("the merged direction pass carries the same grounding + naming rules (DRAFT-FAST)", () => {
    expect(QUIZ_DIRECTION_SYSTEM_PROMPT).toContain("GROUND THE DIRECTION");
    expect(QUIZ_DIRECTION_SYSTEM_PROMPT).toContain("IGNORE those categories");
    expect(QUIZ_DIRECTION_SYSTEM_PROMPT).toContain("no em dashes");
    expect(QUIZ_DIRECTION_SYSTEM_PROMPT).toContain("never budget / price-range questions");
  });
});

describe("stripAnswerEmDash — deterministic answer-gloss backstop (GEN-COPY)", () => {
  it("rewrites the em-dash gloss to a comma", () => {
    expect(stripAnswerEmDash("Oily — shiny by midday, enlarged pores")).toBe(
      "Oily, shiny by midday, enlarged pores",
    );
    expect(stripAnswerEmDash("Comfortable — not oily, not dry")).toBe(
      "Comfortable, not oily, not dry",
    );
    expect(stripAnswerEmDash("Dry—tight and flaky")).toBe("Dry, tight and flaky");
  });

  it("collapses doubled separators and strips leading/trailing dashes", () => {
    expect(stripAnswerEmDash("Balanced, — lacking radiance")).toBe("Balanced, lacking radiance");
    expect(stripAnswerEmDash("— Not sure")).toBe("Not sure");
    expect(stripAnswerEmDash("Not sure —")).toBe("Not sure");
  });

  it("keeps en dashes (ranges), hyphens, and dash-free text untouched", () => {
    expect(stripAnswerEmDash("10–20 minutes a day")).toBe("10–20 minutes a day");
    expect(stripAnswerEmDash("Non-greasy gel")).toBe("Non-greasy gel");
    expect(stripAnswerEmDash("Park & freestyle")).toBe("Park & freestyle");
  });

  it("never collapses to empty", () => {
    expect(stripAnswerEmDash("—")).toBe("—");
  });
});

const toolResponse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: "t1", name, input }],
});

beforeEach(() => {
  createMessageMock.mockReset();
  warmPromptCacheMock.mockReset();
});

describe("generation parse boundary — emoji-laden AI output lands clean", () => {
  it("generateQuestionFlow strips emoji from question + answer text only", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_question_flow", {
        questions: [
          {
            text: "How do you like to ride? 🏂✨",
            question_type: "single_select",
            answers: [
              { text: "Carving groomers 🎿", tags: ["carve"] },
              { text: "Park & freestyle", tags: ["park"] },
            ],
          },
        ],
      }),
    );
    const flow = await generateQuestionFlow({
      goalPrompt: "match boards",
      questionCount: 1,
      catalogSummary: "tags: carve, park",
      buckets: [{ id: "b1", name: "Carvers", tags: ["carve"] }],
      flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
      tone: "friendly",
    });
    const q = flow.questions[0];
    if (!q) throw new Error("no question emitted");
    expect(q.text).toBe("How do you like to ride?");
    expect(q.answers.map((a) => a.text)).toEqual(["Carving groomers", "Park & freestyle"]);
    // Routing data is untouched by the sanitizer.
    expect(q.answers[0]?.tags).toEqual(["carve"]);
  });

  it("generateQuestionFlow rewrites em-dash answer glosses; question copy keeps its em dash", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_question_flow", {
        questions: [
          {
            text: "A few hours after cleansing — no products on — how does your skin feel?",
            question_type: "single_select",
            answers: [
              { text: "Oily — shiny by midday, enlarged pores", tags: ["oily-skin"] },
              { text: "Tight, rough, or flaky", tags: ["dry-skin"] },
            ],
          },
        ],
      }),
    );
    const flow = await generateQuestionFlow({
      goalPrompt: "match routines",
      questionCount: 1,
      catalogSummary: "tags: oily-skin, dry-skin",
      buckets: [{ id: "b1", name: "Oily", tags: ["oily-skin"] }],
      flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
      tone: "friendly",
      logicModel: "decider",
    });
    const q = flow.questions[0];
    if (!q) throw new Error("no question emitted");
    // Question text is NOT rewritten — only answer options carry the ban.
    expect(q.text).toBe("A few hours after cleansing — no products on — how does your skin feel?");
    expect(q.answers.map((a) => a.text)).toEqual([
      "Oily, shiny by midday, enlarged pores",
      "Tight, rough, or flaky",
    ]);
    expect(q.answers[0]?.tags).toEqual(["oily-skin"]);
  });

  it("regenerateQuestion strips emoji from the regenerated copy", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_question", {
        text: "What's your skin goal? 💖",
        question_type: "single_select",
        answers: [
          { text: "Hydration 💧", tags: ["dry"] },
          { text: "Oil control", tags: ["oily"] },
        ],
      }),
    );
    const regen = await regenerateQuestion({
      catalogSummary: "tags: dry, oily",
      existingQuestion: {
        text: "What's your skin goal?",
        question_type: "single_select",
        required: true,
        answers: [
          { id: "a1", text: "Hydration", tags: ["dry"] },
          { id: "a2", text: "Oil control", tags: ["oily"] },
        ],
      } as never,
      steeringPrompt: "",
    });
    expect(regen.text).toBe("What's your skin goal?");
    expect(regen.answers.map((a) => a.text)).toEqual(["Hydration", "Oil control"]);
  });
});

describe("generateQuestionFlow — roles, chapters, and a pinned count", () => {
  const base = {
    goalPrompt: "match boards",
    catalogSummary: "tags: carve, park",
    buckets: [{ id: "b1", name: "Carvers", tags: ["carve"] }],
    flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
    tone: "friendly" as const,
  };
  const q = (text: string, role?: "decides" | "narrows" | "info", extra: Record<string, string> = {}) => ({
    text,
    question_type: "single_select",
    ...(role ? { role } : {}),
    ...extra,
    answers: [
      { text: "A", tags: ["carve"] },
      { text: "B", tags: ["park"] },
    ],
  });

  it("passes role, section_label and helper_text through (they used to be dropped)", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_question_flow", {
        questions: [
          q("Where do you ride?", "decides"),
          q("What size?", "narrows", { section_label: "Your fit 🏂", helper_text: "Rough is fine." }),
          q("Anything else?", "info"),
        ],
      }),
    );
    const flow = await generateQuestionFlow({ ...base, questionCount: 3 });
    expect(flow.questions.map((x) => x.role)).toEqual(["decides", "narrows", "info"]);
    expect(flow.questions[1]).toMatchObject({ section_label: "Your fit", helper_text: "Rough is fine." });
  });

  it("leaves absent fields absent (role-less output keeps its old shape)", async () => {
    createMessageMock.mockResolvedValueOnce(toolResponse("emit_question_flow", { questions: [q("Where?")] }));
    const flow = await generateQuestionFlow({ ...base, questionCount: 1 });
    expect(Object.keys(flow.questions[0]!).sort()).toEqual(["answers", "question_type", "text"]);
  });

  it("retries a pinned count that misses, and asks for EXACTLY n", async () => {
    createMessageMock
      .mockResolvedValueOnce(toolResponse("emit_question_flow", { questions: [q("1"), q("2"), q("3")] }))
      .mockResolvedValueOnce(toolResponse("emit_question_flow", { questions: [q("1"), q("2")] }));
    const flow = await generateQuestionFlow({ ...base, questionCount: 2, exactQuestionCount: 2 });
    expect(createMessageMock).toHaveBeenCalledTimes(2);
    expect(flow.questions).toHaveLength(2);
    const firstCall = createMessageMock.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
      tools: Array<{ input_schema: { properties: { questions: { minItems: number; maxItems: number } } } }>;
    };
    expect(firstCall.messages[0]!.content).toContain("EXACTLY 2 questions");
    expect(firstCall.tools[0]!.input_schema.properties.questions).toMatchObject({ minItems: 2, maxItems: 2 });
  });

  it("trims a final overshoot without cutting the deciding question", async () => {
    const over = { questions: [q("n1", "narrows"), q("i1", "info"), q("d", "decides")] };
    createMessageMock
      .mockResolvedValueOnce(toolResponse("emit_question_flow", over))
      .mockResolvedValueOnce(toolResponse("emit_question_flow", over))
      .mockResolvedValueOnce(toolResponse("emit_question_flow", over));
    const flow = await generateQuestionFlow({ ...base, questionCount: 2, exactQuestionCount: 2 });
    expect(flow.questions.map((x) => x.text)).toEqual(["n1", "d"]);
  });

  it("keeps the old hint wording when no count is pinned", async () => {
    createMessageMock.mockResolvedValueOnce(toolResponse("emit_question_flow", { questions: [q("1")] }));
    await generateQuestionFlow({ ...base, questionCount: 5 });
    const call = createMessageMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(call.messages[0]!.content).toContain("Target question count: 5.");
  });
});

// DRAFT-FAST — the headless chains' ONE merged middle pass. The model writes
// a flat draft; the generator assembles the SAME persisted shapes the two
// card passes produced (QuizType + RichTemplateOption), product_match by
// construction, with derived ids.
describe("generateQuizDirection — one pass, the kept direction only", () => {
  const input = {
    brandSummary: "A snowboard brand.",
    positioning: { industry: "Winter sports", vertical: "snowboarding", price_tier: "premium", demographic: [] },
    goalPrompt: "match riders to boards",
    buckets: [{ id: "b1", name: "All-mountain", tags: ["all-mountain"] }],
    catalogSummary: "product types: snowboard",
    webResearchText: "",
  };
  const draft = {
    type_name: "Rider Needs Matcher",
    achieves: "Matches each rider to the right board.",
    question_range: { min: 5, max: 7 },
    title: "Find Your Board",
    angle: "Starts with where you ride, ends on one board.",
    sample_questions: ["Where do you ride most?", "How long have you been riding?"],
    feature_notes: ["Opens with a terrain question"],
    dials: { imagery: "high", graphics: "medium", word_forward: "low", lines: "sharp" },
    rec_defaults: { max_products: 3, oos_behavior: "show_with_badge" },
    question_count: 6,
  };

  it("assembles a product_match type + template with derived ids, in ONE call", async () => {
    createMessageMock.mockResolvedValueOnce(toolResponse("emit_quiz_direction", draft));
    const { type, template } = await generateQuizDirection(input);
    expect(createMessageMock).toHaveBeenCalledTimes(1);
    expect(type).toMatchObject({
      id: "rider-needs-matcher",
      experience_type: "product_match",
      name: "Rider Needs Matcher",
      question_range: { min: 5, max: 7 },
    });
    expect(template).toMatchObject({
      id: "find-your-board",
      experience_type: "product_match",
      title: "Find Your Board",
      question_count: 6,
      recommended_bucket_ids: [],
      dials: { imagery: "high", lines: "sharp" },
      rec_defaults: { max_products: 3, oos_behavior: "show_with_badge" },
    });
  });

  it("shows buckets under short refs and maps the picked refs back to ids", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_quiz_direction", { ...draft, recommended_buckets: ["B2", "b1", "B9", "nope"] }),
    );
    const { template } = await generateQuizDirection({
      ...input,
      buckets: [
        { id: "cat_all_mountain", name: "All-mountain", tags: [] },
        { id: "cat_park", name: "Park", tags: [] },
      ],
    });
    // Unknown refs drop; order follows the model's pick.
    expect(template.recommended_bucket_ids).toEqual(["cat_park", "cat_all_mountain"]);
    const call = createMessageMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(call.messages[0]!.content).toContain("- B1 — All-mountain");
    expect(call.messages[0]!.content).not.toContain("cat_all_mountain");
  });

  it("the question-length pin overrides the model's range and count", async () => {
    createMessageMock.mockResolvedValueOnce(toolResponse("emit_quiz_direction", draft));
    const { type, template } = await generateQuizDirection({ ...input, questionLength: 4 });
    expect(type.question_range).toEqual({ min: 4, max: 4 });
    expect(template.question_count).toBe(4);
    const call = createMessageMock.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(call.messages[0]!.content).toContain("exactly 4 questions");
  });

  it("normalizes a swapped range and keeps the count inside it (floor 3)", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_quiz_direction", {
        ...draft,
        question_range: { min: 9, max: 6 },
        question_count: 14,
      }),
    );
    const { type, template } = await generateQuizDirection(input);
    expect(type.question_range).toEqual({ min: 6, max: 9 });
    expect(template.question_count).toBe(9);

    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_quiz_direction", {
        ...draft,
        question_range: { min: 1, max: 2 },
        question_count: 1,
      }),
    );
    expect((await generateQuizDirection(input)).template.question_count).toBe(3);
  });

  it("falls back to stable ids when a name has no sluggable characters", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_quiz_direction", { ...draft, type_name: "診断", title: "クイズ" }),
    );
    const { type, template } = await generateQuizDirection(input);
    expect(type.id).toBe("quiz-type");
    expect(template.id).toBe("quiz-template");
  });

  it("retries a draft that fails validation, feeding the issue back", async () => {
    createMessageMock
      .mockResolvedValueOnce(toolResponse("emit_quiz_direction", { ...draft, sample_questions: [] }))
      .mockResolvedValueOnce(toolResponse("emit_quiz_direction", draft));
    const { template } = await generateQuizDirection(input);
    expect(createMessageMock).toHaveBeenCalledTimes(2);
    expect(template.title).toBe("Find Your Board");
    const retry = createMessageMock.mock.calls[1]![0] as { messages: Array<{ content: string }> };
    expect(retry.messages[0]!.content).toContain("Previous attempt failed validation: sample_questions");
  });

  it("throws QuizGenerationError when every attempt fails validation", async () => {
    createMessageMock.mockResolvedValue(toolResponse("emit_quiz_direction", { title: "" }));
    await expect(generateQuizDirection(input)).rejects.toThrow(
      "Quiz direction generation failed validation after retries.",
    );
    expect(createMessageMock).toHaveBeenCalledTimes(3);
  });
});

// QBUILD-FAST — the decider question build as PLAN → parallel WRITES. Same
// model as the single call; every call writes little (compact lines), and the
// wall time is the plan plus the slowest write.
describe("the planned question build — a compact plan, then the questions written in parallel", () => {
  // The two steps as the build composes them (onboardingBuild.server.ts).
  const generateQuestionFlowPlanned = async (input: GenerateQuestionFlowInput) =>
    writePlannedQuestions(input, await generateQuestionPlan(input));

  const base = {
    goalPrompt: "match riders to boards",
    questionCount: 3,
    catalogSummary: "tags: carve, park, wax",
    buckets: [
      { id: "b1", name: "Carvers", tags: ["carve"] },
      { id: "b2", name: "Park", tags: ["park"] },
    ],
    flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
    tone: "friendly" as const,
    logicModel: "decider" as const,
  };
  type PlannedCall = {
    model: string;
    system: Array<{ text: string; cache_control?: { type: string } }>;
    tools: Array<{ name: string }>;
    tool_choice: { name: string };
    messages: Array<{ content: string }>;
  };
  const planDraft = (questions: string[], extra: object = {}) => ({
    questions,
    decider_answers: ["On groomers", "In the park"],
    ...extra,
  });
  const written = (text: string, extra: object = {}) => ({
    text,
    answers: ["A => carve", "B => park"],
    ...extra,
  });
  // Answers each write call from the numbers its task names ("#2 and #3").
  const serve = (plan: object, write: (n: number) => object = (n) => written(`written ${n}`)) => {
    createMessageMock.mockImplementation(async (params: PlannedCall) => {
      if (params.tool_choice.name === "emit_question_plan") {
        return toolResponse("emit_question_plan", plan);
      }
      const line = params.messages[0]!.content.split("\n").find((l) => l.startsWith("Write ONLY"))!;
      const numbers = [...line.split(" of this plan")[0]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      return toolResponse("emit_questions", { questions: numbers.map(write) });
    });
  };
  const calls = () => createMessageMock.mock.calls.map((c) => c[0] as PlannedCall);
  const THREE = planDraft([
    "decides | single_select | Your riding | where they ride",
    "narrows | multi_select | Your riding | how they tune their board",
    "info | single_select | - | who the board is for",
  ]);

  it("parses the compact plan lines: role, input type, chapter and topic", async () => {
    serve(planDraft(
      ["decides | image_tile | Your riding | where they ride", "info | single_select | - | gift | or self"],
      { explainer: 2, helpers: [1] },
    ));
    const plan = await generateQuestionPlan(base);
    expect(plan).toEqual([
      {
        topic: "where they ride",
        question_type: "image_tile",
        role: "decides",
        section_label: "Your riding",
        answer_outline: ["On groomers", "In the park"],
        needs_helper: true,
      },
      // "-" = no chapter; a topic may itself contain " | ".
      { topic: "gift | or self", question_type: "single_select", role: "info", needs_explainer: true },
    ]);
  });

  it("writes one question per call and merges them in plan order", async () => {
    serve(THREE);
    const flow = await generateQuestionFlowPlanned(base);
    expect(createMessageMock).toHaveBeenCalledTimes(4); // 1 plan + 3 writes
    expect(flow.questions.map((q) => q.text)).toEqual(["written 1", "written 2", "written 3"]);
    // Structure (input type, role, chapter) is the plan's, deterministically.
    expect(flow.questions.map((q) => q.question_type)).toEqual([
      "single_select",
      "multi_select",
      "single_select",
    ]);
    expect(flow.questions.map((q) => q.role)).toEqual(["decides", "narrows", "info"]);
    expect(flow.questions.map((q) => q.section_label)).toEqual(["Your riding", "Your riding", undefined]);
    expect(flow.welcome_message).toBeUndefined();
    expect(flow.email_gate).toBeUndefined();
  });

  it("parses the compact answer lines: text, tags after the arrow, no arrow = no tags", async () => {
    serve(planDraft(["decides | single_select | - | where they ride"]), () => ({
      text: "Where do you ride?",
      answers: ["Groomed runs => carve, wax", "The park => park", "Not sure yet", "Both => (none)"],
    }));
    const flow = await generateQuestionFlowPlanned({ ...base, questionCount: 1 });
    expect(flow.questions[0]!.answers).toEqual([
      { text: "Groomed runs", tags: ["carve", "wax"] },
      { text: "The park", tags: ["park"] },
      { text: "Not sure yet", tags: [] },
      { text: "Both", tags: [] },
    ]);
  });

  it("every call sends the SAME cached prefix: both tools, the rules, the quiz context", async () => {
    serve(planDraft(["decides | single_select | - | where they ride", "info | single_select | - | who it is for"]));
    await generateQuestionFlowPlanned(base);
    const [plan, ...writes] = calls();
    expect(plan!.tool_choice.name).toBe("emit_question_plan");
    expect(plan!.tools.map((t) => t.name)).toEqual(["emit_question_plan", "emit_questions"]);
    expect(plan!.system).toHaveLength(2);
    expect(plan!.system[0]!.cache_control).toBeUndefined();
    expect(plan!.system[1]!.cache_control).toEqual({ type: "ephemeral" });
    expect(plan!.system[1]!.text).toContain("Catalog summary (only use tags that appear here):");
    expect(plan!.system[1]!.text).toContain("- Carvers [routing tags: carve]");
    for (const w of writes) {
      expect(w.tool_choice.name).toBe("emit_questions");
      expect(w.system).toEqual(plan!.system);
      expect(w.tools).toEqual(plan!.tools);
    }
  });

  it("each write call sees the whole plan and its own question's rules", async () => {
    serve(THREE);
    await generateQuestionFlowPlanned(base);
    const tasks = calls().slice(1).map((c) => c.messages[0]!.content);
    const first = tasks.find((t) => t.includes("Write ONLY question #1 of this plan"))!;
    const second = tasks.find((t) => t.includes("Write ONLY question #2 of this plan"))!;
    const third = tasks.find((t) => t.includes("Write ONLY question #3 of this plan"))!;
    for (const t of [first, second, third]) {
      expect(t).toContain("1. [decides · single_select] where they ride");
      expect(t).toContain("3. [info · single_select] who the board is for");
    }
    expect(first).toContain("#1 is the DECIDING question: phrase it diagnostically");
    expect(first).toContain("Its planned answers, to refine: On groomers | In the park.");
    expect(second).toContain("#2 NARROWS the product pool");
    expect(second).toContain("#2 is multi_select: set max_selections.");
    expect(second).not.toContain("Its planned answers");
    expect(third).toContain("#3 is an INFO question: its answers carry no tags.");
  });

  it("OVERLAP: the plan picks the count itself when asked to; a pin still wins", async () => {
    serve(planDraft(["decides | single_select | - | where they ride"]));
    await generateQuestionPlan({ ...base, chooseQuestionCount: true });
    expect(calls()[0]!.system[1]!.text).toContain("Question count: choose it by category norm");
    expect(calls()[0]!.system[1]!.text).not.toContain("Target question count");

    createMessageMock.mockClear();
    await generateQuestionPlan({ ...base, questionCount: 1, exactQuestionCount: 1, chooseQuestionCount: true });
    expect(calls()[0]!.system[1]!.text).toContain("EXACTLY 1 questions");
    expect(calls()[0]!.system[1]!.text).not.toContain("choose it by category norm");
  });

  it("OVERLAP: a plan that picks its own count must land in 5 to 9 — a thinner one is retried", async () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `${i === 0 ? "decides" : "info"} | single_select | Ch | topic ${i + 1}`);
    createMessageMock
      .mockResolvedValueOnce(toolResponse("emit_question_plan", planDraft(lines(3))))
      .mockResolvedValueOnce(toolResponse("emit_question_plan", planDraft(lines(5))));
    const plan = await generateQuestionPlan({ ...base, chooseQuestionCount: true });
    expect(plan).toHaveLength(5);
    const retry = createMessageMock.mock.calls[1]![0] as PlannedCall;
    expect(retry.messages[0]!.content).toContain("Expected 5 to 9 questions, got 3");
    // A hinted count ("Target question count") is not held to that range.
    createMessageMock.mockReset();
    createMessageMock.mockResolvedValue(toolResponse("emit_question_plan", planDraft(lines(3))));
    expect(await generateQuestionPlan(base)).toHaveLength(3);
    expect(createMessageMock).toHaveBeenCalledTimes(1);
  });

  it("more than three chapter labels is one label per question: such a plan carries none", async () => {
    const lines = (chapters: string[]) =>
      chapters.map((c, i) => `${i === 0 ? "decides" : "info"} | single_select | ${c} | topic ${i + 1}`);
    serve(planDraft(lines(["A", "A", "B", "C"])));
    expect((await generateQuestionPlan(base)).map((q) => q.section_label)).toEqual(["A", "A", "B", "C"]);
    serve(planDraft(lines(["A", "B", "C", "D"])));
    expect((await generateQuestionPlan(base)).map((q) => q.section_label)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("the quiz-wide budgets are the plan's: one explainer card, at most two helper lines", async () => {
    serve(
      planDraft(
        [
          "decides | single_select | - | where they ride",
          "narrows | single_select | - | base material",
          "info | single_select | - | who it is for",
          "info | single_select | - | how often they ride",
        ],
        { explainer: 2, helpers: [1, 3, 4] },
      ),
      (n) => written(`written ${n}`, { helper_text: `helper ${n}`, education_card_before: `card ${n}` }),
    );
    const flow = await generateQuestionFlowPlanned({ ...base, questionCount: 4 });
    // The third helper the model named is dropped; unmarked questions carry neither.
    expect(flow.questions.map((q) => q.helper_text)).toEqual(["helper 1", undefined, "helper 3", undefined]);
    expect(flow.questions.map((q) => q.education_card_before)).toEqual([undefined, "card 2", undefined, undefined]);
    const tasks = calls().slice(1).map((c) => c.messages[0]!.content);
    expect(tasks.find((t) => t.includes("question #2 of"))).toContain("#2 needs a concept explained first");
    expect(tasks.find((t) => t.includes("question #4 of"))).toContain("#4 gets no helper_text.");
  });

  it("exactly one question decides: a second is demoted, none is a validation failure", async () => {
    serve(planDraft([
      "decides | single_select | - | where they ride",
      "decides | single_select | - | how they ride",
    ]));
    expect((await generateQuestionPlan(base)).map((q) => q.role)).toEqual(["decides", "narrows"]);

    createMessageMock.mockReset();
    createMessageMock.mockResolvedValue(
      toolResponse("emit_question_plan", planDraft(["info | single_select | - | who it is for"])),
    );
    await expect(generateQuestionPlan(base)).rejects.toThrow(
      "Question plan generation failed validation after retries.",
    );
    const retry = createMessageMock.mock.calls[1]![0] as PlannedCall;
    expect(retry.messages[0]!.content).toContain("exactly one question must have role decides");
  });

  it("a malformed plan line is a validation failure that names the line", async () => {
    createMessageMock
      .mockResolvedValueOnce(toolResponse("emit_question_plan", planDraft(["decides | where they ride"])))
      .mockResolvedValueOnce(toolResponse("emit_question_plan", planDraft(["chooses | single_select | - | x"])))
      .mockResolvedValueOnce(
        toolResponse("emit_question_plan", planDraft(["decides | single_select | - | where they ride"])),
      );
    const plan = await generateQuestionPlan(base);
    expect(plan).toHaveLength(1);
    const [, second, third] = createMessageMock.mock.calls.map((c) => (c[0] as PlannedCall).messages[0]!.content);
    expect(second).toContain('questions.0: expected "role | input type | chapter | topic"');
    expect(third).toContain("questions.0: role must be decides, narrows or info");
  });

  it("a long plan is cut into at most 8 slices of consecutive questions", async () => {
    serve(planDraft(
      Array.from({ length: 10 }, (_, i) => `${i === 0 ? "decides" : "info"} | single_select | - | topic ${i + 1}`),
    ));
    const flow = await generateQuestionFlowPlanned({ ...base, questionCount: 10 });
    expect(createMessageMock).toHaveBeenCalledTimes(6); // 1 plan + 5 slices of 2
    expect(flow.questions.map((q) => q.text)).toEqual(
      Array.from({ length: 10 }, (_, i) => `written ${i + 1}`),
    );
    expect(calls().slice(1).map((c) => c.messages[0]!.content).some((t) =>
      t.includes("Write ONLY question #3 and #4 of this plan"),
    )).toBe(true);
  });

  it("applies the same copy passes as the single call (emoji, em-dash answers)", async () => {
    serve(planDraft(["decides | single_select | - | where they ride"]), () => ({
      text: "Where do you ride? 🏂",
      answers: ["Groomers — fast and smooth => carve", "Park ✨ => park"],
    }));
    const flow = await generateQuestionFlowPlanned({ ...base, questionCount: 1 });
    expect(flow.questions[0]!.text).toBe("Where do you ride?");
    expect(flow.questions[0]!.answers.map((a) => a.text)).toEqual(["Groomers, fast and smooth", "Park"]);
  });

  it("a pinned count that misses retries the plan, then trims an overshoot (never the decider)", async () => {
    const over = planDraft([
      "narrows | single_select | - | n1",
      "info | single_select | - | i1",
      "decides | single_select | - | d",
    ]);
    createMessageMock.mockResolvedValue(toolResponse("emit_question_plan", over));
    const plan = await generateQuestionPlan({ ...base, questionCount: 2, exactQuestionCount: 2 });
    expect(createMessageMock).toHaveBeenCalledTimes(3);
    expect(plan.map((q) => q.topic)).toEqual(["n1", "d"]);
    const retry = createMessageMock.mock.calls[1]![0] as PlannedCall;
    expect(retry.messages[0]!.content).toContain("Expected exactly 2 questions, got 3");
    expect(retry.system[1]!.text).toContain("EXACTLY 2 questions");
  });

  it("a slice that returns the wrong count, or an answer with no text, retries; one that keeps failing fails the build", async () => {
    const ONE = planDraft(["decides | single_select | - | where they ride"]);
    let writes = 0;
    createMessageMock.mockImplementation(async (params: PlannedCall) => {
      if (params.tool_choice.name === "emit_question_plan") return toolResponse("emit_question_plan", ONE);
      writes += 1;
      return toolResponse("emit_questions", {
        questions:
          writes === 1
            ? [written("a"), written("b")]
            : writes === 2
              ? [{ text: "x", answers: [" => carve", "B"] }]
              : [written("only")],
      });
    });
    const flow = await generateQuestionFlowPlanned({ ...base, questionCount: 1 });
    expect(writes).toBe(3);
    expect(flow.questions.map((q) => q.text)).toEqual(["only"]);

    createMessageMock.mockImplementation(async (params: PlannedCall) =>
      params.tool_choice.name === "emit_question_plan"
        ? toolResponse("emit_question_plan", ONE)
        : toolResponse("emit_questions", { questions: [{ text: "", answers: [] }] }),
    );
    await expect(generateQuestionFlowPlanned({ ...base, questionCount: 1 })).rejects.toThrow(
      "Planned question write failed validation after retries.",
    );
  });

  it("a stalled call is raced by an identical second request; the first answer wins", async () => {
    vi.useFakeTimers();
    try {
      const ONE = planDraft(["decides | single_select | - | where they ride"]);
      let writeCalls = 0;
      createMessageMock.mockImplementation((params: PlannedCall) => {
        if (params.tool_choice.name === "emit_question_plan") {
          return Promise.resolve(toolResponse("emit_question_plan", ONE));
        }
        writeCalls += 1;
        // The first write never answers; its duplicate answers at once.
        return writeCalls === 1
          ? new Promise(() => {})
          : Promise.resolve(toolResponse("emit_questions", { questions: [written("from the second request")] }));
      });
      const pending = generateQuestionFlowPlanned({ ...base, questionCount: 1 });
      await vi.advanceTimersByTimeAsync(4_900);
      expect(writeCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      const flow = await pending;
      expect(writeCalls).toBe(2);
      expect(flow.questions[0]!.text).toBe("from the second request");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a call that fails fast is not raced: the error surfaces at once", async () => {
    createMessageMock.mockRejectedValue(new Error("400 credit balance too low"));
    await expect(generateQuestionPlan(base)).rejects.toThrow("400 credit balance too low");
    expect(createMessageMock).toHaveBeenCalledTimes(1);
  });

  it("outlines on the plan model and writes on the question model unless a probe overrides them", async () => {
    serve(planDraft(["decides | single_select | - | where they ride"]));
    await generateQuestionFlowPlanned({ ...base, questionCount: 1 });
    expect(calls().map((c) => c.model)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);

    createMessageMock.mockClear();
    await generateQuestionFlowPlanned({
      ...base,
      questionCount: 1,
      plannedModels: { plan: "probe-plan-model", write: "probe-write-model" },
    });
    expect(calls().map((c) => c.model)).toEqual(["probe-plan-model", "probe-write-model"]);
  });

  // The prompt cache is per model. With the outline on another model, nothing
  // would write the cache the parallel writes read — every one of them would
  // miss and pay the cache write.
  it("warms the writing model's cache beside the plan, with the writes' own prefix", async () => {
    serve(planDraft(["decides | single_select | - | where they ride"]));
    await generateQuestionFlowPlanned({ ...base, questionCount: 1 });
    expect(warmPromptCacheMock).toHaveBeenCalledTimes(1);
    const warm = warmPromptCacheMock.mock.calls[0]![0] as PlannedCall;
    const write = calls()[1]!;
    expect(warm.model).toBe(write.model);
    expect(warm.system).toEqual(write.system);
    expect(warm.tools).toEqual(write.tools);
    expect(warm.tool_choice).toEqual(write.tool_choice);
  });

  it("skips the warm-up when one model does both steps: the plan call writes the cache", async () => {
    serve(planDraft(["decides | single_select | - | where they ride"]));
    await generateQuestionFlowPlanned({
      ...base,
      questionCount: 1,
      plannedModels: { plan: "one-model", write: "one-model" },
    });
    expect(warmPromptCacheMock).not.toHaveBeenCalled();
  });
});
