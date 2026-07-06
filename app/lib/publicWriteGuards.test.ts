import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { logger } from "./log.server";
import { action as capturesAction } from "../routes/captures";
import { action as sessionsAction, loader as sessionsLoader } from "../routes/sessions";
import { action as eventsAction } from "../routes/events";

// HII-1 — the three storefront write boundaries each guard their Prisma write so
// a DB failure becomes a controlled, logged, CORS+JSON 500 instead of an
// unhandled (un-CORS'd, non-JSON) throw. These tests mock prisma to throw and
// assert the 500 contract, plus a happy-path 202 to lock the no-regression.
// NB: this test lives in app/lib (not app/routes) — Remix's Vite plugin treats
// every app/routes/* file as a ROUTE and would try to bundle a *.test.ts there
// (failing on its server-only db.server import); from here it's just a vitest file.
// vi.mock is hoisted above the imports by vitest, so order here is lint-only.
vi.mock("../db.server", () => ({
  default: {
    quiz: { findUnique: vi.fn(), findMany: vi.fn() },
    emailCapture: { create: vi.fn() },
    quizSession: { upsert: vi.fn(), findUnique: vi.fn() },
    event: { createMany: vi.fn() },
  },
}));

const p = prisma as unknown as {
  quiz: { findUnique: Mock; findMany: Mock };
  emailCapture: { create: Mock };
  quizSession: { upsert: Mock; findUnique: Mock };
  event: { createMany: Mock };
};

function postArgs(path: string, body: unknown): ActionFunctionArgs {
  const request = new Request(`https://shop.example/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: {}, context: {} } as unknown as ActionFunctionArgs;
}

function getArgs(query: string): LoaderFunctionArgs {
  const request = new Request(`https://shop.example/sessions?${query}`, { method: "GET" });
  return { request, params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

const CAPTURE = { quiz_id: "q1", session_id: "sess1", email: "a@b.co" };
// BIC-2 A2(c): the sessions WRITE now floors session_id at 16 chars (the
// runtime mints 36-char UUIDs) — the write fixture uses a realistic id.
const SESSION = { quiz_id: "q1", session_id: "3f2a9c04-77d1-4e2b-9a63-0d5b1c8e4f21" };
const EVENTS = { events: [{ quiz_id: "q1", session_id: "sess1", event_type: "quiz_started" }] };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the quiz exists, so we reach the write.
  p.quiz.findUnique.mockResolvedValue({ id: "q1", shopId: "s1" });
  p.quiz.findMany.mockResolvedValue([{ id: "q1", shopId: "s1" }]);
  // Suppress the intentional reportError JSON line on the failure-path tests
  // (BIC-2 A1 — these routes log through the pino seam now, not console).
  logger.level = "silent";
});

describe("captures.tsx write guard", () => {
  it("202 + {ok:true} on a successful write (happy path unchanged)", async () => {
    p.emailCapture.create.mockResolvedValue({});
    const res = await capturesAction(postArgs("captures", CAPTURE));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    // Pin the write-arg byte-stability: the row shape must be exactly the
    // pre-guard mapping (quizId/shopId from the resolved quiz, the rest from the
    // payload; absent first_name/phone → null). Guards against the try/catch
    // wrap silently altering what gets persisted.
    expect(p.emailCapture.create).toHaveBeenCalledWith({
      data: { quizId: "q1", shopId: "s1", sessionId: "sess1", email: "a@b.co", firstName: null, phone: null },
    });
  });

  it("500 + {error} + CORS when the write throws (no unhandled escape)", async () => {
    p.emailCapture.create.mockRejectedValue(new Error("db down"));
    const res = await capturesAction(postArgs("captures", CAPTURE));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });
});

describe("sessions.tsx write guard", () => {
  it("202 on a successful upsert", async () => {
    p.quizSession.upsert.mockResolvedValue({});
    const res = await sessionsAction(postArgs("sessions", SESSION));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("500 + {error} + CORS when the upsert throws", async () => {
    p.quizSession.upsert.mockRejectedValue(new Error("db down"));
    const res = await sessionsAction(postArgs("sessions", SESSION));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await res.json()) as { error?: string }).error).toBeTruthy();
  });

  // BIC-2 A2(c) — the guessing-resistance floor on NEW writes.
  it("400 + CORS when session_id is shorter than 16 chars, upsert never attempted", async () => {
    const res = await sessionsAction(
      postArgs("sessions", { quiz_id: "q1", session_id: "abcde0123456789" }), // 15 chars
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await res.json()) as { error?: string }).error).toContain("session_id");
    expect(p.quizSession.upsert).not.toHaveBeenCalled();
  });

  it("202 at exactly 16 chars and for a 32-char id (the floor is ≥16, not >16)", async () => {
    p.quizSession.upsert.mockResolvedValue({});
    const sixteen = await sessionsAction(
      postArgs("sessions", { quiz_id: "q1", session_id: "abcdef0123456789" }),
    );
    expect(sixteen.status).toBe(202);
    const thirtyTwo = await sessionsAction(
      postArgs("sessions", { quiz_id: "q1", session_id: "abcdef0123456789abcdef0123456789" }),
    );
    expect(thirtyTwo.status).toBe(202);
  });

  it("GET reads are NOT floored — existing short stored ids keep resolving", async () => {
    p.quizSession.findUnique.mockResolvedValue({
      outcomeId: "o1", answerIds: [], matchedProductIds: [], converted: false, completedAt: new Date(),
    });
    const res = await sessionsLoader(getArgs("quiz_id=q1&session_id=sess1"));
    expect(res.status).toBe(200);
  });
});

