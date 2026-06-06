import { describe, it, expect } from "vitest";
import { orderFlow } from "../../../lib/flowOrder";
import { resultPageFlowContext } from "./resultFlowContext";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";

// Minimal fixture builders — the helper only reads node type/data + edges, so we
// construct lean objects and cast (avoids hand-writing every required field of a
// full valid Quiz). orderFlow consumes the same shapes.
/* eslint-disable @typescript-eslint/no-explicit-any */
const intro = (id = "intro"): any => ({ id, type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } });
const ans = (id: string, text: string, tags: string[] = []): any => ({
  id,
  text,
  tags,
  edge_handle_id: `h_${id}`,
});
const question = (id: string, text: string, answers: any[]): any => ({
  id,
  type: "question",
  position: { x: 0, y: 0 },
  data: { text, question_type: "single_select", answers },
});
const result = (id: string, headline: string): any => ({
  id,
  type: "result",
  position: { x: 0, y: 0 },
  data: { headline, fallback_collection_id: "c1", match_ladder: ["tag"] },
});
const branch = (id: string, label: string, mode: "rules" | "ab_split", slots: any[]): any => ({
  id,
  type: "branch",
  position: { x: 0, y: 0 },
  data: { label, mode, slots },
});
const message = (id: string): any => ({ id, type: "message", position: { x: 0, y: 0 }, data: { text: "m" } });
const edge = (id: string, source: string, target: string, source_handle?: string, condition?: any): any => ({
  id,
  source,
  target,
  ...(source_handle ? { source_handle } : {}),
  ...(condition ? { condition } : {}),
});
const makeDoc = (nodes: any[], edges: any[]): QuizDoc => ({ nodes, edges }) as unknown as QuizDoc;
const ctxFor = (doc: QuizDoc) => resultPageFlowContext(doc, orderFlow(doc));
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("resultPageFlowContext", () => {
  it("linear: a result reached straight from a question has a linear (no-answer) source", () => {
    const doc = makeDoc(
      [intro(), question("q1", "Skin?", [ans("a1", "Dry", ["dry"]), ans("a2", "Oily", ["oily"])]), result("r1", "Result")],
      [edge("e1", "intro", "q1"), edge("e2", "q1", "r1")],
    );
    const c = ctxFor(doc).get("r1")!;
    expect(c.reachable).toBe(true);
    expect(c.abVariant).toBeUndefined();
    expect(c.reachedFrom).toHaveLength(1);
    expect(c.reachedFrom[0]).toMatchObject({ questionLabel: "Skin?", answerLabels: [], kind: "linear" });
  });

  it("rules branch with a tag condition maps the page back to tagged answers", () => {
    const doc = makeDoc(
      [
        intro(),
        question("q1", "Skin?", [ans("a_dry", "Dry skin", ["dry"]), ans("a_oily", "Oily skin", ["oily"])]),
        branch("br", "Skin router", "rules", [
          { id: "s_dry", label: "Dry path", weight: 1 },
          { id: "s_oily", label: "Oily path", weight: 1 },
          { id: "s_def", label: "Everyone else", weight: 1 },
        ]),
        result("r_dry", "For dry skin"),
        result("r_oily", "For oily skin"),
        result("r_def", "Default"),
      ],
      [
        edge("e1", "intro", "q1"),
        edge("e2", "q1", "br"),
        edge("e3", "br", "r_dry", "s_dry", { tag: "dry" }),
        edge("e4", "br", "r_oily", "s_oily", { tag: "oily" }),
        edge("e5", "br", "r_def", "s_def"),
      ],
    );
    const c = ctxFor(doc);
    const dry = c.get("r_dry")!;
    expect(dry.reachedFrom[0]).toMatchObject({ kind: "tag", answerLabels: ["Dry skin"] });
    expect(dry.reachedFrom[0]!.questionLabel).toContain("dry");
    expect(dry.abVariant).toBeUndefined();
    // The unconditioned slot is the default/catch-all path.
    expect(c.get("r_def")!.reachedFrom[0]!.kind).toBe("default");
  });

  it("rules branch with an answer_id condition maps to that answer's text", () => {
    const doc = makeDoc(
      [
        intro(),
        question("q1", "Pick", [ans("a1", "Choice A"), ans("a2", "Choice B")]),
        branch("br", "R", "rules", [
          { id: "s1", label: "A path", weight: 1 },
          { id: "s2", label: "B path", weight: 1 },
        ]),
        result("r1", "A page"),
        result("r2", "B page"),
      ],
      [
        edge("e1", "intro", "q1"),
        edge("e2", "q1", "br"),
        edge("e3", "br", "r1", "s1", { answer_id: "a1" }),
        edge("e4", "br", "r2", "s2", { answer_id: "a2" }),
      ],
    );
    const r1 = ctxFor(doc).get("r1")!;
    expect(r1.reachedFrom[0]).toMatchObject({ questionLabel: "Pick", answerLabels: ["Choice A"], kind: "answer" });
  });

  it("ab_split branch yields a variant badge with normalized weight, no reached-from", () => {
    const doc = makeDoc(
      [
        intro(),
        question("q1", "Q", [ans("a1", "A"), ans("a2", "B")]),
        branch("br", "Headline test", "ab_split", [
          { id: "v_a", label: "Variant A", weight: 7 },
          { id: "v_b", label: "Variant B", weight: 3 },
        ]),
        result("r_a", "A"),
        result("r_b", "B"),
      ],
      [
        edge("e1", "intro", "q1"),
        edge("e2", "q1", "br"),
        edge("e3", "br", "r_a", "v_a"),
        edge("e4", "br", "r_b", "v_b"),
      ],
    );
    const c = ctxFor(doc);
    expect(c.get("r_a")!.abVariant).toMatchObject({ slotLabel: "Variant A", weightPct: 70 });
    expect(c.get("r_b")!.abVariant!.weightPct).toBe(30);
    expect(c.get("r_a")!.reachedFrom).toHaveLength(0);
  });

  it("diamond merge: a result fed by two questions lists both sources", () => {
    const doc = makeDoc(
      [
        intro(),
        question("q1", "First?", [ans("a1", "A"), ans("a2", "B")]),
        question("q2", "Second?", [ans("b1", "C"), ans("b2", "D")]),
        result("r1", "Merged"),
      ],
      [
        edge("e1", "intro", "q1"),
        edge("e2", "q1", "q2"),
        edge("e3", "q1", "r1"),
        edge("e4", "q2", "r1"),
      ],
    );
    const c = ctxFor(doc).get("r1")!;
    expect(c.reachedFrom).toHaveLength(2);
    expect(c.reachedFrom.map((r) => r.questionLabel).sort()).toEqual(["First?", "Second?"]);
  });

  it("orphan result (no incoming edges) is marked unreachable with no sources", () => {
    const doc = makeDoc(
      [intro(), question("q1", "Q", [ans("a1", "A"), ans("a2", "B")]), result("r1", "Live"), result("r_orphan", "Stranded")],
      [edge("e1", "intro", "q1"), edge("e2", "q1", "r1")],
    );
    const c = ctxFor(doc).get("r_orphan")!;
    expect(c.reachable).toBe(false);
    expect(c.reachedFrom).toHaveLength(0);
  });

  it("traces back through a pass-through node (branch → message → result)", () => {
    const doc = makeDoc(
      [
        intro(),
        question("q1", "Skin?", [ans("a_x", "X skin", ["x"]), ans("a_y", "Y skin", ["y"])]),
        branch("br", "Router", "rules", [
          { id: "s1", label: "X path", weight: 1 },
          { id: "s2", label: "Else", weight: 1 },
        ]),
        message("m1"),
        result("r1", "X result"),
        result("r2", "Else result"),
      ],
      [
        edge("e1", "intro", "q1"),
        edge("e2", "q1", "br"),
        edge("e3", "br", "m1", "s1", { tag: "x" }),
        edge("e4", "m1", "r1"),
        edge("e5", "br", "r2", "s2"),
      ],
    );
    const r1 = ctxFor(doc).get("r1")!;
    expect(r1.reachedFrom).toHaveLength(1);
    expect(r1.reachedFrom[0]).toMatchObject({ kind: "tag", answerLabels: ["X skin"] });
  });
});
