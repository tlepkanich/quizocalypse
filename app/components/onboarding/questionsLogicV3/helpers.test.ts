import { describe, it, expect } from "vitest";

import { assignSectionColors, sectionColorVars, QUALIFIER_PALETTE } from "./sectionPalette";
import { computeRuleLayout } from "./ruleHomes";
import { computeFitStep, isTitleLong, answersExceedBudget } from "./fitSteps";
import type { DecisionRule } from "../../../lib/quizSchema";

describe("assignSectionColors (§5.3 — fixed order, gold = decider only)", () => {
  const ids = ["q1", "q2", "q3", "q4", "q5"];

  it("decider gets GOLD at any index; qualifiers take the palette in order", () => {
    const m = assignSectionColors(ids, "q4");
    expect(m.get("q4")).toBe("gold");
    // Qualifiers skip the decider slot — the palette pointer never consumes gold.
    expect(m.get("q1")).toBe("green");
    expect(m.get("q2")).toBe("coral");
    expect(m.get("q3")).toBe("blue");
    expect(m.get("q5")).toBe("amber");
  });

  it("moving the decider reassigns: q2 turns gold, its old color flows onward", () => {
    const m = assignSectionColors(ids, "q2");
    expect(m.get("q2")).toBe("gold");
    expect(m.get("q1")).toBe("green");
    expect(m.get("q3")).toBe("coral");
    expect(m.get("q4")).toBe("blue");
    expect(m.get("q5")).toBe("amber");
  });

  it("no decider → all qualifiers, palette order", () => {
    const m = assignSectionColors(ids, null);
    expect([...m.values()]).toEqual(["green", "coral", "blue", "amber", "pink"]);
  });

  it("wraps past the palette length without ever producing gold", () => {
    const many = Array.from({ length: 8 }, (_, i) => `q${i}`);
    const m = assignSectionColors(many, null);
    expect(m.get("q6")).toBe(QUALIFIER_PALETTE[0]);
    expect([...m.values()]).not.toContain("gold");
  });

  it("sectionColorVars maps keys onto the token families", () => {
    expect(sectionColorVars("gold")).toEqual({ color: "var(--qz-gold)", wash: "var(--qz-gold-wash)" });
    expect(sectionColorVars("teal")).toEqual({ color: "var(--qz-pal-teal)", wash: "var(--qz-pal-teal-wash)" });
  });
});

describe("computeRuleLayout (§5.5 — distributed rules)", () => {
  const rule = (id: string, conds: Array<[string, string]>): DecisionRule => ({
    id,
    conditions: conds.map(([q, a]) => ({ question_id: q, answer_id: a, op: "is" as const })),
    target_id: "t1",
  });
  const order = ["q1", "q2", "q3"];

  it("homes a rule at the FLOW-earliest referenced question (even entered out of order)", () => {
    const layout = computeRuleLayout([rule("r1", [["q3", "a3"], ["q1", "a1"]])], order);
    expect(layout.homes.get("r1")).toBe("q1");
    expect(layout.byHome.get("q1")).toEqual([{ ruleId: "r1", no: 1 }]);
  });

  it("R# numbering is priority order, independent of home", () => {
    const layout = computeRuleLayout(
      [rule("first", [["q2", "a2"]]), rule("second", [["q1", "a1"]])],
      order,
    );
    expect(layout.byHome.get("q2")).toEqual([{ ruleId: "first", no: 1 }]);
    expect(layout.byHome.get("q1")).toEqual([{ ruleId: "second", no: 2 }]);
  });

  it("zero-condition and all-broken-ref rules are HOMELESS", () => {
    const layout = computeRuleLayout(
      [rule("empty", []), rule("ghost", [["deleted-q", "a"]])],
      order,
    );
    expect(layout.homeless.map((r) => r.ruleId)).toEqual(["empty", "ghost"]);
    expect(layout.homes.get("ghost")).toBeNull();
  });

  it("broken refs are skipped for homing but a live ref still homes the rule", () => {
    const layout = computeRuleLayout([rule("mixed", [["deleted-q", "ax"], ["q2", "a2"]])], order);
    expect(layout.homes.get("mixed")).toBe("q2");
  });

  it("chips fan out to EVERY referenced answer (incl. broken-ref answer ids), deduped per rule", () => {
    const layout = computeRuleLayout(
      [rule("r1", [["q1", "a1"], ["q2", "a2"]]), rule("r2", [["q2", "a2"]])],
      order,
    );
    expect(layout.chipsByAnswer.get("a1")).toEqual([{ ruleId: "r1", no: 1 }]);
    expect(layout.chipsByAnswer.get("a2")).toEqual([
      { ruleId: "r1", no: 1 },
      { ruleId: "r2", no: 2 },
    ]);
  });
});

describe("fitSteps (§4.2 — deterministic phone-fit)", () => {
  it("steps by answer count at the spec boundaries", () => {
    expect(computeFitStep(1)).toBe("normal");
    expect(computeFitStep(4)).toBe("normal");
    expect(computeFitStep(5)).toBe("compact");
    expect(computeFitStep(6)).toBe("compact");
    expect(computeFitStep(7)).toBe("tight");
    expect(computeFitStep(12)).toBe("tight");
  });

  it("long titles + the >8 warning are independent axes", () => {
    expect(isTitleLong("Short?")).toBe(false);
    expect(isTitleLong("x".repeat(91))).toBe(true);
    expect(answersExceedBudget(8)).toBe(false);
    expect(answersExceedBudget(9)).toBe(true);
  });
});
