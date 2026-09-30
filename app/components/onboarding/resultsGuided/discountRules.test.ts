import { describe, expect, it } from "vitest";
import { Quiz } from "../../../lib/quizSchema";
import { resolveDiscount, type GuidedDiscount } from "./state";
import { expiryReadback, readbackRows, saveBlocker, withCodeMode, withOfferType } from "./discountRules";

const base = (): GuidedDiscount =>
  resolveDiscount(
    Quiz.parse({
      quiz_id: "d",
      logic_model: "decider",
      scope: { collection_ids: [] },
      nodes: [
        { id: "i", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        { id: "e", type: "end", position: { x: 1, y: 0 }, data: { headline: "Bye" } },
      ],
      edges: [],
    }),
  );

describe("discount editor rules (results handoff §8)", () => {
  it("defaults to an order discount with a per-shopper code, saveable", () => {
    const d = base();
    expect(d.applies_to).toBe("all");
    expect(d.code_mode).toBe("dynamic");
    expect(saveBlocker(d)).toBeNull();
  });

  it("blocks Save with the first applicable reason, in order", () => {
    expect(saveBlocker({ ...base(), value: 0 })).toBe("A 0% / $0 reward takes nothing off. Give it a value.");
    expect(saveBlocker({ ...base(), value: 120 })).toBe("A percentage cannot go over 100.");
    expect(saveBlocker({ ...base(), code_mode: "static", static_code: " " })).toBe("Type the code shoppers will use.");
    expect(saveBlocker({ ...base(), code_mode: "existing", existing_code: "" })).toBe("Pick the discount you already made.");
    expect(saveBlocker({ ...base(), expiry_mode: "date" })).toBe("Pick the date it expires.");
    const products = withOfferType(base(), "products");
    expect(saveBlocker({ ...products, applies_to: "collections" })).toBe("Pick at least one collection.");
    expect(saveBlocker({ ...products, applies_to: "products" })).toBe("Pick at least one product.");
    expect(saveBlocker({ ...withOfferType(base(), "shipping"), shipping_countries: [] })).toBe("Pick at least one country.");
  });

  it("free shipping needs no value; switching back restores a percentage", () => {
    const ship = withOfferType({ ...base(), value: 0 }, "shipping");
    expect(ship.kind).toBe("free_shipping");
    expect(saveBlocker(ship)).toBeNull();
    expect(withOfferType(ship, "order").kind).toBe("percentage");
  });

  it("a shared or existing code resets 'hours after the quiz' and 'what we recommend'", () => {
    const d = { ...withOfferType(base(), "products"), expiry_mode: "hours" as const };
    expect(d.applies_to).toBe("recommended");
    const shared = withCodeMode(d, "static");
    expect(shared.expiry_mode).toBe("none");
    expect(shared.applies_to).toBe("collections");
  });

  it("reads expiry back as a wall-clock deadline rounded up to the hour", () => {
    const at = new Date(2026, 8, 17, 14, 20);
    expect(expiryReadback({ ...base(), expiry_hours: 24 }, at)).toContain("24h after each shopper finishes, rounded up to the hour");
    expect(expiryReadback({ ...base(), expiry_hours: 24 }, at)).toContain("3:00 PM Friday");
    expect(expiryReadback({ ...base(), expiry_mode: "none" }, at)).toBe("Doesn't expire");
  });

  it("labels the read-back rows and says when a fixed amount is split", () => {
    const d = { ...withOfferType(base(), "products"), kind: "amount" as const, value: 30 };
    const rows = Object.fromEntries(readbackRows(d, { now: new Date() }));
    expect(rows.Discount).toBe("$30 off your match — split across the matching items, not taken off each one");
    expect(rows.Code).toBe("QUIZ-•••••• — a new code per shopper");
    expect(rows.Stacking).toBe("Combines with nothing");
  });
});
