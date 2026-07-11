import { describe, it, expect } from "vitest";
import { contactSegments, summarizeSegments, SEGMENTS, type ContactSession } from "./customerSegments";

const sess = (o: Partial<ContactSession>) => ({
  persona: null, answerCount: 3, matchedCount: 4, recommended: [], converted: false, completed: true, ...o,
});

describe("§R-8 customerSegments", () => {
  it("didn't-buy = completed + matched + not converted", () => {
    expect(contactSegments({ session: sess({}), backInStock: false })).toContain("didnt_buy");
  });
  it("abandoned = no completion", () => {
    const s = contactSegments({ session: sess({ completed: false }), backInStock: false });
    expect(s).toContain("abandoned");
    expect(s).not.toContain("didnt_buy");
  });
  it("purchased = converted (and not didn't-buy)", () => {
    const s = contactSegments({ session: sess({ converted: true }), backInStock: false });
    expect(s).toContain("purchased");
    expect(s).not.toContain("didnt_buy");
  });
  it("back-in-stock is independent and can stack", () => {
    const s = contactSegments({ session: sess({}), backInStock: true });
    expect(s).toEqual(expect.arrayContaining(["didnt_buy", "back_in_stock"]));
  });
  it("a contact with no session is only ever back-in-stock (or nothing)", () => {
    expect(contactSegments({ session: null, backInStock: false })).toEqual([]);
    expect(contactSegments({ session: null, backInStock: true })).toEqual(["back_in_stock"]);
  });
  it("summarizeSegments counts every defined key", () => {
    const contacts = [
      { segments: ["didnt_buy", "back_in_stock"] },
      { segments: ["didnt_buy"] },
      { segments: ["abandoned"] },
    ];
    const c = summarizeSegments(contacts);
    expect(c.didnt_buy).toBe(2);
    expect(c.abandoned).toBe(1);
    expect(c.back_in_stock).toBe(1);
    expect(c.purchased).toBe(0);
    expect(Object.keys(c).sort()).toEqual(SEGMENTS.map((s) => s.key).sort());
  });
});