describe("events.tsx write guard", () => {
  it("202 on a successful createMany", async () => {
    p.event.createMany.mockResolvedValue({ count: 1 });
    const res = await eventsAction(postArgs("events", EVENTS));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("500 + {error} + CORS when createMany throws", async () => {
    p.event.createMany.mockRejectedValue(new Error("db down"));
    const res = await eventsAction(postArgs("events", EVENTS));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await res.json()) as { error?: string }).error).toBeTruthy();
  });
});

// HII-1b — the quiz/session LOOKUP read runs BEFORE the now-guarded write, so a
// DB-down read would escape as Remix's generic un-CORS'd, non-JSON 500 unless
// it too is guarded. These pin the read-failure → CORS+JSON 500 contract AND
// that the write is never attempted after a failed read.
describe("HII-1b — public read guards", () => {
  it("captures: a quiz-lookup read failure → 500 + CORS + {error}, write never attempted", async () => {
    p.quiz.findUnique.mockRejectedValue(new Error("db down"));
    const res = await capturesAction(postArgs("captures", CAPTURE));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await res.json()) as { error?: string }).error).toBeTruthy();
    expect(p.emailCapture.create).not.toHaveBeenCalled();
  });

  it("sessions action: a quiz-lookup read failure → 500 + CORS, upsert never attempted", async () => {
    p.quiz.findUnique.mockRejectedValue(new Error("db down"));
    const res = await sessionsAction(postArgs("sessions", SESSION));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(p.quizSession.upsert).not.toHaveBeenCalled();
  });

  it("events: a quiz findMany read failure → 500 + CORS, createMany never attempted", async () => {
    p.quiz.findMany.mockRejectedValue(new Error("db down"));
    const res = await eventsAction(postArgs("events", EVENTS));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(p.event.createMany).not.toHaveBeenCalled();
  });

  it("sessions loader (My Results GET): read failure → 500 + CORS + {error}", async () => {
    p.quizSession.findUnique.mockRejectedValue(new Error("db down"));
    const res = await sessionsLoader(getArgs("quiz_id=q1&session_id=sess1"));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await res.json()) as { error?: string }).error).toBeTruthy();
  });

  it("sessions loader: happy 200 (found) + 404 (not found) stay byte-identical", async () => {
    p.quizSession.findUnique.mockResolvedValue({
      outcomeId: "o1", answerIds: [], matchedProductIds: [], converted: false, completedAt: new Date(),
    });
    const ok = await sessionsLoader(getArgs("quiz_id=q1&session_id=sess1"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { ok?: boolean }).ok).toBe(true);
    p.quizSession.findUnique.mockResolvedValue(null);
    const nf = await sessionsLoader(getArgs("quiz_id=q1&session_id=nope"));
    expect(nf.status).toBe(404);
    expect(nf.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await nf.json()) as { error?: string }).error).toBe("not found");
  });
});
