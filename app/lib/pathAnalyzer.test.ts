import { describe, expect, it } from "vitest";
import {
  answerNextNode,
  answersReachable,
  answersReachDecider,
  brokenRuleRefs,
  deadRules,
  halfBuiltRules,
  outcomeTable,
  reachableNodeIds,
  ruleMatchEstimates,
  shadowedRules,
} from "./pathAnalyzer";
import { Quiz } from "./quizSchema";

// A configurable decider-model graph:
//   intro → q1 (qualifier, 2 answers) → q2 (DECIDES, 2 answers) → r1
// q1's answer b carries an explicit skip edge (overridable per test).
function makeDoc(patch: Record<string, unknown> = {}) {
  return Quiz.parse({
    quiz_id: "qa",
    scope: { collection_ids: [] },
    logic_model: "decider",
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Level?",
          question_type: "single_select",
          role: "qualifier",
          answers: [
            { id: "a_beg", text: "Beginner", tags: [], edge_handle_id: "h_beg" },
            { id: "a_adv", text: "Advanced", tags: [], edge_handle_id: "h_adv" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 2, y: 0 },
        data: {
          text: "Terrain?",
          question_type: "single_select",
          role: "decides",
          answers: [
            { id: "a_park", text: "Park", tags: [], edge_handle_id: "h_park", target_id: "cat_park" },
            { id: "a_pow", text: "Powder", tags: [], edge_handle_id: "h_pow", target_id: "cat_pow" },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 3, y: 0 },
        data: { headline: "Match", fallback_collection_id: "c_fb" },
      },
      { id: "end1", type: "end", position: { x: 3, y: 1 }, data: { headline: "Bye" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" }, // default route
      { id: "e3", source: "q2", target: "r1" },
    ],
    ...patch,
  });
}

describe("graph primitives", () => {
  it("answerNextNode: explicit handle edge wins over the default; null when neither exists", () => {
    const doc = makeDoc({
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "e2b", source: "q1", target: "end1", source_handle: "h_adv" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    expect(answerNextNode(doc, "q1", "h_adv")).toBe("end1"); // explicit
    expect(answerNextNode(doc, "q1", "h_beg")).toBe("q2"); // default
    expect(answerNextNode(doc, "r1", "nope")).toBeNull();
  });

  it("reachableNodeIds is cycle-safe", () => {
    const doc = makeDoc({
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "eCycle", source: "q2", target: "q1", source_handle: "h_park" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    const seen = reachableNodeIds(doc, "intro");
    expect(seen.has("r1")).toBe(true);
    expect(seen.has("q1")).toBe(true);
  });
});

describe("answer-level reachability", () => {
  it("answers on an orphaned question are not offerable", () => {
    const doc = makeDoc({
      edges: [
        { id: "e1", source: "intro", target: "q2" }, // q1 orphaned
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    const r = answersReachable(doc);
    expect(r.get("a_beg")).toBe(false);
    expect(r.get("a_park")).toBe(true);
  });

  it("answersReachDecider: a skip route past the decider is flagged, sibling routes are not", () => {
    const doc = makeDoc({
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        // Advanced skips STRAIGHT to the end — bypassing the decider.
        { id: "eSkip", source: "q1", target: "end1", source_handle: "h_adv" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    const r = answersReachDecider(doc);
    expect(r.get("a_beg")).toBe(true); // default route → q2 (the decider)
    expect(r.get("a_adv")).toBe(false); // the bypass — answer-granular V2
    expect(r.get("a_park")).toBe(true); // decider's own answers trivially pass
  });
});

describe("rule diagnostics (V7/V8/V9)", () => {
  const rule = (id: string, conditions: unknown[], target = "cat_x") => ({
    id,
    conditions,
    target_id: target,
  });

  it("V9: zero-condition rules are half-built", () => {
    const doc = makeDoc({ decision_rules: [rule("r_empty", [])] });
    expect(halfBuiltRules(doc).map((f) => f.ruleId)).toEqual(["r_empty"]);
  });

  it("V7: an `is` condition on an unreachable question makes the rule dead; `is_not` does not", () => {
    const orphanEdges = [
      { id: "e1", source: "intro", target: "q2" }, // q1 unreachable
      { id: "e3", source: "q2", target: "r1" },
    ];
    const dead = makeDoc({
      edges: orphanEdges,
      decision_rules: [rule("r1", [{ question_id: "q1", answer_id: "a_adv", op: "is" }])],
    });
    expect(deadRules(dead).map((f) => f.ruleId)).toEqual(["r1"]);
    const alive = makeDoc({
      edges: orphanEdges,
      decision_rules: [rule("r1", [{ question_id: "q1", answer_id: "a_adv", op: "is_not" }])],
    });
    expect(deadRules(alive)).toEqual([]);
  });

  it("V7: two `is` conditions on mutually exclusive lanes are dead; ancestor/descendant pairs are not", () => {
    // q1 answer routes fork to qA or qB (parallel lanes), both → q2 → r1.
    const doc = makeDoc({
      nodes: [
        ...makeDoc().nodes.slice(0, 2),
        {
          id: "qA",
          type: "question",
          position: { x: 2, y: -1 },
          data: {
            text: "A?",
            question_type: "single_select",
            answers: [
              { id: "aa1", text: "x", tags: [], edge_handle_id: "ha1" },
              { id: "aa2", text: "y", tags: [], edge_handle_id: "ha2" },
            ],
          },
        },
        {
          id: "qB",
          type: "question",
          position: { x: 2, y: 1 },
          data: {
            text: "B?",
            question_type: "single_select",
            answers: [
              { id: "ab1", text: "x", tags: [], edge_handle_id: "hb1" },
              { id: "ab2", text: "y", tags: [], edge_handle_id: "hb2" },
            ],
          },
        },
        ...makeDoc().nodes.slice(2),
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "eA", source: "q1", target: "qA", source_handle: "h_beg" },
        { id: "eB", source: "q1", target: "qB", source_handle: "h_adv" },
        { id: "eA2", source: "qA", target: "q2" },
        { id: "eB2", source: "qB", target: "q2" },
        { id: "e3", source: "q2", target: "r1" },
      ],
      decision_rules: [
        // qA and qB never co-occur → dead.
        rule("r_parallel", [
          { question_id: "qA", answer_id: "aa1", op: "is" },
          { question_id: "qB", answer_id: "ab1", op: "is" },
        ]),
        // q1 → qA is ancestor/descendant → fine.
        rule("r_chain", [
          { question_id: "q1", answer_id: "a_beg", op: "is" },
          { question_id: "qA", answer_id: "aa1", op: "is" },
        ]),
      ],
    });
    expect(deadRules(doc).map((f) => f.ruleId)).toEqual(["r_parallel"]);
  });

  it("V8: a higher rule whose conditions are a subset of a lower's shadows it", () => {
    const c1 = { question_id: "q2", answer_id: "a_pow", op: "is" };
    const c2 = { question_id: "q1", answer_id: "a_adv", op: "is" };
    const doc = makeDoc({
      decision_rules: [
        rule("r_high", [c1]), // broader — fires first
        rule("r_low", [c1, c2]), // stricter — every match also matches r_high
        rule("r_other", [{ question_id: "q1", answer_id: "a_beg", op: "is" }]),
      ],
    });
    expect(shadowedRules(doc).map((f) => f.ruleId)).toEqual(["r_low"]);
  });

  it("§9: brokenRuleRefs flags deleted-question/answer conditions, with op-aware severity copy", () => {
    const doc = makeDoc({
      decision_rules: [
        // `is` on a deleted answer (question exists) — the engine can NEVER fire it.
        rule("r_is_gone", [{ question_id: "q1", answer_id: "a_deleted", op: "is" }]),
        // `is_not` on a deleted question — vacuously TRUE → would match EVERYONE.
        rule("r_isnot_gone", [{ question_id: "q_gone", answer_id: "x", op: "is_not" }]),
        // Intact refs — clean.
        rule("r_ok", [{ question_id: "q1", answer_id: "a_adv", op: "is" }]),
      ],
    });
    const findings = brokenRuleRefs(doc);
    expect(findings.map((f) => f.ruleId)).toEqual(["r_is_gone", "r_isnot_gone"]);
    expect(findings[0]!.message).toMatch(/can never fire/);
    expect(findings[1]!.message).toMatch(/EVERY shopper/);
    expect(brokenRuleRefs(makeDoc())).toEqual([]); // no rules → no findings
  });

  it("§4.3: match estimates — uniform-independence products", () => {
    const doc = makeDoc({
      decision_rules: [
        rule("r_is", [{ question_id: "q1", answer_id: "a_adv", op: "is" }]),
        rule("r_combo", [
          { question_id: "q1", answer_id: "a_adv", op: "is" },
          { question_id: "q2", answer_id: "a_pow", op: "is_not" },
        ]),
        rule("r_ghost", [{ question_id: "q_gone", answer_id: "x", op: "is" }]),
      ],
    });
    const est = ruleMatchEstimates(doc);
    expect(est.get("r_is")).toBeCloseTo(0.5);
    expect(est.get("r_combo")).toBeCloseTo(0.5 * 0.5);
    expect(est.get("r_ghost")).toBe(0);
  });
});

describe("outcomeTable", () => {
  it("one row per deciding answer + per rule, with reachability", () => {
    const doc = makeDoc({
      decision_rules: [
        { id: "r1", conditions: [{ question_id: "q1", answer_id: "a_adv", op: "is" }], target_id: "cat_pro" },
        { id: "r_empty", conditions: [], target_id: "cat_never" },
      ],
    });
    const rows = outcomeTable(doc);
    expect(rows.filter((r) => r.kind === "mapping")).toHaveLength(2);
    expect(rows.find((r) => r.id === "a_park")?.targetId).toBe("cat_park");
    expect(rows.find((r) => r.id === "r1")?.reachable).toBe(true);
    expect(rows.find((r) => r.id === "r_empty")?.reachable).toBe(false); // half-built
  });
});
