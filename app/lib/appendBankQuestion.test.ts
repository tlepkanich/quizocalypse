import { describe, expect, it } from "vitest";
import { logicDoc } from "./logicStep.fixtures";
import { appendBankQuestion, setAnswerRoute } from "./quizMutations";
import { orderedQuestions } from "./questionOrder";
import type { Quiz } from "./quizSchema";

// Handoff "Add a question" · "Where the new question lands": on a decider doc
// the new question lands after the LAST question on the main path (the
// handle-less edges from the intro), whatever per-answer routes exist, and
// every route is kept. Legacy docs keep the straight-through-run anchor.

const entry = { text: "New?", question_type: "single_select" as const, answers: ["Yes", "No"] };
const added = (before: Quiz, after: Quiz) => after.nodes.find((n) => !before.nodes.some((o) => o.id === n.id))!;
const position = (doc: Quiz, id: string) => orderedQuestions(doc).find((q) => q.node.id === id)?.qIndex;

describe("appendBankQuestion — where the new question lands", () => {
  const cases: Array<[string, (d: Quiz) => Quiz]> = [
    ["no routes", (d) => d],
    ["Q4 answer → straight to the results", (d) => setAnswerRoute(d, "q4", "r1", "res")],
    ["Q2 answer → straight to the results", (d) => setAnswerRoute(d, "q2", "b1", "res")],
    ["Q1 answer → Q3", (d) => setAnswerRoute(d, "q1", "a1", "q3")],
  ];
  for (const [name, route] of cases) {
    it(`decider · ${name}: lands last (Q5 of 5) and keeps every route`, () => {
      const doc = route(logicDoc());
      const next = appendBankQuestion(doc, entry);
      const node = added(doc, next);
      expect(position(next, node.id)).toBe(5);
      const handled = (d: Quiz) => d.edges.filter((e) => e.source_handle).map((e) => `${e.source}#${e.source_handle}>${e.target}`);
      expect(handled(next)).toEqual(handled(doc));
      // q4 → new → result on the main path.
      expect(next.edges.some((e) => e.source === "q4" && !e.source_handle && e.target === node.id)).toBe(true);
      expect(next.edges.some((e) => e.source === node.id && e.target === "res")).toBe(true);
    });
  }

  it("legacy · a Q1 route still lands in front of Q1 (unchanged)", () => {
    const doc = setAnswerRoute(logicDoc({ legacy: true }), "q1", "a1", "q3");
    const next = appendBankQuestion(doc, entry);
    expect(position(next, added(doc, next).id)).toBe(1);
  });

  it("Five point carries the 1–5 preset; other callers get no scale_config", () => {
    const doc = logicDoc();
    const five = appendBankQuestion(doc, { ...entry, question_type: "rating", answers: ["1", "2", "3", "4", "5"], scale_config: { min: 1, max: 5 } });
    const n5 = added(doc, five);
    expect(n5.type === "question" && n5.data.scale_config).toEqual({ min: 1, max: 5 });
    const plain = appendBankQuestion(doc, entry);
    const np = added(doc, plain);
    expect(np.type === "question" && "scale_config" in np.data).toBe(false);
  });
});
