import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { reportError } from "./log.server";
import {
  checkAiBudget,
  estimateSpendUSD,
  recordAiUsage,
  utcDayKey,
  withAiSpendRecording,
} from "./aiBudget.server";
import { emitAiUsage } from "./aiUsageContext.server";

// BIC-2 A3 — the budget math + the two never-break contracts:
//   recordAiUsage NEVER throws (usage tracking must never break a feature);
//   checkAiBudget FAILS OPEN on DB errors (a budget-table hiccup must never
//   take down generation).

vi.mock("../db.server", () => ({
  default: {
    aiUsage: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("./log.server", () => ({
  reportError: vi.fn(),
  logFor: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const p = prisma as unknown as {
  aiUsage: { upsert: Mock; findUnique: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
  p.aiUsage.upsert.mockResolvedValue({});
  p.aiUsage.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("utcDayKey — UTC day boundary", () => {
  it("keys by UTC, not local time (rollover at midnight UTC)", () => {
    expect(utcDayKey(new Date("2026-07-06T23:59:59.999Z"))).toBe("2026-07-06");
    expect(utcDayKey(new Date("2026-07-07T00:00:00.000Z"))).toBe("2026-07-07");
  });
});

describe("estimateSpendUSD — conservative Sonnet-rate math", () => {
  it("prices $3/MTok input + $15/MTok output", () => {
    expect(estimateSpendUSD({ inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(3);
    expect(estimateSpendUSD({ inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(15);
    expect(estimateSpendUSD({ inputTokens: 100_000, outputTokens: 20_000 })).toBeCloseTo(0.6);
    expect(estimateSpendUSD({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe("checkAiBudget — limits, defaults, 0-unlimited, failure posture", () => {
  it("defaults: runtime $2, merchant $10 when envs are unset", async () => {
    vi.stubEnv("AI_BUDGET_RUNTIME_DAILY_USD", "");
    vi.stubEnv("AI_BUDGET_MERCHANT_DAILY_USD", "");
    const runtime = await checkAiBudget("s1", "runtime");
    const merchant = await checkAiBudget("s1", "merchant");
    expect(runtime).toEqual({ allowed: true, spentUSD: 0, limitUSD: 2 });
    expect(merchant).toEqual({ allowed: true, spentUSD: 0, limitUSD: 10 });
  });

  it("env knobs override the defaults", async () => {
    vi.stubEnv("AI_BUDGET_RUNTIME_DAILY_USD", "0.5");
    const check = await checkAiBudget("s1", "runtime");
    expect(check.limitUSD).toBe(0.5);
  });

  it("malformed or negative knobs fall back to the default, never to unlimited", async () => {
    vi.stubEnv("AI_BUDGET_MERCHANT_DAILY_USD", "banana");
    expect((await checkAiBudget("s1", "merchant")).limitUSD).toBe(10);
    vi.stubEnv("AI_BUDGET_MERCHANT_DAILY_USD", "-3");
    expect((await checkAiBudget("s1", "merchant")).limitUSD).toBe(10);
  });

  it("blocks when today's spend reaches the limit", async () => {
    // 200k output tokens at $15/MTok = $3 > the $2 runtime default.
    p.aiUsage.findUnique.mockResolvedValue({ inputTokens: 0, outputTokens: 200_000 });
    const check = await checkAiBudget("s1", "runtime");
    expect(check.allowed).toBe(false);
    expect(check.spentUSD).toBeCloseTo(3);
    expect(p.aiUsage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopId_day: { shopId: "s1", day: utcDayKey() } },
      }),
    );
  });

  it("allows while under the limit (no row = zero spend)", async () => {
    p.aiUsage.findUnique.mockResolvedValue(null);
    expect((await checkAiBudget("s1", "runtime")).allowed).toBe(true);
  });

  it("0 = feature off: always allowed, and the DB is never read", async () => {
    vi.stubEnv("AI_BUDGET_RUNTIME_DAILY_USD", "0");
    const check = await checkAiBudget("s1", "runtime");
    expect(check).toEqual({ allowed: true, spentUSD: 0, limitUSD: 0 });
    expect(p.aiUsage.findUnique).not.toHaveBeenCalled();
  });

  it("FAILS OPEN on a DB error: allowed + reportError, never a throw", async () => {
    p.aiUsage.findUnique.mockRejectedValue(new Error("db down"));
    const check = await checkAiBudget("s1", "merchant");
    expect(check.allowed).toBe(true);
    expect(check.limitUSD).toBe(10);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("FAILS CLOSED for the public runtime when the ledger is unavailable", async () => {
    p.aiUsage.findUnique.mockRejectedValue(new Error("db down"));
    const check = await checkAiBudget("s1", "runtime");
    expect(check.allowed).toBe(false);
    expect(check.limitUSD).toBe(2);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("recordAiUsage — atomic upsert-increment, never-throw", () => {
  it("writes one atomic upsert with increments against today's UTC row", async () => {
    await recordAiUsage("s1", { input_tokens: 120, output_tokens: 45 });
    expect(p.aiUsage.upsert).toHaveBeenCalledTimes(1);
    expect(p.aiUsage.upsert).toHaveBeenCalledWith({
      where: { shopId_day: { shopId: "s1", day: utcDayKey() } },
      create: { shopId: "s1", day: utcDayKey(), inputTokens: 120, outputTokens: 45, calls: 1 },
      update: {
        inputTokens: { increment: 120 },
        outputTokens: { increment: 45 },
        calls: { increment: 1 },
      },
    });
  });

  it("clamps garbage token counts to non-negative integers", async () => {
    await recordAiUsage("s1", { input_tokens: -5, output_tokens: Number.NaN });
    expect(p.aiUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ inputTokens: 0, outputTokens: 0 }),
      }),
    );
  });

  it("NEVER throws on a poisoned prisma — logs and swallows", async () => {
    p.aiUsage.upsert.mockRejectedValue(new Error("db down"));
    await expect(
      recordAiUsage("s1", { input_tokens: 1, output_tokens: 1 }),
    ).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("withAiSpendRecording — the ALS observer seam", () => {
  it("emits inside the scope land as upserts against the wrapped shopId", async () => {
    await withAiSpendRecording("shop-9", async () => {
      emitAiUsage({ input_tokens: 10, output_tokens: 20 });
    });
    await vi.waitFor(() => expect(p.aiUsage.upsert).toHaveBeenCalledTimes(1));
    const call = p.aiUsage.upsert.mock.calls[0]?.[0] as
      | { where: { shopId_day: { shopId: string } } }
      | undefined;
    expect(call?.where.shopId_day.shopId).toBe("shop-9");
  });

  it("emits survive awaits (async context propagation)", async () => {
    await withAiSpendRecording("shop-9", async () => {
      await Promise.resolve();
      emitAiUsage({ input_tokens: 1, output_tokens: 1 });
      await Promise.resolve();
      emitAiUsage({ input_tokens: 2, output_tokens: 2 });
    });
    await vi.waitFor(() => expect(p.aiUsage.upsert).toHaveBeenCalledTimes(2));
  });

  it("emits outside any scope are a no-op", async () => {
    emitAiUsage({ input_tokens: 100, output_tokens: 100 });
    await new Promise((r) => setTimeout(r, 0));
    expect(p.aiUsage.upsert).not.toHaveBeenCalled();
  });

  it("a failing record can't reject the wrapped work (fire-and-forget)", async () => {
    p.aiUsage.upsert.mockRejectedValue(new Error("db down"));
    const result = await withAiSpendRecording("shop-9", async () => {
      emitAiUsage({ input_tokens: 1, output_tokens: 1 });
      return "done";
    });
    expect(result).toBe("done");
  });
});
