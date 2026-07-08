import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { resolveTarget } from "./recommendDecider";
import { enumeratePaths, groupPathsByResult } from "./pathEnumeration";

// Branched decider fixture:
//   intro → q1 (filter):  a1 → q2       a2 → r_skip (branch: skips the decider)
//           q2 (decider): a3 → r_final  a4 → r_final  a5 → r_final
//   Rule R1: if a3 → t3 (overrides a3's own mapping t1).
//   a3.target=t1 (but R1 wins → t3) · a4.target=t2 · a5 has NO target (no-result).
const RAW = {
  quiz_id: "qz_enum",
  logic_model: "decider",
  scope: { collection_ids: [] },
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Welcome" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Where to start?",
        question_type: "single_select",
        role: "filter",
        answers: [
          { id: "a1", text: "Deep dive", tags: [], edge_handle_id: "h1" },
          { id: "a2", text: "Just show me", tags: [], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "What matters most?",
        question_type: "single_select",
        role: "decides",
        required: true,
        answers: [
          { id: "a3", text: "X", tags: [], edge_handle_id: "h3", target_id: "t1" },
          { id: "a4", text: "Y", tags: [], edge_handle_id: "h4", target_id: "t2" },
          { id: "a5", text: "Z", tags: [], edge_handle_id: "h5" },
        ],
      },
    },
    {
      id: "r_final",
      type: "result",
      position: { x: 3, y: 0 },
      data: { headline: "Your pick", fallback_collection_id: "gid://c/1" },
    },
    {
      id: "r_skip",
      type: "result",
      position: { x: 3, y: 1 },
      data: { headline: "Quick pick", fallback_collection_id: "gid://c/2" },
    },
  ],
  edges: [
    { id: "e0", source: "intro", target: "q1" },
    { id: "e1", source: "q1", target: "q2", source_handle: "h1" },
    { id: "e2", source: "q1", target: "r_skip", source_handle: "h2" },
    { id: "e3", source: "q2", target: "r_final", source_handle: "h3" },
    { id: "e4", source: "q2", target: "r_final", source_handle: "h4" },
    { id: "e5", source: "q2", target: "r_final", source_handle: "h5" },
  ],
  decision_rules: [
    { id: "R1", conditions: [{ question_id: "q2", answer_id: "a3", op: "is" }], target_id: "t3" },
  ],
};

const doc = () => Quiz.parse(structuredClone(RAW));

describe("enumeratePaths", () => {
  const res = enumeratePaths(doc());
  const bySel = (sel: string[]) =>
    res.paths.find((p) => p.selectedAnswerIds.join(",") === sel.join(","));

  it("enumerates every distinct answer path", () => {
    // a1→{a3,a4,a5} + a2 (skips the decider) = 4 paths.
    expect(res.count).toBe(4);
    expect(res.truncated).toBe(false);
  });

  it("omits skipped questions from a lane (spec §4)", () => {
    const skip = bySel(["a2"]);
    expect(skip).toBeDefined();
    // The a2 branch never visits q2 — its steps are q1 only.
    expect(skip!.steps.map((s) => s.questionId)).toEqual(["q1"]);
    expect(skip!.resultNodeId).toBe("r_skip");
  });

  it("marks a non-sequential answer as a branch, sequential ones not", () => {
    expect(bySel(["a2"])!.steps[0]!.branch).toBe(true); // diverges to r_skip
    expect(bySel(["a1", "a3"])!.steps[0]!.branch).toBe(false); // plurality target q2
    expect(bySel(["a1", "a3"])!.steps[1]!.branch).toBe(false); // q2 answers all → r_final
  });

  it("resolves the effective result with the SAME engine the runtime uses", () => {
    for (const p of res.paths) {
      expect(p.effectiveTarget).toEqual(resolveTarget(p.selectedAnswerIds, doc()));
    }
  });

  it("applies a rule override and flags it", () => {
    const ruled = bySel(["a1", "a3"])!;
    expect(ruled.effectiveTarget?.targetId).toBe("t3"); // R1 beat a3's own t1
    expect(ruled.effectiveTarget?.matchedRuleId).toBe("R1");
    expect(ruled.ruleOverridden).toBe(true);
    expect(ruled.deadEnd).toBe(false);
  });

  it("uses the decider's own mapping when no rule fires", () => {
    const mapped = bySel(["a1", "a4"])!;
    expect(mapped.effectiveTarget?.targetId).toBe("t2");
    expect(mapped.ruleOverridden).toBe(false);
  });

  it("flags a decider answer with no result as a no-result dead end", () => {
    const dead = bySel(["a1", "a5"])!;
    expect(dead.deadEnd).toBe(true);
    expect(dead.deadEndReason).toBe("no-result");
    expect(dead.effectiveTarget).toBeNull();
  });

  it("flags a path that never reaches the decider as an unreached-decider dead end", () => {
    const dead = bySel(["a2"])!;
    expect(dead.deadEnd).toBe(true);
    expect(dead.deadEndReason).toBe("unreached-decider");
  });

  it("collects exactly the dead-end paths", () => {
    expect(res.deadEnds.map((p) => p.selectedAnswerIds.join(","))).toEqual(["a1,a5", "a2"]);
  });
});

describe("enumeratePaths — backstops", () => {
  it("honors the maxPaths cap and reports truncation", () => {
    const capped = enumeratePaths(doc(), { maxPaths: 2 });
    expect(capped.count).toBe(2);
    expect(capped.truncated).toBe(true);
  });

  it("terminates on a self-routing cycle instead of looping forever", () => {
    const cyclic = Quiz.parse({
      quiz_id: "qz_cycle",
      logic_model: "decider",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Loop?",
            question_type: "single_select",
            role: "decides",
            required: true,
            answers: [
              { id: "a1", text: "Again", tags: [], edge_handle_id: "h1" }, // routes back to q1
              { id: "a2", text: "Done", tags: [], edge_handle_id: "h2", target_id: "t1" },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 2, y: 0 },
          data: { headline: "R", fallback_collection_id: "gid://c/1" },
        },
      ],
      edges: [
        { id: "e0", source: "intro", target: "q1" },
        { id: "e1", source: "q1", target: "q1", source_handle: "h1" }, // self-loop
        { id: "e2", source: "q1", target: "r1", source_handle: "h2" },
      ],
    });
    const out = enumeratePaths(cyclic);
    expect(out.count).toBe(2); // a1 (cycle → dead end) + a2 (→ t1)
    expect(out.truncated).toBe(false);
  });
});

describe("groupPathsByResult", () => {
  it("collapses same-result paths and sorts the dead-end group last", () => {
    const groups = groupPathsByResult(enumeratePaths(doc()).paths);
    expect(groups.map((g) => g.targetId)).toEqual(["t3", "t2", null]);
    const dead = groups.find((g) => g.targetId === null)!;
    expect(dead.paths).toHaveLength(2);
    expect(dead.deadEndCount).toBe(2);
  });
});
