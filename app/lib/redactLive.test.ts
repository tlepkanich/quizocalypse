import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { redactOrders } from "./gdpr.server";

// Live-DB proof of the erasure, run against the LOCAL database only. Mocks can
// agree with a wrong query; this asserts the real Prisma JSON-path filter and
// the real transaction actually erase the right rows and no others.
describe.skipIf(!process.env.REDACT_LIVE)("redactOrders — against the real DB", () => {
  it("erases only the named orders and unconverts only the sessions left bare", async () => {
    const p = new PrismaClient();
    const QUIZ = "cmr7khgd50001vkhscvox8dgt";
    const q = await p.quiz.findUnique({ where: { id: QUIZ }, select: { shop: { select: { shopDomain: true } } } });
    const DOM = q!.shop.shopDomain;
    const SIDS = ["redactA", "redactB"];

    const wipe = async () => {
      await p.event.deleteMany({ where: { quizId: QUIZ, sessionId: { in: SIDS } } });
      await p.quizSession.deleteMany({ where: { quizId: QUIZ, sessionId: { in: SIDS } } });
    };
    await wipe();
    await p.event.createMany({
      data: [
        { quizId: QUIZ, sessionId: "redactA", eventType: "order_attributed", payload: { order_id: "DOOMED-1", total_price: "50.00", currency: "USD" } },
        { quizId: QUIZ, sessionId: "redactB", eventType: "order_attributed", payload: { order_id: "DOOMED-1", total_price: "50.00", currency: "USD" } },
        { quizId: QUIZ, sessionId: "redactB", eventType: "order_attributed", payload: { order_id: "KEEP-9", total_price: "12.00", currency: "USD" } },
        { quizId: QUIZ, sessionId: "redactA", eventType: "quiz_engaged", payload: {} },
      ],
    });
    await p.quizSession.createMany({
      data: SIDS.map((sessionId) => ({ quizId: QUIZ, sessionId, converted: true, answerIds: [], matchedProductIds: [] })),
    });

    const res = await redactOrders(p, DOM, ["DOOMED-1"]);

    const left = await p.event.findMany({
      where: { quizId: QUIZ, sessionId: { in: SIDS } },
      select: { sessionId: true, eventType: true, payload: true },
    });
    const sess = await p.quizSession.findMany({
      where: { quizId: QUIZ, sessionId: { in: SIDS } },
      select: { sessionId: true, converted: true },
    });

    expect(res.orderEvents).toBe(2);            // both DOOMED-1 rows
    expect(res.sessionsUnconverted).toBe(1);    // only redactA
    // KEEP-9 and the unrelated quiz_engaged row survive untouched.
    expect(left.map((e) => `${e.sessionId}/${e.eventType}`).sort()).toEqual([
      "redactA/quiz_engaged",
      "redactB/order_attributed",
    ]);
    expect((left.find((e) => e.eventType === "order_attributed")!.payload as { order_id: string }).order_id).toBe("KEEP-9");
    expect(Object.fromEntries(sess.map((s) => [s.sessionId, s.converted]))).toEqual({
      redactA: false, // its only order was redacted
      redactB: true,  // KEEP-9 still backs it
    });

    await wipe();
    await p.$disconnect();
  }, 30_000);
});
