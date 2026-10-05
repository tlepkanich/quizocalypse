import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type * as ClaudeModule from "./claude";
import prisma from "../db.server";
import {
  generateQuestionFlow,
  generateQuestionPlan,
  writePlannedQuestions,
  QuizGenerationError,
} from "./claude";
import {
  prefetchQuestionPlan,
  runAiOnboardingBuild,
  type OnboardingBuildInput,
} from "./onboardingBuild.server";

// QBUILD-FAST — which question-flow generator a build runs, and what happens
// when the planned one fails. Capture mode throughout: nothing persists, the
// finished doc comes back in the result.

vi.mock("../db.server", () => ({
  default: {
    quiz: { update: vi.fn(), create: vi.fn() },
    category: { findMany: vi.fn() },
    shop: { findUnique: vi.fn() },
  },
}));

vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<typeof ClaudeModule>();
  return {
    ...actual,
    generateQuestionFlow: vi.fn(),
    generateQuestionPlan: vi.fn(),
    writePlannedQuestions: vi.fn(),
  };
});

const warn = vi.hoisted(() => vi.fn());
vi.mock("./log.server", () => ({
  reportError: vi.fn(),
  logFor: () => ({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() }),
}));

const p = prisma as unknown as {
  quiz: { update: Mock };
  category: { findMany: Mock };
};
const single = generateQuestionFlow as Mock;
const plan = generateQuestionPlan as Mock;
// The planned build's result is what its WRITE step returns.
const planned = writePlannedQuestions as Mock;
const PLAN = [
  { text: "Where do you ride?", question_type: "single_select", role: "decides" },
  { text: "Who is it for?", question_type: "single_select", role: "info" },
];

const BUCKETS = [
  { id: "cat_carve", name: "Carvers", tags: ["carve"] },
  { id: "cat_park", name: "Park", tags: ["park"] },
];
const FLOW = {
  questions: [
    {
      text: "Where do you ride?",
      question_type: "single_select" as const,
      role: "decides" as const,
      answers: [
        { text: "Groomers", tags: ["carve"] },
        { text: "Park", tags: ["park"] },
      ],
    },
    {
      text: "Who is it for?",
      question_type: "single_select" as const,
      role: "info" as const,
      answers: [
        { text: "Me", tags: [] },
        { text: "A gift", tags: [] },
      ],
    },
  ],
};

function buildInput(overrides: Partial<OnboardingBuildInput> = {}): OnboardingBuildInput {
  return {
    shopId: "s1",
    quizId: "qz1",
    name: "Find your board",
    goalPrompt: "match riders to boards",
    questionCount: 2,
    tone: "friendly",
    flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
    logicModel: "decider",
    preResolvedBuckets: BUCKETS,
    prefetchedCatalog: {
      products: [],
      collections: [{ collectionId: "col1", title: "All" }] as never,
      shop: null,
    },
    captureDoc: true,
    ...overrides,
  };
}

const questionTexts = (doc: { nodes: Array<{ type: string; data: unknown }> } | undefined) =>
  (doc?.nodes ?? [])
    .filter((n) => n.type === "question")
    .map((n) => (n.data as { text: string }).text);

beforeEach(() => {
  vi.clearAllMocks();
  p.category.findMany.mockResolvedValue([]);
  single.mockResolvedValue(FLOW);
  plan.mockResolvedValue(PLAN);
  planned.mockResolvedValue(FLOW);
});

describe("runAiOnboardingBuild — the question-flow strategy", () => {
  it("a decider build runs the PLANNED generator, with the single call's exact input", async () => {
    const result = await runAiOnboardingBuild(buildInput());
    expect(plan).toHaveBeenCalledTimes(1);
    expect(planned).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
    const flowInput = plan.mock.calls[0]?.[0];
    expect(flowInput).toMatchObject({
      goalPrompt: "match riders to boards",
      questionCount: 2,
      logicModel: "decider",
      buckets: BUCKETS,
    });
    // The write step gets the SAME input object (one cached prefix) + the plan.
    expect(planned.mock.calls[0]?.[0]).toBe(flowInput);
    expect(planned.mock.calls[0]?.[1]).toBe(PLAN);
    expect(result.degraded).toBeUndefined();
    expect(questionTexts(result.doc)).toEqual(["Where do you ride?", "Who is it for?"]);
    // Capture mode: nothing was written.
    expect(p.quiz.update).not.toHaveBeenCalled();
  });

  it("a legacy build ALWAYS runs the single call — even when asked for planned", async () => {
    const result = await runAiOnboardingBuild(
      buildInput({ logicModel: undefined, questionFlow: "planned" }),
    );
    expect(single).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
    expect(planned).not.toHaveBeenCalled();
    expect(result.degraded).toBeUndefined();
  });

  it('questionFlow "single" pins the single call on a decider build', async () => {
    await runAiOnboardingBuild(buildInput({ questionFlow: "single" }));
    expect(single).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
  });

  it("a flow that wants welcome copy keeps the single call (the planned build writes questions only)", async () => {
    await runAiOnboardingBuild(
      buildInput({ flow: { welcome_message: true, email_gate: false, mixed_input_types: false } }),
    );
    expect(single).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
  });

  it("a failed PLAN falls back the same way (the write step never runs)", async () => {
    plan.mockRejectedValue(new QuizGenerationError("plan failed", 3, "questions: required"));
    const result = await runAiOnboardingBuild(buildInput());
    expect(planned).not.toHaveBeenCalled();
    expect(single).toHaveBeenCalledTimes(1);
    expect(result.degraded).toBeUndefined();
  });

  it("a planned VALIDATION failure falls back to the single call and still builds", async () => {
    planned.mockRejectedValue(new QuizGenerationError("slice failed", 3, "answers: too few"));
    const result = await runAiOnboardingBuild(buildInput());
    expect(single).toHaveBeenCalledTimes(1);
    expect(result.degraded).toBeUndefined();
    expect(questionTexts(result.doc)).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ quizId: "qz1", issue: "answers: too few" }),
      "planned question build failed validation — single-call fallback",
    );
  });

  it("a planned API failure degrades at once — no second slow attempt", async () => {
    planned.mockRejectedValue(new Error("400 credit balance too low"));
    const result = await runAiOnboardingBuild(buildInput());
    expect(single).not.toHaveBeenCalled();
    expect(result.doc).toBeUndefined();
    expect(result.degraded).toContain("couldn't write questions");
  });
});

