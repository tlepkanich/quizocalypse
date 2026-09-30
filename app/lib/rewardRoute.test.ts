import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { createCodeDiscount } from "./discount.server";
import { action } from "../routes/reward";

// Results handoff §4 defect 4 — /reward had no route tests. It mints REAL
// Shopify discounts, so pin: a completed session is required, a replay never
// re-spends an Admin API create outside the crash window, and a reward with
// no value never mints. Lives in app/lib per the Remix-route-test rule.
vi.mock("../db.server", () => ({
  default: {
    quiz: { findUnique: vi.fn() },
    quizReward: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    quizSession: { findUnique: vi.fn() },
  },
}));
vi.mock("./discount.server", () => ({ createCodeDiscount: vi.fn() }));
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn(async () => ({ admin: {} })) },
}));
vi.mock("./rateLimiters", () => ({ rateLimit: () => ({ ok: true, retryAfterS: 0 }) }));

const db = prisma as unknown as {
  quiz: { findUnique: Mock };
  quizReward: { findUnique: Mock; create: Mock; count: Mock; deleteMany: Mock };
  quizSession: { findUnique: Mock };
};
const create = createCodeDiscount as unknown as Mock;

function quizWithReward(reward: Record<string, unknown>) {
  return {
    id: "q1",
    publishedJson: {
      quiz_id: "q1",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        { id: "end", type: "end", position: { x: 1, y: 0 }, data: { headline: "Bye" } },
      ],
      edges: [],
      engagement: { reward: { enabled: true, emailGated: false, ...reward } },
    },
    shop: { shopDomain: "s.myshopify.com", source: "shopify", engagementDefaults: null },
  };
}

function post(body: unknown) {
  const request = new Request("https://app.example/reward", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: {}, context: {} } as unknown as ActionFunctionArgs);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.quiz.findUnique.mockResolvedValue(quizWithReward({ type: "percentage", value: 10 }));
  db.quizReward.findUnique.mockResolvedValue(null);
  db.quizReward.count.mockResolvedValue(0);
  db.quizReward.create.mockResolvedValue({});
  db.quizSession.findUnique.mockResolvedValue({ completedAt: new Date(), outcomeId: "r1", answerIds: ["a1"] });
  create.mockResolvedValue({ ok: true });
});

describe("/reward", () => {
  it("mints once for a completed session", async () => {
    const res = await post({ quiz_id: "q1", session_id: "sess-1" });
    const body = (await res.json()) as { reward: { code: string; value: number } };
    expect(res.status).toBe(200);
    expect(body.reward.code).toMatch(/^QZR-/);
    expect(body.reward.value).toBe(10);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refuses a session that never completed — no row, no discount", async () => {
    db.quizSession.findUnique.mockResolvedValue(null);
    const res = await post({ quiz_id: "q1", session_id: "made-up" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ reward: null, reason: "session_incomplete" });
    expect(db.quizReward.create).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    db.quizSession.findUnique.mockResolvedValue({ completedAt: null, outcomeId: null, answerIds: [] });
    expect((await post({ quiz_id: "q1", session_id: "started-only" })).status).toBe(409);
    // A bare POST /sessions (no outcome, no answers) does not count.
    db.quizSession.findUnique.mockResolvedValue({ completedAt: new Date(), outcomeId: null, answerIds: [] });
    expect((await post({ quiz_id: "q1", session_id: "forged" })).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an existing reward without another create call once past the crash window", async () => {
    db.quizReward.findUnique.mockResolvedValue({
      code: "QZR-OLD",
      rewardType: "percentage",
      value: 10,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(Date.now() - 3_600_000),
    });
    const body = (await (await post({ quiz_id: "q1", session_id: "sess-1" })).json()) as {
      reward: { code: string };
    };
    expect(body.reward.code).toBe("QZR-OLD");
    expect(create).not.toHaveBeenCalled();
  });

  it("still repairs a row reserved moments ago (the crash window)", async () => {
    db.quizReward.findUnique.mockResolvedValue({
      code: "QZR-NEW",
      rewardType: "percentage",
      value: 10,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(Date.now() - 2 * 60_000),
    });
    await post({ quiz_id: "q1", session_id: "sess-1" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("never repairs a row whose original mint may still be in flight", async () => {
    db.quizReward.findUnique.mockResolvedValue({
      code: "QZR-NOW",
      rewardType: "percentage",
      value: 10,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
    });
    await post({ quiz_id: "q1", session_id: "sess-1" });
    expect(create).not.toHaveBeenCalled();
  });

  it("a mystery range starting at 0 never mints below 1", async () => {
    db.quiz.findUnique.mockResolvedValue(quizWithReward({ type: "percentage", value: 0, rangeMax: 1 }));
    for (let i = 0; i < 20; i++) {
      const body = (await (await post({ quiz_id: "q1", session_id: `s-${i}` })).json()) as { reward: { value: number } };
      expect(body.reward.value).toBeGreaterThanOrEqual(1);
    }
  });

  it("never mints a zero-value code", async () => {
    db.quiz.findUnique.mockResolvedValue(quizWithReward({ type: "percentage" }));
    const res = await post({ quiz_id: "q1", session_id: "sess-1" });
    expect(await res.json()).toEqual({ reward: null, reason: "no_value" });
    expect(create).not.toHaveBeenCalled();
  });
});
