// Logic step — ruleStatuses (the one per-rule status) + recommendationCoverage.
// The shadow cases are the B12 table in the handoff (engine semantics §17),
// on a doc shaped like the mock's skincare quiz.
import { describe, expect, it } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import { recommendationCoverage } from "./recommendationCoverage";
import { neverRunsTag, ruleStatuses } from "./ruleStatus";
import { shadowedRules } from "./pathAnalyzer";
import { Quiz } from "./quizSchema";
import type { DecisionRule } from "./quizSchema";

const ans = (prefix: string, texts: string[]) =>
  texts.map((text, i) => ({ id: `${prefix}${i + 1}`, text, edge_handle_id: `h_${prefix}${i + 1}` }));

/** Q1 single (6), Q2 multi (5), Q3 single (3), Q4 single (3), Q5 multi (6, max 2). */
function skinDoc(rules: DecisionRule[], opts: { q1Optional?: boolean } = {}) {
  return Quiz.parse({
    quiz_id: "skin",
    logic_model: "decider",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1", type: "question", position: { x: 1, y: 0 },
        data: {
          text: "Feel", question_type: "single_select", role: "decides",
          required: !opts.q1Optional,
          answers: ans("t", ["Tight", "Shiny", "Blotchy", "Dull", "Lines", "Stings"]).map((a, i) => ({ ...a, target_id: `rec${i + 1}` })),
        },
      },
      { id: "q2", type: "question", position: { x: 2, y: 0 }, data: { text: "Areas", question_type: "multi_select", answers: ans("ar", ["Forehead", "Cheeks", "Eyes", "Jaw", "Whole"]) } },
      { id: "q3", type: "question", position: { x: 3, y: 0 }, data: { text: "Steps", question_type: "single_select", answers: ans("st", ["One", "Three", "Five"]) } },
      { id: "q4", type: "question", position: { x: 4, y: 0 }, data: { text: "Evening", question_type: "single_select", answers: ans("ev", ["Oilier", "Drier", "Same"]) } },
      { id: "q5", type: "question", position: { x: 5, y: 0 }, data: { text: "Ingredients", question_type: "multi_select", max_selections: 2, answers: ans("in", ["VitC", "Retinol", "Niacinamide", "AHA", "Ceramides", "None"]) } },
      { id: "res", type: "result", position: { x: 6, y: 0 }, data: { headline: "Done", fallback_collection_id: "c" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "q3" },
      { id: "e4", source: "q3", target: "q4" },
      { id: "e5", source: "q4", target: "q5" },
      { id: "e6", source: "q5", target: "res" },
    ],
    decision_rules: rules,
  });
}

const tagOf = (doc: ReturnType<typeof skinDoc>, id: string, known?: string[]) =>
  neverRunsTag(ruleStatuses(doc, known).get(id));

