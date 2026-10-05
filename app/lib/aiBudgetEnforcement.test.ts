import type { ActionFunctionArgs } from "@remix-run/node";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import {
  generateRuntimeRecCopy,
  generateWhyCopy,
  reviewPathQuality,
  generateQuizTypes,
  generateQuizTemplates,
  generateQuizDirection,
} from "./claude";
import { action as recCopyAction } from "../routes/q.$id.rec-copy";
import { action as whyCopyAction } from "../routes/api.generate-why-copy";
import { action as pathQualityAction } from "../routes/api.path-quality";
import { startStep2Types, startQuestionBuild } from "./step2Build.server";
import { runAiOnboardingBuild } from "./onboardingBuild.server";
import { getOrStartShopWebResearch, peekFreshShopWebResearch } from "./shopWebResearch.server";
import { buildSeedQuiz } from "./seedQuiz";

// BIC-2 A3 — refusal wiring per endpoint (the publicWriteGuards pattern:
// mocked prisma, real route actions). Over the ceiling → the endpoint's
// native refusal shape and the generator is NEVER called; under → the request
// proceeds past the budget gate to the next real gate.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    category: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    collection: { findMany: vi.fn(), findFirst: vi.fn() },
    shop: { findUnique: vi.fn() },
    aiUsage: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("./studioAccess.server", () => ({
  resolveApiShop: vi.fn().mockResolvedValue({ id: "s1" }),
}));

// The generators must never fire on a refusal; give them loud sentinels.
// setAiUsageEmitter must exist: aiBudget.server.ts installs its emitter into
// the (here mocked) claude module at load.
vi.mock("./claude", () => ({
  QuizGenerationError: class QuizGenerationError extends Error {},
  setAiUsageEmitter: vi.fn(),
  generateRuntimeRecCopy: vi.fn().mockResolvedValue("runtime copy"),
  generateWhyCopy: vi.fn().mockResolvedValue("why copy"),
  reviewPathQuality: vi.fn().mockResolvedValue([]),
  runWebResearchForQuizTypes: vi.fn().mockResolvedValue(""),
  generateQuizTypes: vi.fn().mockResolvedValue([]),
  generateQuizTemplates: vi.fn().mockResolvedValue([]),
  generateQuizDirection: vi.fn(),
}));

// step2Build's web-research cache — cold-cache path must not fire on refusal.
vi.mock("./shopWebResearch.server", () => ({
  peekFreshShopWebResearch: vi.fn().mockResolvedValue(""),
  getOrStartShopWebResearch: vi.fn().mockResolvedValue(""),
}));

