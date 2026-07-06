import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import { generateRuntimeRecCopy } from "./claude";
import { action as recCopyAction } from "../routes/q.$id.rec-copy";

// BIC-2 D2 — the q.$id.rec-copy refusal matrix in unit form (live-proven in
// L2-12b, unpinned until now). The endpoint is PUBLIC and every request it
// lets through costs real AI spend, so the contract under test is: every
// refusal path answers cheaply AND the generator is NEVER called on any of
// them. EXTENDS aiBudgetEnforcement.test.ts, which already pins the budget
// gate (over → {code:"budget"}, under → next gate) and kill-switch-before-
// budget ordering — not re-asserted here. Rate limiter + rec-copy cache are
// the REAL modules (both process-local; isolated per test via distinct IPs /
// session ids). Lives in app/lib per the publicWriteGuards precedent.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn() },
    aiUsage: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

// Generator mocked (spend safety is the point); QuizGenerationError kept as a
// real class for the route's instanceof; setAiUsageEmitter must exist because
// aiBudget.server installs its observer into this module at load.
vi.mock("./claude", () => ({
  QuizGenerationError: class QuizGenerationError extends Error {},
  setAiUsageEmitter: vi.fn(),
  generateRuntimeRecCopy: vi.fn().mockResolvedValue("because you said dry skin"),
}));

vi.mock("./log.server", () => ({
  reportError: vi.fn(),
  logFor: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock };
  aiUsage: { findUnique: Mock; upsert: Mock };
};
const generate = generateRuntimeRecCopy as Mock;

// Decider doc: q1 DECIDES (both answers target-mapped). rec_page_settings vary
// per test (whyOn defaults true when absent).
function deciderDoc(patch: Record<string, unknown> = {}) {
  return Quiz.parse({
    quiz_id: "qz1",
    status: "published",
    scope: { collection_ids: [] },
    logic_model: "decider",
    nodes: [
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Terrain?",
          question_type: "single_select",
          role: "decides",
          required: true,
          answers: [
            { id: "a_park", text: "Park", tags: [], edge_handle_id: "h1", target_id: "cat_park" },
            { id: "a_pow", text: "Powder", tags: [], edge_handle_id: "h2", target_id: "cat_pow" },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 1, y: 0 },
        data: { headline: "Match", fallback_collection_id: "c1" },
      },
    ],
    ...patch,
  });
}

function quizRow(doc: unknown, shop: { aiRecCopyEnabled: boolean } = { aiRecCopyEnabled: true }) {
  return { shopId: "s1", publishedJson: doc, shop: { ...shop, brandGuidelines: null } };
}

let ipCounter = 0;

function post(
  body: unknown,
  opts: { ip?: string; raw?: string; method?: string } = {},
): ActionFunctionArgs {
  // A fresh IP per request unless the test is exercising the limiter itself —
  // the limiter is process-global, so shared IPs would couple tests.
  const ip = opts.ip ?? `198.51.100.${++ipCounter}`;
  const request = new Request("https://shop.example/q/qz1/rec-copy", {
    method: opts.method ?? "POST",
    headers: { "content-type": "application/json", "fly-client-ip": ip },
    ...(opts.method === "GET" ? {} : { body: opts.raw ?? JSON.stringify(body) }),
  });
  return { request, params: { id: "qz1" }, context: {} } as unknown as ActionFunctionArgs;
}

// Session ids are also cache-key components (REAL cache) — unique per call.
let sessionCounter = 0;
const freshSession = () => `sess_${++sessionCounter}_0000000000`;

const VALID = () => ({ sessionId: freshSession(), answerIds: ["a_park"] });

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code;
}

beforeEach(() => {
  vi.clearAllMocks();
  generate.mockResolvedValue("because you said dry skin");
  p.aiUsage.findUnique.mockResolvedValue(null); // under budget
  p.aiUsage.upsert.mockResolvedValue({});
  p.quiz.findFirst.mockResolvedValue(quizRow(deciderDoc()));
});

