import { describe, expect, it } from "vitest";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import { deleteImpactCopy } from "./BuilderFlowTab";

// Screen delete confirm (build-tab spec §3, now the Flow tab's strip — QRTZ-H4)
// — the warning names the impact and
// must read as a sentence whichever subset of parts (rules / mappings) exists.

const questionNode = (id: string, mappedCount: number): QuizNode =>
  ({
    id,
    type: "question",
    data: {
      answers: [
        ...Array.from({ length: mappedCount }, (_, i) => ({ id: `${id}-m${i}`, target_id: `t${i}` })),
        { id: `${id}-plain` },
      ],
    },
  }) as unknown as QuizNode;

const docWithRules = (questionIds: string[]): Quiz =>
  ({
    decision_rules: questionIds.map((qid, i) => ({
      id: `r${i}`,
      conditions: [{ question_id: qid, answer_id: "a", op: "is" }],
      target_id: "t",
    })),
  }) as unknown as Quiz;

describe("deleteImpactCopy", () => {
  it("non-question screens get the generic confirm", () => {
    const node = { id: "n1", type: "message", data: {} } as unknown as QuizNode;
    expect(deleteImpactCopy(docWithRules([]), node)).toBe("Delete this screen?");
  });

  it("no rules and no mappings → plain question confirm", () => {
    expect(deleteImpactCopy(docWithRules([]), questionNode("q1", 0))).toBe("Delete this question?");
  });

  it("rules only reads as a sentence (plural + singular)", () => {
    expect(deleteImpactCopy(docWithRules(["q1", "q1"]), questionNode("q1", 0))).toBe(
      "Delete? This question is used in 2 rules.",
    );
    expect(deleteImpactCopy(docWithRules(["q1"]), questionNode("q1", 0))).toBe(
      "Delete? This question is used in 1 rule.",
    );
  });

  it("mappings only reads as a sentence, not glued to 'This question is'", () => {
    expect(deleteImpactCopy(docWithRules([]), questionNode("q1", 3))).toBe(
      "Delete? 3 mappings will be removed.",
    );
    expect(deleteImpactCopy(docWithRules([]), questionNode("q1", 1))).toBe(
      "Delete? 1 mapping will be removed.",
    );
  });

  it("both parts join with the mid-dot", () => {
    expect(deleteImpactCopy(docWithRules(["q1", "q1"]), questionNode("q1", 3))).toBe(
      "Delete? This question is used in 2 rules · 3 mappings will be removed.",
    );
  });

  it("rules on OTHER questions don't count", () => {
    expect(deleteImpactCopy(docWithRules(["q2"]), questionNode("q1", 0))).toBe(
      "Delete this question?",
    );
  });
});
