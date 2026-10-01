import { describe, expect, it } from "vitest";
import { DiscountConfig } from "./quizSchema";
import { newOfferCode, offerBucket, offerKeyHash, recommendedScope, settingsHash } from "./offerKey.server";

const cfg = (over: Record<string, unknown> = {}) => DiscountConfig.parse({ enabled: true, ...over });

describe("offerKey (results handoff §12.2)", () => {
  it("a shared setting changes the hash; switches and code strings do not", () => {
    const base = settingsHash(cfg());
    expect(settingsHash(cfg({ value: 15 }))).not.toBe(base);
    expect(settingsHash(cfg({ combines: { order: true } }))).not.toBe(base);
    expect(settingsHash(cfg({ enabled: false, configured: true, code: "X", code_prefix: "HI-" }))).toBe(base);
  });

  it("relative expiry buckets by the hour: 24h lasts 24 to 25 hours", () => {
    const c = cfg({ expiry_mode: "hours", expiry_hours: 24 });
    const early = offerBucket(c, new Date("2026-09-17T14:00:01Z"));
    const late = offerBucket(c, new Date("2026-09-17T14:59:59Z"));
    const next = offerBucket(c, new Date("2026-09-17T15:00:00Z"));
    expect(early.endsAt?.toISOString()).toBe("2026-09-18T15:00:00.000Z");
    expect(late).toEqual(early);
    expect(next.label).not.toBe(early.label);
    expect(offerBucket(cfg({ expiry_mode: "none" }), new Date())).toEqual({ endsAt: null, label: "" });
    expect(offerBucket(cfg({ expiry_mode: "date", ends_at: "2026-12-01T23:59:59Z" }), new Date()).endsAt?.toISOString()).toBe(
      "2026-12-01T23:59:59.000Z",
    );
  });

  it("one key per settings + result product set + bucket", () => {
    const c = cfg({ applies_to: "recommended", expiry_mode: "hours", expiry_hours: 24 });
    const b = offerBucket(c, new Date("2026-09-17T14:10:00Z"));
    const a = offerKeyHash(c, b, recommendedScope(c, ["p2", "p1"]));
    expect(offerKeyHash(c, b, recommendedScope(c, ["p1", "p2", "p1"]))).toBe(a);
    expect(offerKeyHash(c, b, recommendedScope(c, ["p1", "p3"]))).not.toBe(a);
    expect(offerKeyHash(c, offerBucket(c, new Date("2026-09-17T15:10:00Z")), recommendedScope(c, ["p1", "p2"]))).not.toBe(a);
    expect(recommendedScope(cfg(), ["p1"])).toBeNull();
  });

  it("codes carry the cleaned prefix and 8 unambiguous characters", () => {
    const code = newOfferCode("quiz-", (n) => new Uint8Array(n).fill(7));
    expect(code).toMatch(/^QUIZ-[A-HJ-NP-Z2-9]{8}$/);
    expect(newOfferCode("bad prefix!", (n) => new Uint8Array(n))).toMatch(/^BADPREFIX[A-Z2-9]{8}$/);
  });
});
