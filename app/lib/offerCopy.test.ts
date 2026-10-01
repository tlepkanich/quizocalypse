import { describe, expect, it } from "vitest";
import { DiscountConfig } from "./quizSchema";
import { cardCut, offerCodeDisplay, offerLine } from "./offerCopy";

const d = (over: Record<string, unknown>) => DiscountConfig.parse({ enabled: true, ...over });

describe("offerCopy (results handoff §8)", () => {
  it("names the noun from the scope and carries the redeem terms", () => {
    expect(offerLine(d({ kind: "amount", value: 10, minimum_subtotal: 50, expiry_mode: "hours", expiry_hours: 24 }))).toBe(
      "$10 off your order · orders $50+ · expires in 24h",
    );
    expect(offerLine(d({ kind: "percentage", value: 10, applies_to: "recommended" }))).toBe("10% off your match");
    expect(offerLine(d({ kind: "percentage", value: 10, applies_to: "collections" }), "Best sellers")).toBe(
      "10% off Best sellers",
    );
    expect(offerLine(d({ kind: "free_shipping", minimum_quantity: 2 }))).toBe("Free shipping · 2+ items");
  });

  it("never shows a real code for per-shopper codes", () => {
    expect(offerCodeDisplay(d({ code: "QUIZ-REAL01" }))).toBe("QUIZ-••••••");
    expect(offerCodeDisplay(d({ code_mode: "static", static_code: "SAVE10" }))).toBe("SAVE10");
    expect(offerCodeDisplay(d({ code_mode: "existing" }))).toBe("your existing code");
  });

  it("strikes card prices only for an unlocked, one-time, recommended-scope product discount", () => {
    const rec = d({ kind: "amount", value: 30, applies_to: "recommended" });
    expect(cardCut(rec, { locked: false, matchingCards: 3 })).toEqual({ kind: "amount", value: 10 });
    expect(cardCut({ ...rec, applies_on_each_item: true }, { locked: false, matchingCards: 3 })).toEqual({ kind: "amount", value: 30 });
    expect(cardCut(rec, { locked: true, matchingCards: 3 })).toBeNull();
    expect(cardCut(d({ kind: "percentage", value: 10 }), { locked: false, matchingCards: 3 })).toBeNull();
  });
});
