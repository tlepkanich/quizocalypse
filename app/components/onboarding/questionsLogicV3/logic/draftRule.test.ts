import { describe, it, expect } from "vitest";
import type { Quiz as QuizDoc } from "../../../../lib/quizSchema";
import { createRuleWithCondition, createRuleWithConditions } from "./draftRule";

// §5.6 — the pre-scoped draft's one-write materializer.

function deciderDoc(): QuizDoc {
  return {
    quiz_id: "qz1",
    status: "draft",
    scope: { collection_ids: [] },
    logic_model: "decider",
    nodes: [],
    edges: [],
    results_pages: [],
    decision_rules: [
      { id: "rule_existing", conditions: [], target_id: "cat_a" },
    ],
  } as unknown as QuizDoc;
}

const COND = { question_id: "q1", answer_id: "a1", op: "is" as const };

describe("createRuleWithCondition (§5.6 pre-scoped add — one doc write)", () => {
  it("appends exactly ONE rule at the bottom carrying the condition + target", () => {
    const doc = deciderDoc();
    const { doc: next, ruleId } = createRuleWithCondition(doc, COND, "cat_b");
    expect(ruleId).toBeTruthy();
    expect(next.decision_rules).toHaveLength(2);
    const added = next.decision_rules![1]!;
    expect(added.id).toBe(ruleId);
    expect(added.target_id).toBe("cat_b");
    expect(added.conditions).toEqual([COND]);
    // Priority order preserved: existing rule keeps slot 0 untouched.
    expect(next.decision_rules![0]).toBe(doc.decision_rules![0]);
  });

  it("legacy doc (no logic_model) → no-op, null ruleId, SAME doc reference", () => {
    const doc = { ...deciderDoc(), logic_model: undefined } as unknown as QuizDoc;
    const { doc: next, ruleId } = createRuleWithCondition(doc, COND, "cat_b");
    expect(ruleId).toBeNull();
    expect(next).toBe(doc);
  });

  it("empty target → no-op (schema requires min(1))", () => {
    const doc = deciderDoc();
    const { doc: next, ruleId } = createRuleWithCondition(doc, COND, "");
    expect(ruleId).toBeNull();
    expect(next).toBe(doc);
  });

  it("does not mutate the input doc", () => {
    const doc = deciderDoc();
    const snapshot = JSON.stringify(doc);
    createRuleWithCondition(doc, COND, "cat_b");
    expect(JSON.stringify(doc)).toBe(snapshot);
  });
});

describe("createRuleWithConditions (QZY-R9-2 — the path-signature override)", () => {
  const CONDS = [
    { question_id: "q1", answer_id: "a1", op: "is" as const },
    { question_id: "q3", answer_id: "a7", op: "is" as const },
  ];

  it("appends ONE rule carrying the full multi-condition AND signature", () => {
    const doc = deciderDoc();
    const { doc: next, ruleId } = createRuleWithConditions(doc, CONDS, "cat_b");
    expect(ruleId).toBeTruthy();
    expect(next.decision_rules).toHaveLength(2);
    const added = next.decision_rules![1]!;
    expect(added.target_id).toBe("cat_b");
    expect(added.conditions).toEqual(CONDS);
    expect(next.decision_rules![0]).toBe(doc.decision_rules![0]); // priority preserved
  });

  it("legacy doc / empty target → no-op, null ruleId, same reference", () => {
    const legacy = { ...deciderDoc(), logic_model: undefined } as unknown as QuizDoc;
    expect(createRuleWithConditions(legacy, CONDS, "cat_b").ruleId).toBeNull();
    expect(createRuleWithConditions(deciderDoc(), CONDS, "").ruleId).toBeNull();
  });

  it("single-element array matches createRuleWithCondition", () => {
    const doc = deciderDoc();
    const a = createRuleWithConditions(doc, [COND], "cat_b").doc.decision_rules;
    const b = createRuleWithCondition(doc, COND, "cat_b").doc.decision_rules;
    expect(a![1]!.conditions).toEqual(b![1]!.conditions);
  });
});
