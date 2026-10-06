import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_WINDOW_DAYS,
  attributeOrderToSessions,
  sessionStartForAttribution,
  type SessionForAttribution,
} from "./conversionAttribution";

// Hour-based timestamps from a fixed instant (deterministic, no Date.now()).
const t = (h: number) => new Date(Date.UTC(2026, 0, 1) + h * 3_600_000);
const DAY = 24;
const P = (n: number) => `gid://shopify/Product/${n}`;

/** A finished session; `startedAt` defaults to one hour before the finish. */
const sess = (
  id: string,
  products: string[],
  completedH: number,
  startedH: number | null = completedH - 1,
  sessionId = id,
): SessionForAttribution => ({
  id,
  quizId: "q",
  sessionId,
  matchedProductIds: products,
  completedAt: t(completedH),
  startedAt: startedH == null ? null : t(startedH),
});

describe("attributeOrderToSessions", () => {
  it("the window is 14 days", () => {
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(14);
  });

  it("email + product overlap converts the matching session (case-insensitive)", () => {
    const order = { productIds: [P(1)], email: "Buyer@Shop.com", createdAt: t(10) };
    const sessions = [sess("s1", [P(1)], 8, 7, "sid1"), sess("s2", [P(9)], 8, 7, "sid2")];
    const captures = [{ quizId: "q", sessionId: "sid1", email: "buyer@shop.com", capturedAt: t(8) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual(["s1"]);
  });

  it("product overlap converts a no-email session within the window", () => {
    const order = { productIds: [P(5)], email: null, createdAt: t(10) };
    expect(attributeOrderToSessions(order, [sess("s3", [P(5)], 9)], [])).toEqual(["s3"]);
  });

  it("an order 13 days after the START is attributed; 15 days after is not", () => {
    const start = 0;
    const session = [sess("s4", [P(5)], start + 1, start)];
    const inside = { productIds: [P(5)], email: null, createdAt: t(start + 13 * DAY) };
    const outside = { productIds: [P(5)], email: null, createdAt: t(start + 15 * DAY) };
    expect(attributeOrderToSessions(inside, session, [])).toEqual(["s4"]);
    expect(attributeOrderToSessions(outside, session, [])).toEqual([]);
  });

  it("measures from the start, not the finish: a recent finish cannot rescue an old start", () => {
    // Started 15 days before the order, finished 1 day before it.
    const order = { productIds: [P(5)], email: null, createdAt: t(15 * DAY) };
    expect(attributeOrderToSessions(order, [sess("s5", [P(5)], 14 * DAY, 0)], [])).toEqual([]);
  });

  it("the email path uses the session's start too, not the capture time", () => {
    // Started 15 days before the order; the email was left 1 day before it.
    const order = { productIds: [P(1)], email: "b@b.com", createdAt: t(15 * DAY) };
    const sessions = [sess("s6", [P(1)], 1, 0, "x")];
    const captures = [{ quizId: "q", sessionId: "x", email: "b@b.com", capturedAt: t(14 * DAY) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual([]);
  });

  it("a session with no engage event is measured from its finish", () => {
    const noStart = sess("s7", [P(5)], 5, null);
    expect(sessionStartForAttribution(noStart)).toEqual(t(5));
    const order = { productIds: [P(5)], email: null, createdAt: t(5 + 13 * DAY) };
    expect(attributeOrderToSessions(order, [noStart], [])).toEqual(["s7"]);
  });

  it("does not convert without product overlap, even on an email match", () => {
    const order = { productIds: [P(2)], email: "b@b.com", createdAt: t(10) };
    const sessions = [sess("s8", [P(3)], 8, 7, "x")];
    const captures = [{ quizId: "q", sessionId: "x", email: "b@b.com", capturedAt: t(8) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual([]);
  });

  it("ignores a session that finished after the order (no recommendation existed yet)", () => {
    const order = { productIds: [P(1)], email: "b@b.com", createdAt: t(10) };
    const sessions = [sess("s9", [P(1)], 12, 9, "x")];
    const captures = [{ quizId: "q", sessionId: "x", email: "b@b.com", capturedAt: t(12) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual([]);
  });

  it("returns [] for an empty order and never lists a session twice", () => {
    expect(
      attributeOrderToSessions({ productIds: [], email: "b@b.com", createdAt: t(10) }, [], []),
    ).toEqual([]);

    const order = { productIds: [P(1)], email: "b@b.com", createdAt: t(10) };
    const sessions = [sess("s1", [P(1)], 8, 7, "sid1")];
    const captures = [
      { quizId: "q", sessionId: "sid1", email: "b@b.com", capturedAt: t(8) },
      { quizId: "q", sessionId: "sid1", email: "b@b.com", capturedAt: t(9) },
    ];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual(["s1"]);
  });
});
