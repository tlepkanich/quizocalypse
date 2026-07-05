import { describe, it, expect } from "vitest";

import { moveDecider } from "./quizMutations";
import { Quiz } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

/* quiz-step3 v3 §5.4 — moveDecider: "Moving the decider clears its current
   mappings" (mappings ONLY — decision_rules survive). Minimal decider doc:
   intro → q1(decides, mapped) → q2(qualifier) → result. */
function deciderDoc(): QuizDoc {
  return Quiz.parse({
    quiz_id: "t",
    logic_model: "decider",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Q1",
          question_type: "single_select",
          role: "decides",
          required: true,
          answers: [
            { id: "a1", text: "A", edge_handle_id: "h1", target_id: "cat1" },
            { id: "a2", text: "B", edge_handle_id: "h2", target_id: "cat2" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 2, y: 0 },
        data: {
          text: "Q2",
          question_type: "single_select",
          answers: [
            { id: "b1", text: "C", edge_handle_id: "h3" },
            { id: "b2", text: "D", edge_handle_id: "h4" },
          ],
        },
      },
      {
        id: "qm",
        type: "question",
        position: { x: 3, y: 0 },
        data: {
          text: "Multi",
          question_type: "multi_select",
          answers: [
            { id: "m1", text: "E", edge_handle_id: "h5" },
            { id: "m2", text: "F", edge_handle_id: "h6" },
          ],
        },
      },
      {
        id: "res",
        type: "result",
        position: { x: 4, y: 0 },
        data: { headline: "Done", fallback_collection_id: "col1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "qm" },
      { id: "e4", source: "qm", target: "res" },
    ],
    decision_rules: [
      { id: "r1", conditions: [{ question_id: "q1", answer_id: "a1", op: "is" }], target_id: "cat1" },
    ],
  });
}

const q = (doc: QuizDoc, id: string) => {
  const n = doc.nodes.find((x) => x.id === id);
  if (!n || n.type !== "question") throw new Error(`no question ${id}`);
  return n;
};

describe("moveDecider (quiz-step3 v3 §5.4)", () => {
  it("moves the flag: old decider demotes AND its answers DROP target_id (key absence, not null)", () => {
    const out = moveDecider(deciderDoc(), "q2");
    const oldD = q(out, "q1");
    expect(oldD.data.role).toBe("qualifier");
    for (const a of oldD.data.answers) {
      expect("target_id" in a).toBe(false);
    }
    const newD = q(out, "q2");
    expect(newD.data.role).toBe("decides");
    expect(newD.data.required).toBe(true);
    // The result still re-parses (absent-when-unset sparse discipline).
    expect(() => Quiz.parse(out)).not.toThrow();
  });

  it("decision_rules are referentially UNTOUCHED (spec wipes mappings only)", () => {
    const doc = deciderDoc();
    const out = moveDecider(doc, "q2");
    expect(out.decision_rules).toBe(doc.decision_rules);
  });

  it("first promotion (no current decider) is a pure promote — nothing to wipe", () => {
    const doc = deciderDoc();
    // Demote by hand to simulate a doc with no decider.
    const noDecider: QuizDoc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type === "question" && n.id === "q1"
          ? { ...n, data: { ...n.data, role: "qualifier" as const } }
          : n,
      ),
    };
    const out = moveDecider(noDecider, "q2");
    expect(q(out, "q2").data.role).toBe("decides");
    // q1 keeps its target_ids — it wasn't the decider being moved.
    expect(q(out, "q1").data.answers.every((a) => "target_id" in a)).toBe(true);
  });

  it("REVIEW FIX — promotion wipes STALE target_ids on the new decider (cross-UI resurrection)", () => {
    // A question demoted through the OLD UI (setQuestionRole) keeps its
    // answers' target_id invisibly. Promoting it must NOT resurrect those
    // months-old mappings as live routing — the new decider arrives unmapped.
    const doc = deciderDoc();
    const demotedWithStale: QuizDoc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type === "question" && n.id === "q1"
          ? { ...n, data: { ...n.data, role: "qualifier" as const } } // targets KEPT (the old-UI demote shape)
          : n,
      ),
    };
    const out = moveDecider(demotedWithStale, "q1");
    const promoted = q(out, "q1");
    expect(promoted.data.role).toBe("decides");
    for (const a of promoted.data.answers) {
      expect("target_id" in a).toBe(false); // arrives UNMAPPED — V4 forces a re-pick
    }
    expect(() => Quiz.parse(out)).not.toThrow();
  });

  it("no-ops: multi_select target, same-node, unknown node, legacy doc", () => {
    const doc = deciderDoc();
    expect(moveDecider(doc, "qm")).toBe(doc); // multi cannot decide
    expect(moveDecider(doc, "q1")).toBe(doc); // already the decider
    expect(moveDecider(doc, "nope")).toBe(doc); // unknown
    const { logic_model: _lm, ...legacyRaw } = doc;
    const legacy = legacyRaw as QuizDoc;
    expect(moveDecider(legacy, "q2")).toBe(legacy); // legacy byte-stability
  });

  it("non-decider questions are untouched by the move", () => {
    const doc = deciderDoc();
    const out = moveDecider(doc, "q2");
    expect(q(out, "qm")).toEqual(q(doc, "qm"));
  });
});
