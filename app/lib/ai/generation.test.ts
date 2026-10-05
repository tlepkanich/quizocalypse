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
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, createMessage: createMessageMock };
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
// model as the single call; the wall time is the plan plus the slowest slice.
describe("the planned question build — one plan, then the questions written in parallel", () => {
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
    system: Array<{ text: string; cache_control?: { type: string } }>;
    tools: Array<{ name: string }>;
    tool_choice: { name: string };
    messages: Array<{ content: string }>;
  };
  const planItem = (text: string, role: "decides" | "narrows" | "info", extra: object = {}) => ({
    text,
    question_type: "single_select",
    role,
    ...extra,
  });
  const written = (text: string, extra: object = {}) => ({
    text,
    question_type: "single_select",
    answers: [
      { text: "A", tags: ["carve"] },
      { text: "B", tags: ["park"] },
    ],
    ...extra,
  });
  // Answers each write call from the numbers its task names ("#2 and #3").
  const serve = (plan: object[], write: (n: number) => object = (n) => written(`written ${n}`)) => {
    createMessageMock.mockImplementation(async (params: PlannedCall) => {
      if (params.tool_choice.name === "emit_question_plan") {
        return toolResponse("emit_question_plan", { questions: plan });
      }
      const line = params.messages[0]!.content.split("\n").find((l) => l.startsWith("Write ONLY"))!;
      const numbers = [...line.split(" of this plan")[0]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      return toolResponse("emit_questions", { questions: numbers.map(write) });
    });
  };
  const calls = () => createMessageMock.mock.calls.map((c) => c[0] as PlannedCall);

  it("writes one question per call and merges them in plan order", async () => {
    serve([
      planItem("Where do you ride?", "decides", { section_label: "Your riding" }),
      planItem("How do you tune?", "narrows", { section_label: "Your riding" }),
      planItem("Who is it for?", "info"),
    ]);
    const flow = await generateQuestionFlowPlanned(base);
    expect(createMessageMock).toHaveBeenCalledTimes(4); // 1 plan + 3 writes
    expect(flow.questions.map((q) => q.text)).toEqual(["written 1", "written 2", "written 3"]);
    // Structure (role + chapter) is the plan's, deterministically.
    expect(flow.questions.map((q) => q.role)).toEqual(["decides", "narrows", "info"]);
    expect(flow.questions.map((q) => q.section_label)).toEqual(["Your riding", "Your riding", undefined]);
    expect(flow.welcome_message).toBeUndefined();
    expect(flow.email_gate).toBeUndefined();
  });

  it("every call sends the SAME cached prefix: both tools, the rules, the quiz context", async () => {
    serve([planItem("Where do you ride?", "decides"), planItem("Who is it for?", "info")]);
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
    serve([planItem("Where do you ride?", "decides"), planItem("Who is it for?", "info")]);
    await generateQuestionFlowPlanned(base);
    const tasks = calls().slice(1).map((c) => c.messages[0]!.content);
    const first = tasks.find((t) => t.includes("Write ONLY question #1 of this plan"))!;
    const second = tasks.find((t) => t.includes("Write ONLY question #2 of this plan"))!;
    for (const t of [first, second]) {
      expect(t).toContain("1. [decides · single_select] Where do you ride?");
      expect(t).toContain("2. [info · single_select] Who is it for?");
    }
    expect(first).toContain("#1 is the DECIDING question");
    expect(second).toContain("#2 is an INFO question: its answers carry empty tags [].");
  });

  it("the deciding question's planned answers reach the call that writes it", async () => {
    serve([
      planItem("How does your board feel at speed?", "decides", { answer_outline: ["Locked in", "Loose and playful"] }),
      planItem("Who is it for?", "info"),
    ]);
    await generateQuestionFlowPlanned(base);
    const tasks = calls().slice(1).map((c) => c.messages[0]!.content);
    expect(tasks.find((t) => t.includes("question #1 of"))).toContain(
      "Its planned answers, to refine: Locked in | Loose and playful.",
    );
    expect(tasks.find((t) => t.includes("question #2 of"))).not.toContain("Its planned answers");
  });

  it("only the questions the plan marked keep a helper line or the explainer card", async () => {
    serve(
      [
        planItem("Where do you ride?", "decides", { needs_helper: true }),
        planItem("Which base?", "narrows", { needs_explainer: true }),
        planItem("Who is it for?", "info"),
      ],
      (n) => written(`written ${n}`, { helper_text: `helper ${n}`, education_card_before: `card ${n}` }),
    );
    const flow = await generateQuestionFlowPlanned(base);
    expect(flow.questions.map((q) => q.helper_text)).toEqual(["helper 1", undefined, undefined]);
    expect(flow.questions.map((q) => q.education_card_before)).toEqual([undefined, "card 2", undefined]);
    const tasks = calls().slice(1).map((c) => c.messages[0]!.content);
    expect(tasks.find((t) => t.includes("question #2 of"))).toContain("#2 needs a concept explained first");
    expect(tasks.find((t) => t.includes("question #3 of"))).toContain("#3 gets no helper_text.");
  });

  it("a long plan is cut into at most 8 slices of consecutive questions", async () => {
    serve(Array.from({ length: 10 }, (_, i) => planItem(`q${i + 1}`, i === 0 ? "decides" : "info")));
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
    serve([planItem("Where do you ride? 🏂", "decides")], () => ({
      text: "Where do you ride? 🏂",
      question_type: "single_select",
      answers: [
        { text: "Groomers — fast and smooth", tags: ["carve"] },
        { text: "Park ✨", tags: ["park"] },
      ],
    }));
    const flow = await generateQuestionFlowPlanned({ ...base, questionCount: 1 });
    expect(flow.questions[0]!.text).toBe("Where do you ride?");
    expect(flow.questions[0]!.answers.map((a) => a.text)).toEqual(["Groomers, fast and smooth", "Park"]);
  });

  it("a pinned count that misses retries the plan, then trims an overshoot (never the decider)", async () => {
    const over = [planItem("n1", "narrows"), planItem("i1", "info"), planItem("d", "decides")];
    createMessageMock.mockResolvedValue(toolResponse("emit_question_plan", { questions: over }));
    const plan = await generateQuestionPlan({ ...base, questionCount: 2, exactQuestionCount: 2 });
    expect(createMessageMock).toHaveBeenCalledTimes(3);
    expect(plan.map((q) => q.text)).toEqual(["n1", "d"]);
    const retry = createMessageMock.mock.calls[1]![0] as PlannedCall;
    expect(retry.messages[0]!.content).toContain("Expected exactly 2 questions, got 3");
    expect(retry.system[1]!.text).toContain("EXACTLY 2 questions");
  });

  it("a slice that returns the wrong count retries; one that keeps failing fails the build", async () => {
    let writes = 0;
    createMessageMock.mockImplementation(async (params: PlannedCall) => {
      if (params.tool_choice.name === "emit_question_plan") {
        return toolResponse("emit_question_plan", { questions: [planItem("d", "decides")] });
      }
      writes += 1;
      return toolResponse("emit_questions", {
        questions: writes === 1 ? [written("a"), written("b")] : [written("only")],
      });
    });
    const flow = await generateQuestionFlowPlanned({ ...base, questionCount: 1 });
    expect(writes).toBe(2);
    expect(flow.questions.map((q) => q.text)).toEqual(["only"]);

    createMessageMock.mockImplementation(async (params: PlannedCall) =>
      params.tool_choice.name === "emit_question_plan"
        ? toolResponse("emit_question_plan", { questions: [planItem("d", "decides")] })
        : toolResponse("emit_questions", { questions: [{ text: "", question_type: "single_select", answers: [] }] }),
    );
    await expect(generateQuestionFlowPlanned({ ...base, questionCount: 1 })).rejects.toThrow(
      "Planned question write failed validation after retries.",
    );
  });
});