// The question build itself is out of scope here.
vi.mock("./onboardingBuild.server", () => ({
  runAiOnboardingBuild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./log.server", () => ({
  reportError: vi.fn(),
  logFor: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock; findUnique: Mock; update: Mock };
  category: { findMany: Mock };
  product: { findMany: Mock };
  collection: { findMany: Mock; findFirst: Mock };
  shop: { findUnique: Mock };
  aiUsage: { upsert: Mock; findUnique: Mock };
};

// $2 runtime / $10 merchant defaults: 1M output tokens ≈ $15 > both.
const OVER_LIMIT_ROW = { inputTokens: 0, outputTokens: 1_000_000 };

function jsonPost(path: string, body: unknown, params: Record<string, string> = {}): ActionFunctionArgs {
  const request = new Request(`https://studio.example/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params, context: {} } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  p.aiUsage.upsert.mockResolvedValue({});
  p.aiUsage.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("q.$id.rec-copy — public runtime ceiling", () => {
  const recCopyArgs = () =>
    jsonPost("q/qz1/rec-copy", { sessionId: "abcdefgh1234", answerIds: [] }, { id: "qz1" });

  beforeEach(() => {
    p.quiz.findFirst.mockResolvedValue({
      shopId: "s1",
      publishedJson: { some: "doc" },
      shop: { aiRecCopyEnabled: true, brandGuidelines: null },
    });
  });

  it("over budget → cheap 200 {ok:false, code:'budget'}, generator never called", async () => {
    p.aiUsage.findUnique.mockResolvedValue(OVER_LIMIT_ROW);
    const res = await recCopyAction(recCopyArgs());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, code: "budget" });
    expect(generateRuntimeRecCopy).not.toHaveBeenCalled();
  });

  it("under budget → proceeds to the NEXT gate (doc validation)", async () => {
    // publishedJson is deliberately invalid: passing the budget gate lands on
    // the schema gate's not_found — proof the budget check allowed it through.
    const res = await recCopyAction(recCopyArgs());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("not_found");
  });

  it("kill switch still wins BEFORE the budget check (no budget read on disabled)", async () => {
    p.quiz.findFirst.mockResolvedValue({
      shopId: "s1",
      publishedJson: { some: "doc" },
      shop: { aiRecCopyEnabled: false, brandGuidelines: null },
    });
    const res = await recCopyAction(recCopyArgs());
    expect(((await res.json()) as { code: string }).code).toBe("disabled");
    expect(p.aiUsage.findUnique).not.toHaveBeenCalled();
  });
});

describe("api.generate-why-copy — merchant ceiling", () => {
  it("over budget → 402 {code:'ai_budget'} with friendly copy, no lookups, no AI", async () => {
    p.aiUsage.findUnique.mockResolvedValue(OVER_LIMIT_ROW);
    const res = await whyCopyAction(jsonPost("api/generate-why-copy", { quizId: "qz1" }));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("ai_budget");
    expect(body.error).toContain("try again tomorrow");
    expect(generateWhyCopy).not.toHaveBeenCalled();
    expect(p.quiz.findFirst).not.toHaveBeenCalled();
  });

  it("under budget → proceeds to the next gate (quiz lookup)", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    const res = await whyCopyAction(jsonPost("api/generate-why-copy", { quizId: "qz1" }));
    expect(res.status).toBe(404); // "Quiz not found" — past the budget gate
  });
});

describe("api.path-quality — merchant ceiling", () => {
  it("over budget → 402 {code:'ai_budget'}, no lookups, no AI", async () => {
    p.aiUsage.findUnique.mockResolvedValue(OVER_LIMIT_ROW);
    const res = await pathQualityAction(jsonPost("api/path-quality", { quizId: "qz1" }));
    expect(res.status).toBe(402);
    expect(((await res.json()) as unknown as { code: string }).code).toBe("ai_budget");
    expect(reviewPathQuality).not.toHaveBeenCalled();
    expect(p.quiz.findFirst).not.toHaveBeenCalled();
  });

  it("under budget → proceeds to the next gate (quiz lookup)", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    const res = await pathQualityAction(jsonPost("api/path-quality", { quizId: "qz1" }));
    expect(res.status).toBe(404);
  });
});

describe("funnel gen jobs — merchant ceiling at kick", () => {
  const BUDGET_COPY = "Today's AI generation limit for this shop is reached — try again tomorrow.";

  function seedDraft() {
    const doc = buildSeedQuiz("Budget test");
    p.quiz.findUnique.mockResolvedValue({ draftJson: doc });
    p.quiz.update.mockResolvedValue({});
  }

  it("startStep2Types over budget → gen_error with the friendly copy, zero AI calls", async () => {
    seedDraft();
    p.aiUsage.findUnique.mockResolvedValue(OVER_LIMIT_ROW);
    startStep2Types("s1", "qz1", { goal: "sell boards" });
    await vi.waitFor(() => expect(p.quiz.update).toHaveBeenCalled());
    const written = (p.quiz.update.mock.calls[0]?.[0] as { data: { draftJson: unknown } }).data
      .draftJson as { build_session?: { gen_error?: string; stage?: string } };
    expect(written.build_session?.gen_error).toBe(BUDGET_COPY);
    expect(written.build_session?.stage).toBe("types");
    expect(generateQuizTypes).not.toHaveBeenCalled();
  });

  it("startStep2Types under budget → the job runs (types generator fires)", async () => {
    seedDraft();
    // The Shape route still WAITS for research on a cache miss (its cards
    // quote it) — only the headless chains are cached-only.
    (peekFreshShopWebResearch as Mock).mockResolvedValueOnce(null);
    startStep2Types("s1", "qz1", { goal: "sell boards" });
    // The job's success path needs catalog context — resolve the mocks enough
    // for generateStep2Types' loadStep2Context.
    p.product.findMany.mockResolvedValue([]);
    p.collection.findMany.mockResolvedValue([]);
    p.category.findMany.mockResolvedValue([]);
    p.shop.findUnique.mockResolvedValue({ brandIdentity: null });
    await vi.waitFor(() => expect(generateQuizTypes).toHaveBeenCalled());
    expect(getOrStartShopWebResearch).toHaveBeenCalledTimes(1);
  });

  // DRAFT-FAST — the headless chain (goal-first / pop-up AI) drafts ONE
  // direction in ONE pass and goes straight to the question build: the two
  // card passes never run, the ceiling is checked once (this job's kick), and
  // the kept type + template land in the same write that leaves "typing".
  it("headless startStep2Types under budget → ONE direction pass, then the question build", async () => {
    seedDraft();
    p.product.findMany.mockResolvedValue([]);
    p.collection.findMany.mockResolvedValue([]);
    p.category.findMany.mockResolvedValue([]);
    p.shop.findUnique.mockResolvedValue({ brandIdentity: null });
    (generateQuizDirection as Mock).mockResolvedValue({
      type: {
        id: "needs-matcher",
        experience_type: "product_match",
        name: "Needs Matcher",
        achieves: "Matches riders to boards.",
        question_range: { min: 5, max: 5 },
        best_practice_note: "",
        rationale: "",
        web_research_excerpt: "",
      },
      template: {
        id: "find-your-board",
        experience_type: "product_match",
        title: "Find Your Board",
        angle: "Starts with where you ride.",
        rationale: "",
        sample_questions: ["Where do you ride?", "How long have you ridden?"],
        feature_notes: ["Opens with terrain"],
        dials: { imagery: "medium", graphics: "medium", word_forward: "medium", lines: "rounded" },
        rec_defaults: { max_products: 3, oos_behavior: "show_with_badge", fallback_collection_id: "" },
        recommended_bucket_ids: [],
        question_count: 5,
      },
    });
    (runAiOnboardingBuild as Mock).mockResolvedValue({ degraded: false });
    // A research cache MISS: the headless chain must not wait for a run.
    (peekFreshShopWebResearch as Mock).mockResolvedValueOnce(null);

    startStep2Types("s1", "qz1", { goal: "sell boards" }, { headless: { questionLength: 5 } });
    await vi.waitFor(() => expect(runAiOnboardingBuild).toHaveBeenCalled());

    expect(getOrStartShopWebResearch).not.toHaveBeenCalled();
    expect((generateQuizDirection as Mock).mock.calls[0]?.[0]).toMatchObject({ webResearchText: "" });

    expect(generateQuizDirection).toHaveBeenCalledTimes(1);
    expect((generateQuizDirection as Mock).mock.calls[0]?.[0]).toMatchObject({
      goalPrompt: "sell boards",
      questionLength: 5,
    });
    expect(generateQuizTypes).not.toHaveBeenCalled();
    expect(generateQuizTemplates).not.toHaveBeenCalled();
    // One ceiling read for the whole chain (the chained build is prechecked).
    expect(p.aiUsage.findUnique).toHaveBeenCalledTimes(1);

    type WrittenSession = {
      stage?: string;
      quiz_types?: Array<{ id: string }>;
      rich_templates?: Array<{ id: string }>;
      picked_template?: { template_id: string; question_count: number };
      picked_type_id?: string;
    };
    const sessions = p.quiz.update.mock.calls
      .map((c) => (c[0] as { data: { draftJson?: { build_session?: WrittenSession } } }).data.draftJson)
      .flatMap((d) => (d?.build_session ? [d.build_session] : []));
    const handoff = sessions.find((s) => s.stage === "templating");
    expect(handoff?.quiz_types?.map((t) => t.id)).toEqual(["needs-matcher"]);
    expect(handoff?.rich_templates?.map((t) => t.id)).toEqual(["find-your-board"]);
    expect(handoff?.picked_template).toMatchObject({ template_id: "find-your-board", question_count: 5 });
    // Cleared on purpose: a killed build retries the question build directly.
    expect(handoff?.picked_type_id).toBeUndefined();
  });

  it("startQuestionBuild (direct kick) over budget → gen_error, build never starts", async () => {
    seedDraft();
    p.aiUsage.findUnique.mockResolvedValue(OVER_LIMIT_ROW);
    const rich = {} as never;
    const picked = {} as never;
    await startQuestionBuild("s1", "qz1", rich, picked, "goal", "");
    await vi.waitFor(() => expect(p.quiz.update).toHaveBeenCalled());
    const written = (p.quiz.update.mock.calls[0]?.[0] as { data: { draftJson: unknown } }).data
      .draftJson as { build_session?: { gen_error?: string } };
    expect(written.build_session?.gen_error).toBe(BUDGET_COPY);
  });
});
