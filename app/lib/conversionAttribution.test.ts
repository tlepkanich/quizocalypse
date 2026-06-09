import { describe, expect, it } from "vitest";
import { attributeOrderToSessions } from "./conversionAttribution";

// Hour-based timestamps on a fixed day (deterministic, no Date.now()).
const t = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
const P = (n: number) => `gid://shopify/Product/${n}`;

describe("attributeOrderToSessions", () => {
  it("email + product overlap converts the matching session (case-insensitive)", () => {
    const order = { productIds: [P(1)], email: "Buyer@Shop.com", createdAt: t(10) };
    const sessions = [
      { id: "s1", quizId: "q", sessionId: "sid1", matchedProductIds: [P(1)], completedAt: t(8) },
      { id: "s2", quizId: "q", sessionId: "sid2", matchedProductIds: [P(9)], completedAt: t(8) },
    ];
    const captures = [{ quizId: "q", sessionId: "sid1", email: "buyer@shop.com", capturedAt: t(8) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual(["s1"]);
  });

  it("product overlap converts a no-email session within the window", () => {
    const order = { productIds: [P(5)], email: null, createdAt: t(10) };
    const sessions = [
      { id: "s3", quizId: "q", sessionId: "x", matchedProductIds: [P(5)], completedAt: t(9) },
    ];
    expect(attributeOrderToSessions(order, sessions, [])).toEqual(["s3"]);
  });

  it("does not convert a session outside the window", () => {
    const order = { productIds: [P(5)], email: null, createdAt: t(100) };
    const sessions = [
      { id: "s4", quizId: "q", sessionId: "x", matchedProductIds: [P(5)], completedAt: t(0) }, // 100h > 72h
    ];
    expect(attributeOrderToSessions(order, sessions, [])).toEqual([]);
  });

  it("does not convert without product overlap, even on an email match", () => {
    const order = { productIds: [P(2)], email: "b@b.com", createdAt: t(10) };
    const sessions = [
      { id: "s5", quizId: "q", sessionId: "x", matchedProductIds: [P(3)], completedAt: t(8) },
    ];
    const captures = [{ quizId: "q", sessionId: "x", email: "b@b.com", capturedAt: t(8) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual([]);
  });

  it("ignores a future completedAt / capturedAt (after the order)", () => {
    const order = { productIds: [P(1)], email: "b@b.com", createdAt: t(10) };
    const sessions = [
      { id: "s6", quizId: "q", sessionId: "x", matchedProductIds: [P(1)], completedAt: t(12) },
    ];
    const captures = [{ quizId: "q", sessionId: "x", email: "b@b.com", capturedAt: t(12) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual([]);
  });

  it("returns [] for an empty order and dedupes overlapping strategies", () => {
    expect(
      attributeOrderToSessions({ productIds: [], email: "b@b.com", createdAt: t(10) }, [], []),
    ).toEqual([]);

    const order = { productIds: [P(1)], email: "b@b.com", createdAt: t(10) };
    const sessions = [
      { id: "s1", quizId: "q", sessionId: "sid1", matchedProductIds: [P(1)], completedAt: t(8) },
    ];
    const captures = [{ quizId: "q", sessionId: "sid1", email: "b@b.com", capturedAt: t(8) }];
    expect(attributeOrderToSessions(order, sessions, captures)).toEqual(["s1"]); // once, not twice
  });
});
