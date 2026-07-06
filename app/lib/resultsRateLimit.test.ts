import type { LoaderFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { loader as resultsLoader } from "../routes/q.$id_.results";

// BIC-2 A2(c) — the /q/:id/results loader throttles session_id guessing at
// 30/min/IP, checked BEFORE any DB read. Lives in app/lib per the
// publicWriteGuards precedent (route-dir test files break the Remix plugin).

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn() },
    quizSession: { findUnique: vi.fn() },
  },
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock };
  quizSession: { findUnique: Mock };
};

function args(ip: string, sessionId = "guess-attempt-0000"): LoaderFunctionArgs {
  const request = new Request(
    `https://shop.example/q/quiz1/results?session_id=${sessionId}`,
    { headers: { "fly-client-ip": ip } },
  );
  return { request, params: { id: "quiz1" }, context: {} } as unknown as LoaderFunctionArgs;
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Unknown quiz → the loader's own soft 404 path; we only care that the
  // limiter fires BEFORE it. Distinct IPs per test isolate the global limiter.
  p.quiz.findFirst.mockResolvedValue(null);
});

describe("results lookup rate limit", () => {
  it("allows 30 lookups/min then 429s with Retry-After, before any DB read", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 30; i++) {
      expect(await statusOf(resultsLoader(args(ip, `guess-${i}-0000000000`)))).toBe(404);
    }
    expect(p.quiz.findFirst).toHaveBeenCalledTimes(30);

    let blocked: Response | null = null;
    try {
      await resultsLoader(args(ip, "guess-31-0000000000"));
    } catch (thrown) {
      blocked = thrown as Response;
    }
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    // The 31st request never reached the database.
    expect(p.quiz.findFirst).toHaveBeenCalledTimes(30);
  });

  it("does not throttle a different IP (per-IP window)", async () => {
    const hot = "203.0.113.8";
    for (let i = 0; i < 31; i++) {
      await statusOf(resultsLoader(args(hot, `x-${i}-000000000000`)));
    }
    // A legitimate shopper on another IP is unaffected.
    expect(await statusOf(resultsLoader(args("203.0.113.9")))).toBe(404);
  });

  it("param guards still run first (missing session_id is a plain 400)", async () => {
    const request = new Request("https://shop.example/q/quiz1/results", {
      headers: { "fly-client-ip": "203.0.113.10" },
    });
    const status = await statusOf(
      resultsLoader({ request, params: { id: "quiz1" }, context: {} } as unknown as LoaderFunctionArgs),
    );
    expect(status).toBe(400);
  });
});
