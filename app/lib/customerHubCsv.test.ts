import { describe, expect, it } from "vitest";
import { contactsToCsv, type HubContact } from "./customerHub.server";

// ANALYTICS P0 — the contacts export is the one surface that carries full
// email addresses, so its escaping is a security property, not a nicety.

function contact(over: Partial<HubContact> = {}): HubContact {
  return {
    id: "c1",
    email: "amy@example.com",
    firstName: "Amy",
    phone: null,
    capturedAt: "2026-08-01T00:00:00.000Z",
    quizId: "q1",
    quizName: "Skin quiz",
    persona: "Dry",
    session: { persona: "Dry", answerCount: 3, matchedCount: 1, recommended: ["Serum"], converted: false, completed: true },
    backInStock: false,
    segments: ["didnt_buy"],
    ...over,
  };
}

describe("contactsToCsv", () => {
  it("guards formula injection — a shopper-typed =HYPERLINK() stays a literal string", () => {
    const csv = contactsToCsv([contact({ firstName: "=HYPERLINK(\"http://evil\",\"click\")" })], "all");
    const nameCell = csv.split("\n")[1]!;
    expect(nameCell).toContain("'=HYPERLINK");
    expect(nameCell).not.toMatch(/,=HYPERLINK/);
  });

  it("guards the other three formula leaders", () => {
    for (const lead of ["+", "-", "@"]) {
      const csv = contactsToCsv([contact({ firstName: `${lead}cmd` })], "all");
      expect(csv.split("\n")[1]!).toContain(`'${lead}cmd`);
    }
  });

  it("quotes and escapes embedded commas, quotes and newlines", () => {
    const csv = contactsToCsv([contact({ firstName: 'Amy "The, Great"\nSmith' })], "all");
    expect(csv).toContain('"Amy ""The, Great""\nSmith"');
  });

  it("filters by segment membership", () => {
    const rows = [contact({ id: "a", segments: ["didnt_buy"] }), contact({ id: "b", segments: ["purchased"] })];
    expect(contactsToCsv(rows, "all").split("\n")).toHaveLength(3);
    expect(contactsToCsv(rows, "purchased").split("\n")).toHaveLength(2);
  });
});