describe("never runs · shadowed (the B12 table)", () => {
  it("exact subset (case B)", () => {
    const doc = skinDoc([
      rule("r1", [["q1", "t2"]], "x"),
      rule("r2", [["q1", "t2"], ["q3", "st1", "is_not"]], "y"),
    ]);
    expect(tagOf(doc, "r2")).toBe("never runs · rule 1 catches them first");
    expect(tagOf(doc, "r1")).toBeNull();
  });

  it("earlier answer inside a later all-of (cases A and E)", () => {
    const a = skinDoc([rule("r1", [["q2", "ar2"]], "x"), rule("r2", [["q2", "ar1"], ["q2", "ar2"]], "y")]);
    expect(tagOf(a, "r2")).toBe("never runs · rule 1 catches them first");
    const e = skinDoc([
      rule("r1", [["q5", "in1"]], "x", { any_of: ["q5"] }),
      rule("r2", [["q5", "in1"], ["q5", "in2"]], "y"),
    ]);
    expect(tagOf(e, "r2")).toBe("never runs · rule 1 catches them first");
  });

  it("same conditions, earlier rule is Hide (the verb never matters)", () => {
    const doc = skinDoc([
      rule("r1", [["q1", "t2"]], "x", { action: "hide" }),
      rule("r2", [["q1", "t2"]], "y", { action: "show" }),
    ]);
    expect(tagOf(doc, "r2")).toBe("never runs · rule 1 catches them first");
  });

  it("earlier any-of superset (new)", () => {
    const doc = skinDoc([
      rule("r1", [["q2", "ar2"], ["q2", "ar1"]], "x", { any_of: ["q2"] }),
      rule("r2", [["q2", "ar2"]], "y"),
    ]);
    expect(tagOf(doc, "r2")).toBe("never runs · rule 1 catches them first");
  });

  it("later all-of overlapping an earlier any-of (new)", () => {
    const doc = skinDoc([
      rule("r1", [["q5", "in1"], ["q5", "in4"]], "x", { any_of: ["q5"] }),
      rule("r2", [["q5", "in1"], ["q5", "in2"]], "y"),
    ]);
    expect(tagOf(doc, "r2")).toBe("never runs · rule 1 catches them first");
  });

  it("is / is not on a one-answer question (cases C and D)", () => {
    const c = skinDoc([rule("r1", [["q3", "st1", "is_not"]], "x"), rule("r2", [["q3", "st2"]], "y")]);
    expect(tagOf(c, "r2")).toBe("never runs · rule 1 catches them first");
    const d = skinDoc([rule("r1", [["q1", "t1", "is_not"]], "x"), rule("r2", [["q1", "t3"]], "y")]);
    expect(tagOf(d, "r2")).toBe("never runs · rule 1 catches them first");
  });

  it("union of earlier rules (case F)", () => {
    const doc = skinDoc([
      rule("r1", [["q1", "t2"]], "x"),
      rule("r2", [["q1", "t3"]], "y"),
      rule("r3", [["q1", "t2"], ["q1", "t3"]], "z", { any_of: ["q1"] }),
    ]);
    expect(tagOf(doc, "r3")).toBe("never runs · rules 1 and 2 catch them first");
    expect(ruleStatuses(doc).get("r3")!.shadowedBy).toEqual([1, 2]);
  });

  it("catch-all only when the question is always answered (case G)", () => {
    const all6 = rule("r1", ["t1", "t2", "t3", "t4", "t5", "t6"].map((a) => ["q1", a] as [string, string]), "x", { any_of: ["q1"] });
    const later = rule("r2", [["q3", "st1"]], "y");
    expect(tagOf(skinDoc([all6, later]), "r2")).toBe("never runs · rule 1 catches them first");
    expect(tagOf(skinDoc([all6, later], { q1Optional: true }), "r2")).toBeNull();
  });

  it("control: an earlier all-of never shadows a later any-of", () => {
    const doc = skinDoc([
      rule("r1", [["q5", "in1"], ["q5", "in2"]], "x"),
      rule("r2", [["q5", "in1"], ["q5", "in2"]], "y", { any_of: ["q5"] }),
    ]);
    expect(tagOf(doc, "r2")).toBeNull();
  });

  it("a duplicate directly below its source is shadowed (D11)", () => {
    const r1 = rule("r1", [["q1", "t2"], ["q4", "ev1"]], "x");
    const doc = skinDoc([r1, { ...r1, id: "r1copy" }]);
    expect(tagOf(doc, "r1copy")).toBe("never runs · rule 1 catches them first");
  });

  it("partial overlap is never flagged", () => {
    const doc = skinDoc([rule("r1", [["q1", "t2"]], "x"), rule("r2", [["q4", "ev1"]], "y")]);
    expect(tagOf(doc, "r2")).toBeNull();
  });

  it("match any rules are never tagged; zero-condition earlier rules never catch", () => {
    const doc = skinDoc([
      rule("r0", [], "x"),
      rule("r1", [["q1", "t2"]], "x"),
      rule("r2", [["q1", "t2"], ["q3", "st1"]], "y", { match: "any" }),
    ]);
    expect(tagOf(doc, "r2")).toBeNull();
    expect(tagOf(doc, "r1")).toBeNull();
  });

  it("over the cap → no tag (sound but silent)", () => {
    const many = Array.from({ length: 17 }, (_, i) => ({ id: `m${i}`, text: `M${i}`, edge_handle_id: `hm${i}` }));
    const base = skinDoc([]);
    const doc = Quiz.parse({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "q2" && n.type === "question" ? { ...n, data: { ...n.data, answers: many } } : n,
      ),
      decision_rules: [
        rule("r1", many.map((a) => ["q2", a.id] as [string, string]), "x", { any_of: ["q2"] }),
        rule("r2", [["q2", "m0"]], "y"),
      ],
    });
    expect(tagOf(doc, "r2")).toBeNull();
  });

  it("shadowedRules (V8's analyzer entry point) reads the same walk", () => {
    const doc = skinDoc([
      rule("r1", [["q1", "t2"]], "x"),
      rule("r2", [["q1", "t3"]], "y"),
      rule("r3", [["q1", "t2"], ["q1", "t3"]], "z", { any_of: ["q1"] }),
    ]);
    expect(shadowedRules(doc)).toEqual([
      { ruleId: "r3", message: expect.stringMatching(/^Rules 1 and 2 always fire first/) },
    ]);
  });
});

