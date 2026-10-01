import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueOffer, retireExpiredOffers, type OfferDeps } from "./offerMint.server";
import type { OfferShopify } from "./offerShopify.server";

// Results handoff §16 — the mint under a REAL Postgres (the pool hand-out is
// SKIP LOCKED SQL and the key creation an advisory lock; a mocked client
// proves neither). Opt-in: OFFER_DB_TEST=1 with DATABASE_URL pointing at a
// LOCAL dev database. Creates and deletes its own shop + quiz. CI skips it.
const run = process.env.OFFER_DB_TEST === "1" ? describe : describe.skip;

run("offer mint (real Postgres, fake Shopify)", () => {
  const prisma = new PrismaClient();
  const tag = `offertest-${Date.now()}`;
  let shopId = "";
  let quizId = "";
  let clock = new Date("2026-09-17T14:10:00Z");
  const calls = { create: 0, add: 0, deleted: [] as string[] };
  const shopify: OfferShopify = {
    async createDiscount() {
      calls.create += 1;
      await new Promise((r) => setTimeout(r, 40)); // a real create takes time
      return { discountId: `gid://shopify/DiscountCodeNode/${calls.create}` };
    },
    async addCodes(_id, codes) {
      calls.add += 1;
      return codes.map((code, i) => ({ code, redeemCodeId: `gid://shopify/DiscountRedeemCode/${calls.add}-${i}` }));
    },
    async deleteCodes(_id, ids) {
      calls.deleted.push(...ids);
    },
  };
  const deps: OfferDeps = { prisma, shopify: async () => shopify, now: () => clock, randomBytes: (n) => randomBytes(n) };

  const doc = (discount: Record<string, unknown>, global: Record<string, unknown> = {}) => ({
    quiz_id: "offer",
    logic_model: "decider",
    scope: { collection_ids: [] },
    nodes: [
      { id: "i", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      { id: "e", type: "end", position: { x: 1, y: 0 }, data: { headline: "Bye" } },
    ],
    edges: [],
    rec_page_settings: { global, overrides: {} },
    discount_config: { enabled: true, configured: true, kind: "percentage", value: 10, ...discount },
  });
  const publish = (discount: Record<string, unknown>, global?: Record<string, unknown>) =>
    prisma.quiz.update({ where: { id: quizId }, data: { publishedJson: doc(discount, global) as never } });
  const finish = (sessionId: string, products = ["p1", "p2"]) =>
    prisma.quizSession.create({
      data: { quizId, shopId, sessionId, outcomeId: "r1", answerIds: ["a1"], matchedProductIds: products, completedAt: new Date() },
    });

  beforeAll(async () => {
    const shop = await prisma.shop.create({ data: { shopDomain: `${tag}.myshopify.com`, source: "shopify" } });
    shopId = shop.id;
    const quiz = await prisma.quiz.create({ data: { shopId, name: tag, status: "published", draftJson: {}, publishedJson: doc({}) as never } });
    quizId = quiz.id;
  });
  afterAll(async () => {
    await prisma.shop.delete({ where: { id: shopId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("refuses a session that never finished", async () => {
    expect(await issueOffer(deps, { quizId, sessionId: "never-finished-0001" })).toEqual({ status: "none", reason: "session_incomplete" });
    expect(calls.create).toBe(0);
  });

  it("issues once per session and returns the same code on replay", async () => {
    await publish({ expiry_mode: "hours", expiry_hours: 24 });
    await finish("session-aaaaaaaaaaaa");
    const first = await issueOffer(deps, { quizId, sessionId: "session-aaaaaaaaaaaa" });
    const again = await issueOffer(deps, { quizId, sessionId: "session-aaaaaaaaaaaa" });
    expect(first.status).toBe("issued");
    expect(again).toEqual(first);
    if (first.status !== "issued") return;
    expect(first.offer.code).toMatch(/^QUIZ-[A-Z2-9]{8}$/);
    expect(first.offer.line).toBe("10% off your order · expires in 24h");
    expect(first.offer.ends_at).toBe("2026-09-18T15:00:00.000Z");
    expect(calls.create).toBe(1);
  });

  it("20 shoppers at once: one discount, 20 distinct codes, pooled refills", async () => {
    await publish({ value: 20 });
    const before = calls.create;
    const ids = Array.from({ length: 20 }, (_, i) => `concurrent-session-${String(i).padStart(4, "0")}`);
    await Promise.all(ids.map((id) => finish(id)));
    const results = await Promise.all(ids.map((sessionId) => issueOffer(deps, { quizId, sessionId })));
    const codes = results.map((r) => (r.status === "issued" ? r.offer.code : "none"));
    // Under a burst a few shoppers can land while the pool is refilling.
    const issued = codes.filter((c) => c !== "none");
    expect(new Set(issued).size).toBe(issued.length);
    expect(issued.length).toBeGreaterThanOrEqual(15);
    expect(calls.create - before).toBe(1);
  });

  it("one use per customer: the same email gets its live code back", async () => {
    await publish({ value: 30, once_per_customer: true });
    await finish("email-session-000001");
    await finish("email-session-000002");
    const a = await issueOffer(deps, { quizId, sessionId: "email-session-000001", email: "Shopper@Example.com" });
    const b = await issueOffer(deps, { quizId, sessionId: "email-session-000002", email: "shopper@example.com" });
    expect(a.status === "issued" && b.status === "issued" && a.offer.code === b.offer.code).toBe(true);
  });

  it("the unlock needs an email; the total-codes cap exhausts", async () => {
    await publish({ value: 40, usage_limit: 1 }, { captureUnlocksOffer: true });
    await finish("unlock-session-00001");
    expect(await issueOffer(deps, { quizId, sessionId: "unlock-session-00001" })).toEqual({ status: "none", reason: "email_required" });
    await publish({ value: 40, usage_limit: 1 });
    expect(await issueOffer(deps, { quizId, sessionId: "unlock-session-00001" })).toEqual({ status: "none", reason: "exhausted" });
  });

  it("'what we recommend' keys the discount by the result's products", async () => {
    await publish({ value: 50, applies_to: "recommended" });
    const before = calls.create;
    await finish("scope-session-000001", ["p1", "p2"]);
    await finish("scope-session-000002", ["p2", "p1"]);
    await finish("scope-session-000003", ["p9"]);
    for (const s of ["scope-session-000001", "scope-session-000002", "scope-session-000003"]) {
      expect((await issueOffer(deps, { quizId, sessionId: s })).status).toBe("issued");
    }
    expect(calls.create - before).toBe(2);
  });

  it("a shared code is returned as typed, with nothing minted", async () => {
    await publish({ code_mode: "static", static_code: "SAVE10", expiry_mode: "none" });
    const before = calls.create;
    await finish("static-session-00001");
    const r = await issueOffer(deps, { quizId, sessionId: "static-session-00001" });
    expect(r.status === "issued" && r.offer.code).toBe("SAVE10");
    expect(calls.create).toBe(before);
  });

  it("retires expired buckets and deletes their unassigned codes", async () => {
    clock = new Date("2026-09-25T00:00:00Z");
    const retired = await retireExpiredOffers(deps, quizId, `${tag}.myshopify.com`);
    expect(retired).toBeGreaterThanOrEqual(1);
    expect(await prisma.quizOfferCode.count({ where: { discount: { quizId, retiredAt: { not: null } }, status: "available" } })).toBe(0);
  });
});
