import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { action as capturesAction } from "../routes/captures";
import { action as sessionsAction } from "../routes/sessions";
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
    quizSession: { upsert: vi.fn() },
    event: { createMany: vi.fn() },
  },
}));

const p = prisma as unknown as {
  quiz: { findUnique: Mock; findMany: Mock };
  emailCapture: { create: Mock };
  quizSession: { upsert: Mock };
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

const CAPTURE = { quiz_id: "q1", session_id: "sess1", email: "a@b.co" };
const SESSION = { quiz_id: "q1", session_id: "sess1" };
const EVENTS = { events: [{ quiz_id: "q1", session_id: "sess1", event_type: "quiz_started" }] };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the quiz exists, so we reach the write.
  p.quiz.findUnique.mockResolvedValue({ id: "q1", shopId: "s1" });
  p.quiz.findMany.mockResolvedValue([{ id: "q1", shopId: "s1" }]);
  // Suppress the intentional console.error on the failure-path tests.
  vi.spyOn(console, "error").mockImplementation(() => {});
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
