import { describe, expect, it } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import {
  MISSING_ANSWER_TEXT,
  answerMachineText,
  describeRuleConditions,
  describeRuleTokens,
  ruleWhenMachine,
} from "./ruleSummary";

const doc = logicDoc();

describe("describeRuleConditions stays byte-identical (AI prompts read it)", () => {
  it("groups with the rule's own join words", () => {
    const fmt = (c: { question_id: string; answer_id: string; op: string }) =>
      `${c.question_id} ${c.op === "is" ? "is" : "is not"} ${c.answer_id}`;
    const r = rule("r", [["q1", "a1"], ["q1", "a2"], ["q2", "b1", "is_not"]], "c", { any_of: ["q1"] });
    expect(describeRuleConditions(r, fmt)).toBe("q1 is a1 or q1 is a2 and q2 is not b1");
    expect(describeRuleConditions({ ...r, match: "any", any_of: [] }, fmt)).toBe(
      "q1 is a1 and q1 is a2 or q2 is not b1",
    );
  });
});

describe("describeRuleTokens (D17)", () => {
  it("verb-first tokens in question order with joins", () => {
    const r = rule(
      "r",
      [["q3", "m1"], ["q3", "m2"], ["q1", "a2"], ["q1", "a1"], ["q2", "b1", "is_not"], ["q2", "b2", "is_not"]],
      ["c1", "c2"],
      { any_of: ["q1", "q2"], action: "prioritize" },
    );
    const t = describeRuleTokens(r, doc, "attributes");
    expect(t.verb).toBe("pin");
    expect(t.storedAction).toBe("prioritize");
    expect(t.targetIds).toEqual(["c1", "c2"]);
    expect(t.across).toBe("and");
    expect(t.groups.map((g) => [g.questionId, g.qIndex, g.not, g.join])).toEqual([
      ["q1", 1, false, "or"],
      ["q2", 2, true, "or"], // D12: a negated group always joins with "or"
      ["q3", 3, false, "and"], // multi-select all-of
    ]);
    expect(t.groups[0]!.answers.map((a) => a.text)).toEqual(["Dry", "Oily"]); // answer order
  });

  it("effVerb: always show in Rules only; hide/show/absent in Filter", () => {
    const hide = rule("r", [["q1", "a1"]], "c", { action: "hide" });
    expect(describeRuleTokens(hide, doc, "rules").verb).toBe("show");
    expect(describeRuleTokens(hide, doc, "attributes").verb).toBe("hide");
    expect(describeRuleTokens(rule("r", [["q1", "a1"]], "c"), doc, "attributes").verb).toBe("show");
  });

  it("scale answers read Qn = k and never take a question label", () => {
    const t = describeRuleTokens(rule("r", [["q4", "r4"], ["q4", "r5"]], "c", { any_of: ["q4"] }), doc, "rules");
    expect(t.groups[0]!.answers.map((a) => a.text)).toEqual(["Q4 = 4", "Q4 = 5"]);
    expect(t.groups[0]!.qLabel).toBe(false);
  });

  it("qLabel only when the same answer text exists on another question", () => {
    // "Yes" is b3 on q2 AND m3 on q3 (case-insensitive trimmed match).
    expect(describeRuleTokens(rule("r", [["q2", "b3"]], "c"), doc, "rules").groups[0]!.qLabel).toBe(true);
    expect(describeRuleTokens(rule("r", [["q2", "b1"]], "c"), doc, "rules").groups[0]!.qLabel).toBe(false);
  });

  it("missing references render as markers, never dropped", () => {
    const t = describeRuleTokens(rule("r", [["q1", "gone"], ["qx", "zz", "is_not"]], "c"), doc, "rules");
    expect(t.groups).toHaveLength(2);
    expect(t.groups[0]!.answers[0]).toEqual({ answerId: "gone", text: MISSING_ANSWER_TEXT, missing: true });
    expect(t.groups[1]!.qIndex).toBeNull();
  });

  it("a mixed is / is-not question yields two groups, is first", () => {
    const t = describeRuleTokens(rule("r", [["q3", "m3", "is_not"], ["q3", "m1"]], "c"), doc, "attributes");
    expect(t.groups.map((g) => [g.questionId, g.not])).toEqual([["q3", false], ["q3", true]]);
  });

  it("stored match any joins groups with or (D13)", () => {
    const t = describeRuleTokens(rule("r", [["q1", "a1"], ["q2", "b1"]], "c", { match: "any" }), doc, "attributes");
    expect(t.across).toBe("or");
  });
});

describe("ruleWhenMachine (mock whenText) + answerMachineText (ansMach)", () => {
  it("Q1 = X AND (Q2 = A OR Q2 = B), NOT (…) always bracketed", () => {
    const r = rule(
      "r",
      [["q2", "b2", "is_not"], ["q1", "a1"], ["q3", "m1"], ["q3", "m2"]],
      "c",
    );
    expect(ruleWhenMachine(r, doc)).toBe(
      "Q1 = Dry AND NOT (Q2 = Long) AND (Q3 = Cheeks AND Q3 = Nose)",
    );
    const anyOf = rule("r", [["q1", "a1"], ["q1", "a3"]], "c", { any_of: ["q1"] });
    expect(ruleWhenMachine(anyOf, doc)).toBe("(Q1 = Dry OR Q1 = Both)");
  });

  it("(no answers) when empty; OR between groups only for match any; markers", () => {
    expect(ruleWhenMachine(rule("r", [], "c"), doc)).toBe("(no answers)");
    expect(ruleWhenMachine(rule("r", [["q1", "a1"], ["q4", "r2"]], "c", { match: "any" }), doc)).toBe(
      "Q1 = Dry OR Q4 = 2",
    );
    expect(answerMachineText(doc, "q1", "zz")).toBe(`Q1 = ${MISSING_ANSWER_TEXT}`);
    expect(answerMachineText(doc, "qx", "zz")).toBe(`Q? = ${MISSING_ANSWER_TEXT}`);
    expect(answerMachineText(doc, "q2", "b3")).toBe("Q2 = Yes");
  });
});
