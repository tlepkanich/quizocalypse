import { describe, expect, it } from "vitest";
import { logicDoc } from "./logicStep.fixtures";
import { appendBankQuestion, setAnswerRoute } from "./quizMutations";
import { orderedQuestions } from "./questionOrder";
import { Quiz } from "./quizSchema";
import { validateQuiz } from "./quizValidation";

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

  it("decider · the last main-path question routes every answer: the new question still has an out-edge (P1-11)", () => {
    const doc = Quiz.parse({
      quiz_id: "x",
      logic_model: "decider",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Pick",
            question_type: "single_select",
            role: "decides",
            required: true,
            answers: [
              { id: "a1", text: "A", tags: [], edge_handle_id: "ha1", target_id: "c1" },
              { id: "a2", text: "B", tags: [], edge_handle_id: "ha2", target_id: "c2" },
            ],
          },
        },
        {
          id: "q2",
          type: "question",
          position: { x: 2, y: 0 },
          data: { text: "Two", question_type: "single_select", required: true, answers: [{ id: "b1", text: "x", tags: [], edge_handle_id: "hb1" }, { id: "b2", text: "x2", tags: [], edge_handle_id: "hb2" }] },
        },
        {
          id: "q3",
          type: "question",
          position: { x: 2, y: 1 },
          data: { text: "Three", question_type: "single_select", required: true, answers: [{ id: "c1x", text: "y", tags: [], edge_handle_id: "hc1" }, { id: "c2x", text: "y2", tags: [], edge_handle_id: "hc2" }] },
        },
        { id: "res", type: "result", position: { x: 3, y: 0 }, data: { headline: "Done", fallback_collection_id: "col1" } },
      ],
      edges: [
        { id: "e0", source: "intro", target: "q1" },
        { id: "e1", source: "q1", source_handle: "ha1", target: "q2" },
        { id: "e2", source: "q1", source_handle: "ha2", target: "q3" },
        { id: "e3", source: "q2", target: "res" },
        { id: "e4", source: "q3", target: "res" },
      ],
    });
    const next = appendBankQuestion(doc, entry);
    const node = added(doc, next);
    expect(next.edges.some((e) => e.source === node.id)).toBe(true);
    expect(validateQuiz(next).filter((i) => i.kind === "dead_end")).toEqual([]);
  });

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
