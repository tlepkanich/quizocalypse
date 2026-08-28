import { describe, expect, it } from "vitest";
import { buildRuleCoverage } from "./ruleCoverage";

const q1 = { id: "q1", answerIds: ["a1", "a2"] };
const q2 = { id: "q2", answerIds: ["b1", "b2", "b3"] };
const q3 = { id: "q3", answerIds: ["c1"] };

const rule = (...answerIds: string[]) => ({
  conditions: answerIds.map((answer_id) => ({ answer_id })),
});

describe("buildRuleCoverage", () => {
  it("no rules — every question unused, 0 of total answers", () => {
    const cov = buildRuleCoverage([q1, q2, q3], []);
    expect(cov.questions).toEqual([
      { questionId: "q1", ruleIndexes: [] },
      { questionId: "q2", ruleIndexes: [] },
      { questionId: "q3", ruleIndexes: [] },
    ]);
    expect(cov.coveredAnswers).toBe(0);
    expect(cov.totalAnswers).toBe(6);
  });

  it("maps 1-based rule indexes to the questions their conditions read", () => {
    const cov = buildRuleCoverage(
      [q1, q2, q3],
      [rule("a1"), rule("b2"), rule("a2", "b1")],
    );
    expect(cov.questions).toEqual([
      { questionId: "q1", ruleIndexes: [1, 3] },
      { questionId: "q2", ruleIndexes: [2, 3] },
      { questionId: "q3", ruleIndexes: [] },
    ]);
    expect(cov.coveredAnswers).toBe(4); // a1, a2, b1, b2
    expect(cov.totalAnswers).toBe(6);
  });

  it("dedupes a rule per question but still counts each named answer", () => {
    // One rule naming BOTH q1 answers: λ1 appears once on q1's row, yet both
    // answers count as covered.
    const cov = buildRuleCoverage([q1, q2], [rule("a1", "a2")]);
    expect(cov.questions[0]).toEqual({ questionId: "q1", ruleIndexes: [1] });
    expect(cov.coveredAnswers).toBe(2);
  });

  it("counts an answer once across many rules", () => {
    const cov = buildRuleCoverage([q1], [rule("a1"), rule("a1"), rule("a1")]);
    expect(cov.questions[0]).toEqual({ questionId: "q1", ruleIndexes: [1, 2, 3] });
    expect(cov.coveredAnswers).toBe(1);
  });

  it("ignores dangling answer references (deleted answers) — n stays ≤ m", () => {
    const cov = buildRuleCoverage([q1], [rule("ghost"), rule("a1", "ghost2")]);
    expect(cov.questions[0]).toEqual({ questionId: "q1", ruleIndexes: [2] });
    expect(cov.coveredAnswers).toBe(1);
    expect(cov.totalAnswers).toBe(2);
  });

  it("handles a question with no answers", () => {
    const cov = buildRuleCoverage([{ id: "qx", answerIds: [] }], [rule("a1")]);
    expect(cov.questions[0]).toEqual({ questionId: "qx", ruleIndexes: [] });
    expect(cov.coveredAnswers).toBe(0);
    expect(cov.totalAnswers).toBe(0);
  });
});
