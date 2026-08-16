import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { quizAnalyticsForShop } from "./quizAnalytics.server";

// Live-DB proof of the Bought column against the LOCAL database. Mocks can
// agree with a wrong query; this exercises the real JSON payload round-trip.
describe.skipIf(!process.env.BOUGHT_LIVE)("Bought — against the real DB", () => {
  it("counts one purchase per ORDER, not per event row or per line item", async () => {
    const p = new PrismaClient();
    const QUIZ = "cmr7khgd50001vkhscvox8dgt";
    const q = await p.quiz.findUnique({ where: { id: QUIZ }, select: { shopId: true } });
    const SIDS = ["boughtA", "boughtB"];
    const wipe = () => p.event.deleteMany({ where: { quizId: QUIZ, sessionId: { in: SIDS } } });
    await wipe();
    const P1 = "gid://shopify/Product/1";
    const P2 = "gid://shopify/Product/2";
    await p.event.createMany({
      data: [
        { quizId: QUIZ, sessionId: "boughtA", eventType: "quiz_engaged", payload: {} },
        { quizId: QUIZ, sessionId: "boughtB", eventType: "quiz_engaged", payload: {} },
        { quizId: QUIZ, sessionId: "boughtA", eventType: "quiz_completed", payload: {} },
        { quizId: QUIZ, sessionId: "boughtA", eventType: "recommendation_viewed", payload: { product_ids: [P1, P2] } },
        // ONE order winning BOTH sessions → two rows; P1 duplicated in one of them.
        { quizId: QUIZ, sessionId: "boughtA", eventType: "order_attributed", payload: { order_id: "LIVE-1", total_price: "9.00", currency: "USD", line_item_product_ids: [P1, P1] } },
        { quizId: QUIZ, sessionId: "boughtB", eventType: "order_attributed", payload: { order_id: "LIVE-1", total_price: "9.00", currency: "USD", line_item_product_ids: [P1] } },
      ],
    });

    const data = await quizAnalyticsForShop({ id: q!.shopId }, QUIZ, new URLSearchParams("r=90d"));
    const p1 = data.products.find((x) => x.productId === P1)!;
    const p2 = data.products.find((x) => x.productId === P2)!;
    // eslint-disable-next-line no-console
    console.log(`LIVE bought → P1=${p1.bought} P2=${p2.bought} (revenue orders=${data.kpis.revenue.orders})`);
    expect(p1.bought).toBe(1); // one order, despite two rows and a duplicate id
    expect(p2.bought).toBe(0); // shown, never bought — 0, not null
    expect(data.kpis.revenue.orders).toBe(1); // and revenue agrees

    await wipe();
    await p.$disconnect();
  }, 30_000);
});