describe("never runs · incomplete and impossible", () => {
  it("no answers / no recommendation / both (mock deadCalc wording)", () => {
    const doc = skinDoc([
      rule("r1", [], "gone"),
      rule("r2", [], "rec1"),
      rule("r3", [["q1", "t1"]], ["gone", "gone2"]),
      rule("r4", [["q1", "t2"]], ["rec2", "gone"]),
    ]);
    const s = ruleStatuses(doc, ["rec1", "rec2"]);
    expect(s.get("r1")!.neverRuns).toBe("no answers or recommendation left");
    expect(s.get("r2")!.neverRuns).toBe("no answers left");
    expect(s.get("r3")!.neverRuns).toBe("no recommendation left");
    expect(s.get("r3")!.missing).toEqual({ answers: false, recommendations: true });
    expect(s.get("r4")!.neverRuns).toBeNull();
    expect(s.get("r4")!.flags.map((f) => f.kind)).toEqual(["target_deleted"]);
    // targets are never judged without a known set
    expect(ruleStatuses(doc).get("r3")!.neverRuns).toBeNull();
  });

  it("all-of over max_selections, and 2+ all-of on a one-answer question", () => {
    const doc = skinDoc([
      rule("r1", [["q5", "in1"], ["q5", "in2"], ["q5", "in3"]], "x"),
      rule("r2", [["q3", "st1"], ["q3", "st2"]], "y"),
      rule("r3", [["q5", "in1"], ["q5", "in2"], ["q5", "in3"]], "z", { any_of: ["q5"] }),
      rule("r4", [["q5", "in1"], ["q5", "in2"], ["q5", "in3"]].map(([q, a]) => [q, a, "is_not"] as [string, string, "is_not"]), "w"),
    ]);
    const s = ruleStatuses(doc);
    expect(neverRunsTag(s.get("r1"))).toBe("never runs · needs more Q5 answers than they can pick");
    expect(s.get("r1")!.impossible).toEqual({ questionId: "q5", qNumber: 5, needs: 3, canPick: 2 });
    expect(s.get("r2")!.neverRuns).toBe("needs more Q3 answers than they can pick");
    expect(s.get("r3")!.neverRuns).toBeNull(); // any-of is possible
    expect(s.get("r4")!.neverRuns).toBeNull(); // "not all 3" always holds
  });
});

