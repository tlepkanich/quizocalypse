import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { issueOffer } from "./offerMint.server";
import { action } from "../routes/offer";

// The /offer route's boundary: Zod, the 409 the page retries on, CORS, and a
// thrown mint never leaking as an un-CORS'd 500. The mint itself is covered
// against real Postgres in offerMint.server.test.ts.
vi.mock("../db.server", () => ({ default: { quiz: { findUnique: vi.fn(async () => null) } } }));
vi.mock("../shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));
vi.mock("./rateLimiters", () => ({ rateLimit: () => ({ ok: true, retryAfterS: 0 }) }));
vi.mock("./log.server", () => ({ reportError: vi.fn() }));
vi.mock("./offerMint.server", () => ({ issueOffer: vi.fn(), retireExpiredOffers: vi.fn(async () => 0) }));

const mint = issueOffer as unknown as Mock;
const post = (body: unknown) =>
  action({
    request: new Request("https://app.example/offer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs);
const VALID = { quiz_id: "q1", session_id: "3f2a9c04-77d1-4e2b-9a63-0d5b1c8e4f21" };

beforeEach(() => {
  // Braces matter: a function RETURNED from beforeEach is run as a teardown.
  mint.mockReset();
});

describe("/offer", () => {
  it("rejects a malformed payload before minting", async () => {
    expect((await post({ quiz_id: "q1", session_id: "short" })).status).toBe(400);
    expect((await post({ ...VALID, email: "not-an-email" })).status).toBe(400);
    expect(mint).not.toHaveBeenCalled();
  });

  it("returns the issued offer, CORS-open", async () => {
    const offer = { code: "QUIZ-AAAAAAAA", line: "10% off your order", value: "10% off", kind: "percentage", ends_at: null };
    mint.mockResolvedValue({ status: "issued", offer });
    const res = await post({ ...VALID, email: "a@b.co" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ offer });
    expect(mint).toHaveBeenCalledWith(expect.anything(), { quizId: "q1", sessionId: VALID.session_id, email: "a@b.co" });
  });

  it("answers 409 only for an unfinished session (the page retries it)", async () => {
    mint.mockResolvedValue({ status: "none", reason: "session_incomplete" });
    expect((await post(VALID)).status).toBe(409);
    mint.mockResolvedValue({ status: "none", reason: "email_required" });
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offer: null, reason: "email_required" });
  });

  it("a thrown mint is a controlled 502 with CORS", async () => {
    mint.mockRejectedValue(new Error("shopify down"));
    const res = await post(VALID);
    expect(res.status).toBe(502);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