describe("gate sequence — cheap refusals before any spend", () => {
  it("non-POST → 405 {code:'method'}", async () => {
    const res = await recCopyAction(post(null, { method: "GET" }));
    expect(res.status).toBe(405);
    expect(await codeOf(res)).toBe("method");
    expect(generate).not.toHaveBeenCalled();
  });

  it("6th request/min from one IP → 429 + Retry-After, before body parse and before any DB read", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < 5; i++) {
      const res = await recCopyAction(post(VALID(), { ip }));
      expect(res.status).toBe(200); // through the limiter (success path)
    }
    p.quiz.findFirst.mockClear();
    const blocked = await recCopyAction(post(VALID(), { ip }));
    expect(blocked.status).toBe(429);
    expect(await codeOf(blocked)).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(blocked.headers.get("content-type")).toBe("application/json");
    // The blocked request cost nothing: no lookup, no generation.
    expect(p.quiz.findFirst).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(5);
  });

  it("a different IP is unaffected by someone else's window", async () => {
    const hot = "203.0.113.51";
    for (let i = 0; i < 6; i++) await recCopyAction(post(VALID(), { ip: hot }));
    const res = await recCopyAction(post(VALID(), { ip: "203.0.113.52" }));
    expect(res.status).toBe(200);
  });

  it.each([
    ["malformed JSON", { raw: "{nope" }, {}],
    ["sessionId too short", {}, { sessionId: "abc", answerIds: [] }],
    ["sessionId with invalid chars", {}, { sessionId: "bad session id!!", answerIds: [] }],
    ["answerIds not an array", {}, { sessionId: "abcdefgh1234", answerIds: "a_park" }],
    ["answerIds with non-strings", {}, { sessionId: "abcdefgh1234", answerIds: [1, 2] }],
  ])("bad_input (%s) → 400, no DB read, no generation", async (_label, opts, body) => {
    const res = await recCopyAction(post(body, opts));
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("bad_input");
    expect(p.quiz.findFirst).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("unknown / unpublished quiz → 404 {code:'not_found'}", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    const res = await recCopyAction(post(VALID()));
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("not_found");
    expect(generate).not.toHaveBeenCalled();
  });

  it("legacy (non-decider) doc → cheap 200 {code:'not_decider'}", async () => {
    p.quiz.findFirst.mockResolvedValue(quizRow(deciderDoc({ logic_model: undefined })));
    const res = await recCopyAction(post(VALID()));
    expect(res.status).toBe(200);
    expect(await codeOf(res)).toBe("not_decider");
    expect(generate).not.toHaveBeenCalled();
  });

  it("answers that resolve no target → {code:'no_target'} (unknown ids filtered at the injection boundary)", async () => {
    const res = await recCopyAction(
      post({ sessionId: freshSession(), answerIds: ["a_forged_id"] }),
    );
    expect(res.status).toBe(200);
    expect(await codeOf(res)).toBe("no_target");
    expect(generate).not.toHaveBeenCalled();
  });

  it("merchant turned Why copy off → {code:'why_off'}", async () => {
    p.quiz.findFirst.mockResolvedValue(
      quizRow(deciderDoc({ rec_page_settings: { global: { whyOn: false } } })),
    );
    const res = await recCopyAction(post(VALID()));
    expect(await codeOf(res)).toBe("why_off");
    expect(generate).not.toHaveBeenCalled();
  });

  it("merchant locked their approved copy → {code:'locked'} — a per-target override wins over global", async () => {
    p.quiz.findFirst.mockResolvedValue(
      quizRow(
        deciderDoc({
          rec_page_settings: { global: {}, overrides: { cat_park: { whyCopyLocked: true } } },
        }),
      ),
    );
    const res = await recCopyAction(post(VALID()));
    expect(await codeOf(res)).toBe("locked");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("generation path", () => {
  it("success → {ok:true, copy, cached:false} and the generator gets server-derived grounding only", async () => {
    const res = await recCopyAction(post(VALID()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      copy: "because you said dry skin",
      cached: false,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    const input = generate.mock.calls[0]![0] as { answerTexts: string[]; targetName: string };
    // Grounded in the DOC's answer text (never client-sent prose).
    expect(input.answerTexts).toEqual(["Park"]);
    expect(typeof input.targetName).toBe("string");
  });

  it("same session re-POST → served from cache, generator charged ONCE", async () => {
    const body = VALID();
    const first = await recCopyAction(post(body));
    expect(((await first.json()) as { cached: boolean }).cached).toBe(false);
    const second = await recCopyAction(post(body));
    expect(await second.json()).toEqual({
      ok: true,
      copy: "because you said dry skin",
      cached: true,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("credit-depletion error → 402 {code:'ai_credits'}", async () => {
    generate.mockRejectedValue(new Error("Your credit balance is too low to access the API"));
    const res = await recCopyAction(post(VALID()));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ ok: false, code: "ai_credits" });
  });

  it("any other generation error → 502 {code:'ai_error'} (and nothing cached — a retry can regenerate)", async () => {
    const body = VALID();
    generate.mockRejectedValueOnce(new Error("upstream flaked"));
    const failed = await recCopyAction(post(body));
    expect(failed.status).toBe(502);
    expect(await codeOf(failed)).toBe("ai_error");
    // Recovery: the failed attempt didn't poison the cache.
    const retry = await recCopyAction(post(body));
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { cached: boolean }).cached).toBe(false);
  });

  it("DB failure on the quiz lookup → 500 {code:'server_error'}, no generation", async () => {
    p.quiz.findFirst.mockRejectedValue(new Error("db down"));
    const res = await recCopyAction(post(VALID()));
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe("server_error");
    expect(generate).not.toHaveBeenCalled();
  });
});