describe("flags (D19)", () => {
  it("broken references split by op, fires-for-everyone, unreachable", () => {
    const doc = skinDoc([
      rule("r1", [["q1", "gone"]], "x"),
      rule("r2", [["qx", "gone", "is_not"]], "x"),
      rule("r3", [["q1", "t1"], ["q3", "st1", "is_not"]], "x", { match: "any" }),
      rule("r4", [["q1", "gone"], ["q3", "st1"]], "x", { match: "any" }),
    ]);
    const s = ruleStatuses(doc);
    expect(s.get("r1")!.flags).toEqual([{ kind: "broken_never", text: "uses a deleted answer, so it never runs" }]);
    expect(s.get("r1")!.canRun).toBe(false);
    expect(s.get("r2")!.flags.map((f) => f.kind)).toEqual(["broken_always"]);
    expect(s.get("r2")!.canRun).toBe(true);
    expect(s.get("r3")!.flags.map((f) => f.kind)).toEqual(["fires_for_everyone"]);
    expect(s.get("r4")!.flags.map((f) => f.kind)).toEqual(["broken_partial"]);
    expect(s.get("r4")!.canRun).toBe(true);

    const orphan = Quiz.parse({ ...skinDoc([rule("r5", [["q4", "ev1"]], "x")]), edges: skinDoc([]).edges.filter((e) => e.id !== "e4" && e.id !== "e5") });
    expect(ruleStatuses(orphan).get("r5")!.flags.map((f) => f.kind)).toContain("unreachable");
    expect(ruleStatuses(orphan).get("r5")!.canRun).toBe(false);
  });
});

describe("recommendationCoverage", () => {
  const rules = [
    rule("show", [["q2", "b1"]], "catA", { action: "show" }),
    rule("pin", [["q2", "b2"]], "catB", { action: "prioritize" }),
    // (not q2/b3: rules 1–3 on all three q2 answers would catch everyone
    // and shadow every later rule)
    rule("hide", [["q3", "m1"]], "catC", { action: "hide" }),
    rule("replace", [["q4", "r1"]], ["catD", "cat1"]),
    rule("dead", [["q2", "b1"]], "catE", { action: "show" }), // shadowed by rule 1
    rule("empty", [], "catF", { action: "show" }),
  ];
  const ids = ["catA", "catB", "catC", "catD", "catE", "catF", "cat1", "cat2", "catZ"];

  it("Rules only: every runnable non-hide rule shows; mappings never count", () => {
    const doc = logicDoc({ rules, logic_style: "rules" });
    const cov = recommendationCoverage(doc, "rules", ids);
    expect(cov.get("catA")).toEqual({ rulesShowing: [1], mapped: false, covered: true });
    expect(cov.get("catB")!.rulesShowing).toEqual([2]);
    expect(cov.get("catC")!.covered).toBe(false); // hide never covers
    expect(cov.get("catD")!.rulesShowing).toEqual([4]);
    expect(cov.get("catE")!.covered).toBe(false); // never runs
    expect(cov.get("catF")!.covered).toBe(false); // no answers
    expect(cov.get("cat2")).toEqual({ rulesShowing: [], mapped: false, covered: false });
  });

  it("Filter Results + Rules: show and replace add; pin and hide don't; mappings count", () => {
    const doc = logicDoc({ rules });
    const cov = recommendationCoverage(doc, "attributes", ids);
    expect(cov.get("catA")!.rulesShowing).toEqual([1]);
    expect(cov.get("catB")!.covered).toBe(false);
    expect(cov.get("catC")!.covered).toBe(false);
    expect(cov.get("catD")!.rulesShowing).toEqual([4]);
    expect(cov.get("cat1")).toEqual({ rulesShowing: [4], mapped: true, covered: true });
    expect(cov.get("cat2")).toEqual({ rulesShowing: [], mapped: true, covered: true });
    expect(cov.get("catZ")!.covered).toBe(false);
  });
});