// OVERLAP — the headless chains draft the plan BESIDE the direction pass and
// hand it to the build. The build uses it only while it still describes the
// build; the write step then runs on the plan's own input (its cached prefix)
// with the direction as late guidance.
describe("runAiOnboardingBuild — a prefetched question plan", () => {
  const prefetchedInput = {
    goalPrompt: "match riders to boards",
    experienceType: "product_match" as const,
    questionCount: 0,
    chooseQuestionCount: true,
    catalogSummary: "tags: carve, park",
    buckets: BUCKETS,
    flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
    tone: "friendly" as const,
    logicModel: "decider" as const,
  };
  const prefetchedQuestionPlan = { input: prefetchedInput, plan: PLAN as never };

  it("is written from as-is: no second plan call, the plan's own input, the direction as guidance", async () => {
    const result = await runAiOnboardingBuild(
      buildInput({
        prefetchedQuestionPlan,
        directionAngle: "Start with terrain.",
        dialDirectives: "Design direction (honor where natural):\n- IMAGERY HIGH",
      }),
    );
    expect(plan).not.toHaveBeenCalled();
    expect(planned).toHaveBeenCalledTimes(1);
    expect(planned.mock.calls[0]?.[0]).toBe(prefetchedInput);
    expect(planned.mock.calls[0]?.[1]).toBe(PLAN);
    expect(planned.mock.calls[0]?.[2]).toBe(
      "Quiz direction: Start with terrain.\n\nDesign direction (honor where natural):\n- IMAGERY HIGH",
    );
    expect(result.degraded).toBeUndefined();
    expect(questionTexts(result.doc)).toHaveLength(2);
  });

  it("is discarded when the build's buckets differ (a disabled group, changed routing tags)", async () => {
    await runAiOnboardingBuild(
      buildInput({ prefetchedQuestionPlan, preResolvedBuckets: [BUCKETS[0]!] }),
    );
    expect(plan).toHaveBeenCalledTimes(1); // planned inline, for the build's own buckets
    expect(planned.mock.calls[0]?.[0]).not.toBe(prefetchedInput);
    expect(planned.mock.calls[0]?.[2]).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ sameBuckets: false, sameCount: true }),
      "prefetched question plan no longer matches the build — planning inline",
    );
  });

  it("is discarded when the pinned count differs", async () => {
    await runAiOnboardingBuild(
      buildInput({ prefetchedQuestionPlan, questionCount: 4, questionCountExact: true }),
    );
    expect(plan).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ sameBuckets: true, sameCount: false }),
      expect.any(String),
    );
  });

  it("is ignored by a build that does not plan (legacy, single)", async () => {
    await runAiOnboardingBuild(buildInput({ prefetchedQuestionPlan, questionFlow: "single" }));
    expect(single).toHaveBeenCalledTimes(1);
    expect(planned).not.toHaveBeenCalled();
  });
});

describe("prefetchQuestionPlan — the plan, drafted before the direction exists", () => {
  const args = {
    shopId: "s1",
    quizId: "qz1",
    goalPrompt: "match riders to boards",
    buckets: BUCKETS,
    catalog: Promise.resolve({
      products: [],
      collections: [{ collectionId: "col1", title: "All" }] as never,
      shop: null,
    }),
  };

  it("plans from the goal + buckets and lets the plan pick the count", async () => {
    const result = await prefetchQuestionPlan(args);
    expect(result?.plan).toBe(PLAN);
    expect(plan.mock.calls[0]?.[0]).toBe(result?.input);
    expect(result?.input).toMatchObject({
      goalPrompt: "match riders to boards",
      buckets: BUCKETS,
      logicModel: "decider",
      chooseQuestionCount: true,
    });
    expect(result?.input.exactQuestionCount).toBeUndefined();
  });

  it("a pinned length is planned for exactly", async () => {
    const result = await prefetchQuestionPlan({ ...args, questionLength: 5 });
    expect(result?.input).toMatchObject({ questionCount: 5, exactQuestionCount: 5 });
    expect(result?.input.chooseQuestionCount).toBeUndefined();
  });

  it("NEVER rejects: a failed plan resolves undefined (the build plans inline)", async () => {
    plan.mockRejectedValue(new Error("400 credit balance too low"));
    await expect(prefetchQuestionPlan(args)).resolves.toBeUndefined();
    plan.mockRejectedValue(new QuizGenerationError("plan failed", 3));
    await expect(prefetchQuestionPlan(args)).resolves.toBeUndefined();
  });
});

