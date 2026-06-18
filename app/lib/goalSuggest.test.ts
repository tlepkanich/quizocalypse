import { describe, it, expect } from "vitest";
import { suggestQuizGoal } from "./goalSuggest";

describe("suggestQuizGoal", () => {
  it("matches a skincare store to the skincare goal", () => {
    const goal = suggestQuizGoal({
      identitySummary: "A clean beauty brand selling serums and moisturizers for dry skin.",
      groupNames: ["Serums", "Moisturizers"],
    });
    expect(goal).toContain("skincare routine");
  });

  it("matches a gifting store to the gifting goal", () => {
    const goal = suggestQuizGoal({
      identitySummary: "Curated gift hampers for every occasion and recipient.",
    });
    expect(goal.toLowerCase()).toContain("gift");
  });

  it("matches an apparel store to the clothing goal", () => {
    const goal = suggestQuizGoal({
      identitySummary: "An online fashion label — denim, tees, and footwear for everyday wear.",
    });
    expect(goal.toLowerCase()).toContain("clothing");
  });

  it("falls back to a generic goal tailored to the groups when no vertical matches", () => {
    const goal = suggestQuizGoal({
      identitySummary: "A hardware and outdoor gear shop.",
      groupNames: ["Snowboards", "Bindings", "Boots"],
    });
    expect(goal).toContain("Snowboards, Bindings and Boots");
    expect(goal).toContain("Help shoppers");
  });

  it("falls back to a catalog-wide generic goal when there are no groups", () => {
    const goal = suggestQuizGoal({ identitySummary: null, groupNames: [] });
    expect(goal).toContain("best option in your catalog");
  });

  it("always returns at least the funnel's 24-char minimum", () => {
    for (const input of [
      {},
      { identitySummary: "" },
      { identitySummary: "x", groupNames: [] },
      { groupNames: ["A"] },
    ]) {
      expect(suggestQuizGoal(input).length).toBeGreaterThanOrEqual(24);
    }
  });

  it("caps the generic goal to the first three group names", () => {
    const goal = suggestQuizGoal({
      identitySummary: "misc",
      groupNames: ["One", "Two", "Three", "Four", "Five"],
    });
    expect(goal).toContain("One, Two and Three");
    expect(goal).not.toContain("Four");
  });
});
