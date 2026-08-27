import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  setAnswerRoute,
  addEdge,
  setSlotWeight,
  setBranchMode,
  promoteAbWinner,
  deleteNode,
  duplicateQuestionNode,
  insertQuestionRelative,
  insertContentRelative,
  moveAnswer,
  moveStep,
  routeAnswerToEnd,
  setAnswerBucketDirect,
  setAnswerBucketWeight,
  swapScoringModel,
  straightThroughRun,
  setResultSectionCount,
  setResultStage,
  setQuestionType,
  setQuestionRole,
  setAnswerTarget,
  addDecisionRule,
  removeDecisionRule,
  moveDecisionRule,
  updateDecisionRule,
  createDecisionRule,
  duplicateDecisionRule,
  setAnswerFilterValues,
  setQuestionNarrowField,
  setRecPageGlobal,
  setRecPageOverride,
  removeRecPageOverride,
  convertQuestionToMessage,
  duplicateLayoutBlock,
} from "./quizMutations";
import { insertModule } from "../components/studio/studioDoc";
import { orderFlow } from "./flowOrder";

// Linear quiz: intro → q1 → q2 → q3 → result. The drag-reorder happy path.
function linearQuestionsDoc() {
  const q = (id: string) => ({
    id,
    type: "question" as const,
    position: { x: 0, y: 0 },
    data: {
      text: id,
      question_type: "single_select" as const,
      required: true,
      show_preview_after: false,
      answers: [
        { id: `${id}_a1`, text: "o1", tags: [], edge_handle_id: `${id}_h1` },
        { id: `${id}_a2`, text: "o2", tags: [], edge_handle_id: `${id}_h2` },
      ],
    },
  });
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      q("q1"),
      q("q2"),
      q("q3"),
      {
        id: "r1",
        type: "result",
        position: { x: 0, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
      },
    ],
    edges: [
      { id: "e0", source: "intro", target: "q1" },
      { id: "e1", source: "q1", target: "q2" },
      { id: "e2", source: "q2", target: "q3" },
      { id: "e3", source: "q3", target: "r1" },
    ],
  });
}

const spineIds = (doc: ReturnType<typeof linearQuestionsDoc>) =>
  orderFlow(doc).steps.map((s) => s.nodeId);

describe("straightThroughRun", () => {
  it("returns the linear movable run with head=intro and tail=result", () => {
    const { head, run, tail } = straightThroughRun(linearQuestionsDoc());
    expect(head).toBe("intro");
    expect(run).toEqual(["q1", "q2", "q3"]);
    expect(tail).toBe("r1");
  });

  it("stops the run at a branch (branch is the tail, not a run member)", () => {
    const doc = insertModule(linearQuestionsDoc(), "branch", "q3", undefined, "gid://c/fb").doc;
    // intro → q1 → q2 → q3 → branch (spliced between q3 and r1)
    const { run, tail } = straightThroughRun(doc);
    expect(run).toEqual(["q1", "q2", "q3"]);
    const tailNode = doc.nodes.find((n) => n.id === tail);
    expect(tailNode?.type).toBe("branch");
  });
});

describe("duplicateQuestionNode / insertQuestionRelative (Question-Builder spec)", () => {
  const runOf = (doc: ReturnType<typeof linearQuestionsDoc>) => straightThroughRun(doc).run;

  it("duplicate splices the clone right after the original on the spine", () => {
    const before = runOf(linearQuestionsDoc()); // [q1,q2,q3]
    const next = duplicateQuestionNode(linearQuestionsDoc(), "q2");
    const run = runOf(next);
    expect(run.length).toBe(before.length + 1);
    const cloneId = run[run.indexOf("q2") + 1]!;
    expect(["q1", "q2", "q3"]).not.toContain(cloneId); // fresh id
    expect(run).toEqual(["q1", "q2", cloneId, "q3"]);
  });

  it("the clone gets fresh answer ids (independent routing)", () => {
    const next = duplicateQuestionNode(linearQuestionsDoc(), "q2");
    const run = runOf(next);
    const cloneId = run[run.indexOf("q2") + 1]!;
    const clone = next.nodes.find((n) => n.id === cloneId);
    const orig = next.nodes.find((n) => n.id === "q2");
    if (clone?.type !== "question" || orig?.type !== "question") throw new Error("bad fixture");
    expect(clone.data.text).toBe(orig.data.text);
    const cloneAnswerIds = clone.data.answers.map((a) => a.id);
    const origAnswerIds = orig.data.answers.map((a) => a.id);
    expect(cloneAnswerIds.some((id) => origAnswerIds.includes(id))).toBe(false);
  });

  it("insert above places a new question before the reference", () => {
    const next = insertQuestionRelative(linearQuestionsDoc(), "q2", "above");
    const run = runOf(next);
    const newId = run[run.indexOf("q2") - 1]!;
    expect(["q1", "q2", "q3"]).not.toContain(newId);
    expect(run).toEqual(["q1", newId, "q2", "q3"]);
  });

  it("insertContentRelative splices a MESSAGE step into the chain (questions-full-page §3)", () => {
    const next = insertContentRelative(linearQuestionsDoc(), "q2", "below");
    const run = runOf(next);
    const newId = run[run.indexOf("q2") + 1]!;
    expect(run).toEqual(["q1", "q2", newId, "q3"]);
    const node = next.nodes.find((n) => n.id === newId);
    expect(node?.type).toBe("message");
    // splice, not fork: the anchor keeps exactly ONE plain outgoing edge
    expect(next.edges.filter((e) => e.source === "q2" && !e.source_handle).length).toBe(1);
  });

  it("insert below places a new question after the reference", () => {
    const next = insertQuestionRelative(linearQuestionsDoc(), "q3", "below");
    const run = runOf(next);
    const newId = run[run.indexOf("q3") + 1]!;
    expect(run).toEqual(["q1", "q2", "q3", newId]);
    // the result page still terminates the spine
    expect(straightThroughRun(next).tail).toBe("r1");
  });

  it("duplicate is a no-op on a non-question id", () => {
    const doc = linearQuestionsDoc();
    expect(duplicateQuestionNode(doc, "r1")).toBe(doc);
  });

  it("setAnswerBucketDirect maps an answer to exactly one bucket (weight 1), and null clears it", () => {
    const q = (d: ReturnType<typeof linearQuestionsDoc>, id: string) =>
      d.nodes.find((n) => n.id === id) as Extract<(typeof d.nodes)[number], { type: "question" }>;
    const mapped = setAnswerBucketDirect(linearQuestionsDoc(), "q1", "q1_a1", "cat-oily");
    expect(q(mapped, "q1").data.answers.find((a) => a.id === "q1_a1")!.points).toEqual({
      "cat-oily": 1,
    });
    // re-mapping replaces (still exactly one bucket)
    const remapped = setAnswerBucketDirect(mapped, "q1", "q1_a1", "cat-dry");
    expect(q(remapped, "q1").data.answers.find((a) => a.id === "q1_a1")!.points).toEqual({
      "cat-dry": 1,
    });
    // null clears the map entirely
    const cleared = setAnswerBucketDirect(remapped, "q1", "q1_a1", null);
    expect(q(cleared, "q1").data.answers.find((a) => a.id === "q1_a1")!.points).toBeUndefined();
  });

  it("setAnswerBucketDirect is a no-op on a WEIGHTED quiz (never flattens a weighted map)", () => {
    const q = (d: ReturnType<typeof linearQuestionsDoc>, id: string) =>
      d.nodes.find((n) => n.id === id) as Extract<(typeof d.nodes)[number], { type: "question" }>;
    // Build a weighted multi-bucket map, then mark the quiz weighted.
    let d = setAnswerBucketWeight(linearQuestionsDoc(), "q1", "q1_a1", "cat-oily", 3);
    d = setAnswerBucketWeight(d, "q1", "q1_a1", "cat-dry", 1);
    d = { ...d, scoring_model: "weighted" };
    // A stray direct call (stale UI / desync) must NOT collapse {oily:3, dry:1} → {oily:1}.
    const after = setAnswerBucketDirect(d, "q1", "q1_a1", "cat-oily");
    expect(q(after, "q1").data.answers.find((a) => a.id === "q1_a1")!.points).toEqual({
      "cat-oily": 3,
      "cat-dry": 1,
    });
    expect(after).toBe(d); // exact no-op, same reference
  });

  it("setAnswerBucketWeight sets/updates one bucket's weight, preserving others; ≤0 removes it", () => {
    const q = (d: ReturnType<typeof linearQuestionsDoc>, id: string) =>
      d.nodes.find((n) => n.id === id) as Extract<(typeof d.nodes)[number], { type: "question" }>;
    let d = setAnswerBucketWeight(linearQuestionsDoc(), "q1", "q1_a1", "cat-oily", 3);
    d = setAnswerBucketWeight(d, "q1", "q1_a1", "cat-dry", 1);
    expect(q(d, "q1").data.answers.find((a) => a.id === "q1_a1")!.points).toEqual({
      "cat-oily": 3,
      "cat-dry": 1,
    });
    d = setAnswerBucketWeight(d, "q1", "q1_a1", "cat-oily", 0); // remove just oily
    expect(q(d, "q1").data.answers.find((a) => a.id === "q1_a1")!.points).toEqual({ "cat-dry": 1 });
  });

  it("swapScoringModel preserves BOTH models' data across a round-trip", () => {
    const q = (d: ReturnType<typeof linearQuestionsDoc>, id: string) =>
      d.nodes.find((n) => n.id === id) as Extract<(typeof d.nodes)[number], { type: "question" }>;
    const ans = (d: ReturnType<typeof linearQuestionsDoc>) =>
      q(d, "q1").data.answers.find((a) => a.id === "q1_a1")!;
    // Start in Direct, map the answer to one bucket.
    let d: ReturnType<typeof linearQuestionsDoc> = setAnswerBucketDirect(
      { ...linearQuestionsDoc(), scoring_model: "direct" },
      "q1",
      "q1_a1",
      "cat-oily",
    );
    expect(ans(d).points).toEqual({ "cat-oily": 1 });
    // Switch to Weighted → the Direct data parks in points_alt; weighted starts empty.
    d = swapScoringModel(d, "weighted");
    expect(d.scoring_model).toBe("weighted");
    expect(ans(d).points_alt).toEqual({ "cat-oily": 1 });
    expect(ans(d).points).toBeUndefined();
    // Assign weighted points.
    d = setAnswerBucketWeight(d, "q1", "q1_a1", "cat-oily", 5);
    d = setAnswerBucketWeight(d, "q1", "q1_a1", "cat-dry", 2);
    expect(ans(d).points).toEqual({ "cat-oily": 5, "cat-dry": 2 });
    // Switch BACK to Direct → the original Direct mapping is restored exactly,
    // and the Weighted data is preserved (now parked in points_alt).
    d = swapScoringModel(d, "direct");
    expect(d.scoring_model).toBe("direct");
    expect(ans(d).points).toEqual({ "cat-oily": 1 });
    expect(ans(d).points_alt).toEqual({ "cat-oily": 5, "cat-dry": 2 });
    // No-op when already on the target model.
    expect(swapScoringModel(d, "direct")).toEqual(d);
  });

  it("routeAnswerToEnd creates an end node and routes the answer to it, reusing it next time", () => {
    const first = routeAnswerToEnd(linearQuestionsDoc(), "q1", "q1_a1");
    const ends = first.nodes.filter((n) => n.type === "end");
    expect(ends).toHaveLength(1);
    const edge = first.edges.find((e) => e.source === "q1" && e.source_handle === "q1_h1");
    expect(edge?.target).toBe(ends[0]!.id);
    // A second answer routed to "End" reuses the same end node (no duplicates).
    const second = routeAnswerToEnd(first, "q2", "q2_a1");
    expect(second.nodes.filter((n) => n.type === "end")).toHaveLength(1);
    const edge2 = second.edges.find((e) => e.source === "q2" && e.source_handle === "q2_h1");
    expect(edge2?.target).toBe(ends[0]!.id);
  });
});

describe("moveAnswer (AUDIT-17 — phone-canvas answer drag-reorder)", () => {
  const answersOf = (doc: ReturnType<typeof linearQuestionsDoc>, id: string) => {
    const n = doc.nodes.find((x) => x.id === id);
    if (!n || n.type !== "question") throw new Error("fixture");
    return n.data.answers;
  };

  it("moves an answer to a new index, order only", () => {
    const doc = linearQuestionsDoc();
    const next = moveAnswer(doc, "q1", "q1_a2", 0);
    expect(answersOf(next, "q1").map((a) => a.id)).toEqual(["q1_a2", "q1_a1"]);
    // The answer OBJECTS ride along untouched (handles, tags — mappings/routes).
    expect(answersOf(next, "q1")[0]).toEqual(answersOf(doc, "q1")[1]);
    expect(next.edges).toBe(doc.edges);
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("clamps toIndex into range", () => {
    const next = moveAnswer(linearQuestionsDoc(), "q1", "q1_a1", 99);
    expect(answersOf(next, "q1").map((a) => a.id)).toEqual(["q1_a2", "q1_a1"]);
    const back = moveAnswer(next, "q1", "q1_a1", -5);
    expect(answersOf(back, "q1").map((a) => a.id)).toEqual(["q1_a1", "q1_a2"]);
  });

  it("is a no-op for the same slot / unknown answer / non-question node", () => {
    const doc = linearQuestionsDoc();
    expect(moveAnswer(doc, "q1", "q1_a1", 0)).toBe(doc);
    expect(moveAnswer(doc, "q1", "nope", 1)).toBe(doc);
    expect(moveAnswer(doc, "intro", "q1_a1", 1)).toBe(doc);
    expect(moveAnswer(doc, "missing", "q1_a1", 1)).toBe(doc);
  });

  it("does not touch other questions' answers", () => {
    const doc = linearQuestionsDoc();
    const next = moveAnswer(doc, "q1", "q1_a2", 0);
    expect(answersOf(next, "q2")).toBe(answersOf(doc, "q2"));
  });
});

describe("moveStep", () => {
  it("moves a step to the front and rewires the chain", () => {
    const next = moveStep(linearQuestionsDoc(), "q3", "q1");
    expect(spineIds(next)).toEqual(["intro", "q3", "q1", "q2", "r1"]);
    expect(() => Quiz.parse(next)).not.toThrow();
    expect(orderFlow(next).orphans).toEqual([]); // nothing stranded
  });

  it("moves a step to the end when beforeId is null", () => {
    const next = moveStep(linearQuestionsDoc(), "q1", null);
    expect(spineIds(next)).toEqual(["intro", "q2", "q3", "q1", "r1"]);
    expect(orderFlow(next).orphans).toEqual([]);
  });

  it("is a no-op when the order would not change", () => {
    const doc = linearQuestionsDoc();
    expect(moveStep(doc, "q1", "q2")).toBe(doc); // q1 already before q2
  });

  it("ignores non-run nodes (intro / result / unknown)", () => {
    const doc = linearQuestionsDoc();
    expect(moveStep(doc, "r1", "q1")).toBe(doc);
    expect(moveStep(doc, "intro", null)).toBe(doc);
    expect(moveStep(doc, "nope", "q1")).toBe(doc);
  });

  it("leaves branch/lane edges untouched when reordering the spine", () => {
    const doc = insertModule(linearQuestionsDoc(), "branch", "q3", undefined, "gid://c/fb").doc;
    const before = doc.edges.filter((e) => e.source_handle).length;
    const orphansBefore = orderFlow(doc).orphans;
    const next = moveStep(doc, "q1", "q3"); // reorder q1 to just before q3
    expect(spineIds(next).slice(0, 3)).toEqual(["intro", "q2", "q1"]);
    // Handle-bearing (branch slot / lane) edges are never rebuilt by a spine move.
    expect(next.edges.filter((e) => e.source_handle).length).toBe(before);
    expect(() => Quiz.parse(next)).not.toThrow();
    // Reordering the spine doesn't strand anything that wasn't already off-flow.
    expect(orderFlow(next).orphans).toEqual(orphansBefore);
  });
});

function docWithBranch() {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "br1",
        type: "branch",
        position: { x: 1, y: 0 },
        data: {
          label: "Branch",
          mode: "rules",
          slots: [
            { id: "sl_a", label: "A", weight: 1 },
            { id: "sl_b", label: "B", weight: 1 },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 2, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
      },
    ],
    edges: [{ id: "e1", source: "intro", target: "br1" }],
  });
}

const branch = (doc: ReturnType<typeof docWithBranch>) =>
  doc.nodes.find((n) => n.id === "br1")!;

describe("setSlotWeight", () => {
  it("sets one slot's weight, leaving others; result re-parses", () => {
    const next = setSlotWeight(setSlotWeight(docWithBranch(), "br1", "sl_a", 30), "br1", "sl_b", 70);
    const b = branch(next);
    expect(b.type === "branch" && b.data.slots.map((s) => s.weight)).toEqual([30, 70]);
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("clamps to a non-negative integer (schema requires int ≥ 0)", () => {
    const next = setSlotWeight(docWithBranch(), "br1", "sl_a", -5.6);
    const b = branch(next);
    expect(b.type === "branch" && b.data.slots[0]!.weight).toBe(0);
    const rounded = setSlotWeight(docWithBranch(), "br1", "sl_a", 2.7);
    const rb = branch(rounded);
    expect(rb.type === "branch" && rb.data.slots[0]!.weight).toBe(3);
  });

  it("is a no-op for an unknown branch or slot", () => {
    const doc = docWithBranch();
    expect(JSON.stringify(setSlotWeight(doc, "nope", "sl_a", 9).nodes)).toBe(
      JSON.stringify(doc.nodes),
    );
  });
});

describe("setBranchMode", () => {
  it("flips mode and re-parses; slots preserved", () => {
    const next = setBranchMode(docWithBranch(), "br1", "ab_split");
    const b = branch(next);
    expect(b.type === "branch" && b.data.mode).toBe("ab_split");
    expect(b.type === "branch" && b.data.slots).toHaveLength(2);
    expect(() => Quiz.parse(next)).not.toThrow();
  });
});

// A simple connected chain: intro → result.
function linearDoc() {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "r1",
        type: "result",
        position: { x: 1, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
      },
    ],
    edges: [{ id: "e1", source: "intro", target: "r1" }],
  });
}

describe("insertModule splices (no dead-end)", () => {
  it("inserts BETWEEN the anchor and its successor: intro → new → result", () => {
    const { doc, newNodeId } = insertModule(linearDoc(), "question", "intro", undefined, "gid://c/fb");
    expect(newNodeId).toBeTruthy();
    const fromIntro = doc.edges.filter((e) => e.source === "intro");
    // intro now points ONLY at the new node (not the old result).
    expect(fromIntro).toHaveLength(1);
    expect(fromIntro[0]!.target).toBe(newNodeId);
    // the new node points onward to the old successor.
    expect(doc.edges.some((e) => e.source === newNodeId && e.target === "r1")).toBe(true);
    // no orphans / dead-ends.
    expect(orderFlow(doc).orphans).toEqual([]);
    expect(() => Quiz.parse(doc)).not.toThrow();
  });

  it("appends (no splice) when the anchor is a leaf with no successor", () => {
    const base = linearDoc();
    // anchor on the result (a leaf) — nothing to re-route.
    const { doc, newNodeId } = insertModule(base, "end", "r1", undefined, "gid://c/fb");
    expect(doc.edges.some((e) => e.source === "r1" && e.target === newNodeId)).toBe(true);
  });

  // The filmstrip "+" (UnifiedWorkspace.addStep) anchors to the LAST MOVABLE step
  // via straightThroughRun, exactly like FlowRail's "+ Add step" — so a manually
  // added question always splices into the question sequence (intro → … → q → NEW
  // → result), reachable + previewable + editable.
  it("filmstrip add anchors to the last question and splices it BEFORE the terminal", () => {
    const base = linearQuestionsDoc(); // intro → q1 → q2 → q3 → r1
    const { head, run } = straightThroughRun(base);
    const anchor = run.length ? run[run.length - 1]! : head; // the last question, q3
    expect(anchor).toBe("q3");
    const { doc, newNodeId } = insertModule(base, "question", anchor, undefined, "gid://c/fb");
    expect(newNodeId).toBeTruthy();
    // q3 → NEW → r1 (the old q3 → r1 edge was re-routed through the new node).
    expect(doc.edges.some((e) => e.source === "q3" && e.target === newNodeId)).toBe(true);
    expect(doc.edges.some((e) => e.source === newNodeId && e.target === "r1")).toBe(true);
    expect(doc.edges.some((e) => e.source === "q3" && e.target === "r1")).toBe(false);
    // In flow order the new question sits BEFORE the result, and the result stays
    // the terminal — a shopper walking the quiz actually reaches the new question.
    const spine = spineIds(doc);
    expect(spine.indexOf(newNodeId!)).toBeLessThan(spine.indexOf("r1"));
    expect(spine[spine.length - 1]).toBe("r1");
    expect(orderFlow(doc).orphans).toEqual([]);
    expect(() => Quiz.parse(doc)).not.toThrow();
  });

  // REGRESSION GUARD for the "manually added question gets lost in the flow" bug:
  // anchoring a QUESTION insert to the terminal result (the pre-fix addStep used
  // ordered.steps[last]) strands it AFTER the result — a result has no successor
  // to re-route, so insertModule just appends result → NEW. The node is reachable
  // in the graph but past the terminal, so the shopper walk + preview never show
  // it. This asserts that wrong anchor produces the bug signature.
  it("REGRESSION: a terminal anchor strands the question AFTER the result (the old bug)", () => {
    const { doc, newNodeId } = insertModule(linearQuestionsDoc(), "question", "r1", undefined, "gid://c/fb");
    expect(doc.edges.some((e) => e.source === "r1" && e.target === newNodeId)).toBe(true);
    const spine = spineIds(doc);
    expect(spine.indexOf(newNodeId!)).toBeGreaterThan(spine.indexOf("r1"));
  });

  // The filmstrip add's EMPTY-RUN fallback (intro → result, no questions yet):
  // straightThroughRun returns an empty run, so addStep anchors to `head` (intro)
  // — NOT null. insertModule then splices intro → NEW → result, so the very first
  // question is reachable, not orphaned. (FlowRail's "+ Add step" falls back to
  // null here and would orphan; the filmstrip has no orphan tray, so head-splicing
  // is the deliberately safer choice.)
  it("filmstrip add on an empty run anchors to the intro and splices intro → new → result", () => {
    const base = linearDoc(); // intro → r1, no questions
    const { head, run } = straightThroughRun(base);
    expect(run).toEqual([]);
    const anchor = run.length ? run[run.length - 1]! : head; // the addStep expression → "intro"
    expect(anchor).toBe("intro");
    const { doc, newNodeId } = insertModule(base, "question", anchor, undefined, "gid://c/fb");
    expect(doc.edges.some((e) => e.source === "intro" && e.target === newNodeId)).toBe(true);
    expect(doc.edges.some((e) => e.source === newNodeId && e.target === "r1")).toBe(true);
    expect(doc.edges.some((e) => e.source === "intro" && e.target === "r1")).toBe(false);
    const spine = orderFlow(doc).steps.map((s) => s.nodeId);
    expect(spine.indexOf(newNodeId!)).toBeLessThan(spine.indexOf("r1"));
    expect(orderFlow(doc).orphans).toEqual([]);
    expect(() => Quiz.parse(doc)).not.toThrow();
  });
});

describe("deleteNode re-stitches", () => {
  it("reconnects prev → next when deleting a straight-through node", () => {
    // intro → q → result, then delete q ⇒ intro → result.
    const withQ = insertModule(linearDoc(), "question", "intro", undefined, "gid://c/fb");
    const qId = withQ.newNodeId!;
    const next = deleteNode(withQ.doc, qId);
    expect(next.nodes.some((n) => n.id === qId)).toBe(false);
    expect(next.edges.some((e) => e.source === "intro" && e.target === "r1")).toBe(true);
    expect(next.edges.some((e) => e.source === qId || e.target === qId)).toBe(false);
    expect(orderFlow(next).orphans).toEqual([]);
    expect(() => Quiz.parse(next)).not.toThrow();
  });
});

describe("promoteAbWinner", () => {
  it("sends 100% to the winning slot, 0 to the rest; result re-parses", () => {
    const next = promoteAbWinner(docWithBranch(), "br1", "sl_b");
    const b = branch(next);
    const byId =
      b.type === "branch"
        ? Object.fromEntries(b.data.slots.map((s) => [s.id, s.weight]))
        : {};
    expect(byId).toEqual({ sl_a: 0, sl_b: 100 });
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("is pure — the input doc is not mutated", () => {
    const input = docWithBranch();
    const snap = JSON.stringify(input);
    promoteAbWinner(input, "br1", "sl_a");
    expect(JSON.stringify(input)).toBe(snap);
  });

  it("ignores an unknown branch id (no-op, still valid)", () => {
    const next = promoteAbWinner(docWithBranch(), "nope", "sl_a");
    expect(() => Quiz.parse(next)).not.toThrow();
  });
});

describe("setAnswerRoute (Unified P4)", () => {
  it("retargets an answer, clears back to default, and guards bad ids", () => {
    let doc = linearQuestionsDoc();
    const q = doc.nodes.find((n) => n.type === "question");
    if (!q || q.type !== "question") throw new Error("fixture");
    const a = q.data.answers[0]!;
    const result = doc.nodes.find((n) => n.type === "result")!;

    // Retarget: a per-answer edge appears on the answer's handle.
    doc = setAnswerRoute(doc, q.id, a.id, result.id);
    const edge = doc.edges.find(
      (e) => e.source === q.id && e.source_handle === a.edge_handle_id,
    );
    expect(edge?.target).toBe(result.id);

    // Retarget again replaces (no duplicate handles).
    doc = setAnswerRoute(doc, q.id, a.id, result.id);
    expect(
      doc.edges.filter((e) => e.source === q.id && e.source_handle === a.edge_handle_id),
    ).toHaveLength(1);

    // Clear: the per-answer edge is removed (default edge applies again).
    doc = setAnswerRoute(doc, q.id, a.id, null);
    expect(
      doc.edges.some((e) => e.source === q.id && e.source_handle === a.edge_handle_id),
    ).toBe(false);

    // Guards: unknown node/answer and self-target are no-ops.
    expect(setAnswerRoute(doc, "nope", a.id, result.id)).toBe(doc);
    expect(setAnswerRoute(doc, q.id, "nope", result.id)).toBe(doc);
    const self = setAnswerRoute(doc, q.id, a.id, q.id);
    expect(self.edges.some((e) => e.source_handle === a.edge_handle_id)).toBe(false);
  });

  // Defense-in-depth: if a doc already carries DUPLICATE edges on one answer handle
  // (e.g. a legacy canvas drag from before addEdge enforced one-per-handle), a
  // reroute must delete EVERY one, not just the first — else a find()-based resolver
  // could silently follow the stale ghost edge and the reroute would be a no-op.
  it("self-heals a pre-corrupted doc with duplicate-handle edges (deletes ALL, not just the first)", () => {
    let doc = linearQuestionsDoc();
    const q = doc.nodes.find((n) => n.type === "question");
    if (!q || q.type !== "question") throw new Error("fixture");
    const a = q.data.answers[0]!;
    const handle = a.edge_handle_id;
    // Manufacture corruption directly (bypassing addEdge): two edges on one handle.
    doc = {
      ...doc,
      edges: [
        ...doc.edges,
        { id: "dup1", source: q.id, target: "q2", source_handle: handle },
        { id: "dup2", source: q.id, target: "q3", source_handle: handle },
      ],
    };
    expect(doc.edges.filter((e) => e.source === q.id && e.source_handle === handle)).toHaveLength(2);
    const next = setAnswerRoute(doc, q.id, a.id, "r1");
    const onHandle = next.edges.filter((e) => e.source === q.id && e.source_handle === handle);
    expect(onHandle).toHaveLength(1); // collapsed to a single edge
    expect(onHandle[0]!.target).toBe("r1");
  });
});

describe("addEdge — one edge per (source, handle)", () => {
  const firstQuestion = (doc: ReturnType<typeof linearQuestionsDoc>) => {
    const q = doc.nodes.find((n) => n.type === "question");
    if (!q || q.type !== "question") throw new Error("fixture");
    return q;
  };

  it("re-pointing a handle REPLACES its edge — no duplicate ghost route (the canvas drag-connect bug)", () => {
    let doc = linearQuestionsDoc();
    const q = firstQuestion(doc);
    const handle = q.data.answers[0]!.edge_handle_id;
    // Two successive drags from the SAME answer handle to different targets.
    doc = addEdge(doc, q.id, "q2", handle);
    doc = addEdge(doc, q.id, "r1", handle);
    const onHandle = doc.edges.filter((e) => e.source === q.id && e.source_handle === handle);
    expect(onHandle).toHaveLength(1); // exactly one edge on the handle
    expect(onHandle[0]!.target).toBe("r1"); // the latest target wins
  });

  it("re-adding the SAME (source, handle, target) is an idempotent no-op (edge id stable)", () => {
    let doc = linearQuestionsDoc();
    const q = firstQuestion(doc);
    const handle = q.data.answers[0]!.edge_handle_id;
    doc = addEdge(doc, q.id, "r1", handle);
    const before = doc.edges.find((e) => e.source === q.id && e.source_handle === handle)!;
    const after = addEdge(doc, q.id, "r1", handle);
    expect(after).toBe(doc); // true no-op (same object)
    expect(after.edges.find((e) => e.source === q.id && e.source_handle === handle)!.id).toBe(before.id);
  });

  it("does NOT collapse handle-LESS edges — distinct default-vs-handled edges coexist; exact default dup deduped", () => {
    let doc = linearQuestionsDoc(); // q1 already has a handle-less default edge → q2
    const q = firstQuestion(doc);
    const handle = q.data.answers[0]!.edge_handle_id;
    doc = addEdge(doc, q.id, "r1", handle); // a handled edge alongside the default
    expect(doc.edges.some((e) => e.source === q.id && !e.source_handle && e.target === "q2")).toBe(true);
    expect(doc.edges.some((e) => e.source === q.id && e.source_handle === handle && e.target === "r1")).toBe(true);
    expect(addEdge(doc, q.id, "q2")).toBe(doc); // exact handle-less duplicate → no-op
  });
});

describe("Rec-Page §1 multi-section (setResultSectionCount / setResultStage)", () => {
  const resultNode = (doc: ReturnType<typeof linearQuestionsDoc>) =>
    doc.nodes.find((n) => n.id === "r1")!;

  it("1 section = no stages (single-section ResultView)", () => {
    const doc = setResultSectionCount(linearQuestionsDoc(), "r1", 1);
    expect((resultNode(doc).data as { stages: unknown[] }).stages).toEqual([]);
  });

  it("2 sections = exactly 2 stages, inheriting the node's bucket binding", () => {
    let doc = linearQuestionsDoc();
    // bind a bucket first so new stages inherit category_id + ladder
    doc = setResultStage(doc, "r1", 0, {}); // no-op (no stages yet)
    doc = { ...doc, nodes: doc.nodes.map((n) =>
      n.id === "r1" && n.type === "result" ? { ...n, data: { ...n.data, category_id: "cat-1" } } : n) };
    doc = setResultSectionCount(doc, "r1", 2);
    const stages = (resultNode(doc).data as { stages: { id: string; category_id?: string }[] }).stages;
    expect(stages).toHaveLength(2);
    expect(stages.every((s) => s.id.length > 0)).toBe(true);
    expect(stages.every((s) => s.category_id === "cat-1")).toBe(true);
    expect(Quiz.parse(doc)).toBeTruthy(); // round-trips
  });

  it("3 sections then back to 2 trims the extra (keeps the first two)", () => {
    let doc = setResultSectionCount(linearQuestionsDoc(), "r1", 3);
    expect((resultNode(doc).data as { stages: unknown[] }).stages).toHaveLength(3);
    const firstId = (resultNode(doc).data as { stages: { id: string }[] }).stages[0]!.id;
    doc = setResultSectionCount(doc, "r1", 2);
    const stages = (resultNode(doc).data as { stages: { id: string }[] }).stages;
    expect(stages).toHaveLength(2);
    expect(stages[0]!.id).toBe(firstId); // stable: didn't recreate section 1
  });

  it("setResultStage patches a section's sub-filter + sort + count", () => {
    let doc = setResultSectionCount(linearQuestionsDoc(), "r1", 2);
    doc = setResultStage(doc, "r1", 1, { sub_filter_tag: "toner", ranking: "newest", max_products: 6 });
    const s = (resultNode(doc).data as { stages: { sub_filter_tag?: string; ranking: string; max_products: number }[] }).stages[1]!;
    expect(s.sub_filter_tag).toBe("toner");
    expect(s.ranking).toBe("newest");
    expect(s.max_products).toBe(6);
  });

  it("setResultStage on a missing index is a no-op", () => {
    const doc = setResultSectionCount(linearQuestionsDoc(), "r1", 1);
    const same = setResultStage(doc, "r1", 5, { headline: "x" });
    expect(same).toBe(doc);
  });
});

describe("setQuestionType (QZY-3 — type changes KEEP the original answers)", () => {
  it("card → card preserves answers, mappings, and per-answer routing intact", () => {
    // Map q1.a1 to a bucket and route it to q3, then flip the type.
    let doc = linearQuestionsDoc();
    doc = setAnswerBucketDirect(doc, "q1", "q1_a1", "buk");
    doc = setAnswerRoute(doc, "q1", "q1_a1", "q3"); // edge on handle q1_h1
    expect(doc.edges.some((e) => e.source === "q1" && e.source_handle === "q1_h1")).toBe(true);

    const next = setQuestionType(doc, "q1", "multi_select");
    const q1 = next.nodes.find((n) => n.id === "q1");
    expect(q1?.type).toBe("question");
    if (q1?.type !== "question") throw new Error("q1 not a question");
    expect(q1.data.question_type).toBe("multi_select");
    expect(q1.data.text).toBe("q1"); // text preserved
    // The owner-reported bug: switching type used to REPLACE the answers
    // with placeholders. Now ids, handles, and mappings all survive.
    const before = doc.nodes.find((n) => n.id === "q1");
    if (before?.type !== "question") throw new Error("q1 not a question");
    expect(q1.data.answers.map((a) => a.id)).toEqual(before.data.answers.map((a) => a.id));
    expect(q1.data.answers[0]!.edge_handle_id).toBe("q1_h1");
    // The per-answer route edge SURVIVES the type change.
    expect(next.edges.some((e) => e.source === "q1" && e.source_handle === "q1_h1" && e.target === "q3")).toBe(true);
    // Spine edge intro→q1→q2 intact; doc round-trips.
    expect(next.edges.some((e) => e.source === "q1" && e.target === "q2" && !e.source_handle)).toBe(true);
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("card → freeform keeps the FIRST answer as the seed (identity + routing) and prunes the rest", () => {
    let doc = linearQuestionsDoc();
    doc = setAnswerRoute(doc, "q1", "q1_a1", "q3");
    const next = setQuestionType(doc, "q1", "text");
    const q1 = next.nodes.find((n) => n.id === "q1");
    if (q1?.type !== "question") throw new Error("q1 not a question");
    expect(q1.data.question_type).toBe("text");
    expect(q1.data.answers).toHaveLength(1);
    expect(q1.data.answers[0]!.id).toBe("q1_a1"); // the seed IS the old first answer
    // Its route edge survives; dropped answers' edges are pruned.
    expect(next.edges.some((e) => e.source === "q1" && e.source_handle === "q1_h1" && e.target === "q3")).toBe(true);
    expect(next.edges.some((e) => e.source === "q1" && e.source_handle === "q1_h2")).toBe(false);
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("freeform → card keeps the seed and appends a placeholder to reach ≥2", () => {
    const mid = setQuestionType(linearQuestionsDoc(), "q1", "text");
    const next = setQuestionType(mid, "q1", "single_select");
    const q1 = next.nodes.find((n) => n.id === "q1");
    if (q1?.type !== "question") throw new Error("q1 not a question");
    expect(q1.data.answers).toHaveLength(2);
    expect(q1.data.answers[0]!.id).toBe("q1_a1"); // seed survives round-trip
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("is a no-op for a non-question node and an unknown id", () => {
    const doc = linearQuestionsDoc();
    expect(setQuestionType(doc, "intro", "single_select")).toBe(doc);
    expect(setQuestionType(doc, "nope", "single_select")).toBe(doc);
  });
});

describe("LOGIC v2 role/target mutations (setQuestionRole / setAnswerTarget)", () => {
  // A decider-model doc: q1 decides, q2/q3 qualifiers.
  function deciderDoc() {
    let doc = Quiz.parse({ ...linearQuestionsDoc(), logic_model: "decider" });
    doc = setQuestionRole(doc, "q1", "decides");
    return doc;
  }
  const qOf = (doc: ReturnType<typeof linearQuestionsDoc>, id: string) => {
    const n = doc.nodes.find((x) => x.id === id);
    if (n?.type !== "question") throw new Error(`${id} not a question`);
    return n;
  };

  it("setQuestionRole('decides') is EXCLUSIVE — promoting q2 demotes q1 — and forces required=true", () => {
    let doc = deciderDoc();
    // Make q2 optional first so the forced-required is observable.
    doc = Quiz.parse({
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "q2" && n.type === "question" ? { ...n, data: { ...n.data, required: false } } : n,
      ),
    });
    const next = setQuestionRole(doc, "q2", "decides");
    expect(qOf(next, "q2").data.role).toBe("decides");
    expect(qOf(next, "q2").data.required).toBe(true); // V3 auto-enforced
    expect(qOf(next, "q1").data.role).toBe("qualifier"); // demoted — exactly one decider (V1)
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("setQuestionRole('decides') no-ops on a multi-select question (§2.2)", () => {
    let doc = deciderDoc();
    doc = setQuestionType(doc, "q2", "multi_select");
    const next = setQuestionRole(doc, "q2", "decides");
    expect(next).toBe(doc); // identity — nothing changed
    expect(qOf(next, "q1").data.role).toBe("decides"); // the existing decider untouched
  });

  it("setQuestionRole('decides') no-ops on a FREEFORM question (no discrete answers to map)", () => {
    let doc = deciderDoc();
    doc = setQuestionType(doc, "q2", "text");
    expect(setQuestionRole(doc, "q2", "decides")).toBe(doc);
  });

  it("setQuestionRole / setAnswerTarget no-op on a LEGACY doc (logic_model unset — byte-stability)", () => {
    const legacy = linearQuestionsDoc();
    expect(setQuestionRole(legacy, "q1", "decides")).toBe(legacy);
    expect(setAnswerTarget(legacy, "q1", "q1_a1", "cat_x")).toBe(legacy);
  });

  it("setQuestionRole('qualifier') demotes without touching required, and no-ops on non-questions", () => {
    const doc = deciderDoc();
    const next = setQuestionRole(doc, "q1", "qualifier");
    expect(qOf(next, "q1").data.role).toBe("qualifier");
    expect(qOf(next, "q1").data.required).toBe(true); // left as-is, not force-cleared
    expect(setQuestionRole(doc, "intro", "decides")).toBe(doc);
    expect(setQuestionRole(doc, "nope", "decides")).toBe(doc);
  });

  it("setAnswerTarget maps a deciding answer to a target; null clears via key removal (absent-when-unset)", () => {
    const doc = deciderDoc();
    const mapped = setAnswerTarget(doc, "q1", "q1_a1", "cat_park");
    const a1 = qOf(mapped, "q1").data.answers.find((a) => a.id === "q1_a1");
    expect(a1?.target_id).toBe("cat_park");
    // The sibling answer is untouched.
    const a2 = qOf(mapped, "q1").data.answers.find((a) => a.id === "q1_a2");
    expect(a2 && "target_id" in a2 && a2.target_id !== undefined).toBe(false);

    const cleared = setAnswerTarget(mapped, "q1", "q1_a1", null);
    const a1c = qOf(cleared, "q1").data.answers.find((a) => a.id === "q1_a1");
    // The KEY must be gone (byte-stability: absent-when-unset on the wire).
    expect(a1c && Object.prototype.hasOwnProperty.call(a1c, "target_id")).toBe(false);
    expect(() => Quiz.parse(cleared)).not.toThrow();

    // No-ops: unknown node / non-question.
    expect(setAnswerTarget(doc, "nope", "q1_a1", "x")).toBe(doc);
    expect(setAnswerTarget(doc, "intro", "q1_a1", "x")).toBe(doc);
  });

  it("setQuestionType(→multi_select) auto-demotes a DECIDING question to qualifier in the same mutation", () => {
    const doc = deciderDoc();
    const next = setQuestionType(doc, "q1", "multi_select");
    expect(qOf(next, "q1").data.role).toBe("qualifier"); // §2.2 — no decides+multi_select state ever exists
    expect(qOf(next, "q1").data.question_type).toBe("multi_select");
    // A qualifier switching to multi_select keeps its role untouched.
    const q2Multi = setQuestionType(setQuestionRole(doc, "q2", "qualifier"), "q2", "multi_select");
    expect(qOf(q2Multi, "q2").data.role).toBe("qualifier");
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("setQuestionType(→FREEFORM) also auto-demotes the decider (the same predicate as setQuestionRole)", () => {
    // Without this, switching the decider to Open text would strand a role="decides"
    // freeform question — a state setQuestionRole itself refuses to create.
    const doc = deciderDoc();
    const next = setQuestionType(doc, "q1", "text");
    expect(qOf(next, "q1").data.role).toBe("qualifier");
    expect(qOf(next, "q1").data.question_type).toBe("text");
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  describe("LOGIC v2 §4 decision-rule mutations (priority = array order)", () => {
    const cond = (q: string, a: string, op: "is" | "is_not" = "is") => ({
      question_id: q,
      answer_id: a,
      op,
    });

    it("addDecisionRule appends at the BOTTOM with zero conditions + the seeded target; parse-safe", () => {
      let doc = addDecisionRule(deciderDoc(), "cat_a");
      doc = addDecisionRule(doc, "cat_b");
      expect(doc.decision_rules).toHaveLength(2);
      expect(doc.decision_rules![0]!.target_id).toBe("cat_a");
      expect(doc.decision_rules![1]!.target_id).toBe("cat_b"); // appended below
      expect(doc.decision_rules![0]!.conditions).toEqual([]); // half-built — never fires (V9)
      expect(doc.decision_rules![0]!.id).not.toBe(doc.decision_rules![1]!.id);
      expect(() => Quiz.parse(doc)).not.toThrow();
      // Empty target seed refused (schema requires min(1)).
      expect(addDecisionRule(deciderDoc(), "")).toEqual(deciderDoc());
    });

    it("moveDecisionRule reorders (priority!) with clamping; unknown id no-ops", () => {
      let doc = addDecisionRule(deciderDoc(), "cat_a");
      doc = addDecisionRule(doc, "cat_b");
      doc = addDecisionRule(doc, "cat_c");
      const [r1, r2, r3] = doc.decision_rules!.map((r) => r.id);
      const up = moveDecisionRule(doc, r3!, 0);
      expect(up.decision_rules!.map((r) => r.id)).toEqual([r3, r1, r2]);
      const clamped = moveDecisionRule(doc, r1!, 99);
      expect(clamped.decision_rules!.map((r) => r.id)).toEqual([r2, r3, r1]);
      expect(moveDecisionRule(doc, "nope", 0)).toBe(doc);
      expect(moveDecisionRule(doc, r2!, 1)).toBe(doc); // same index — identity
    });

    it("updateDecisionRule patches conditions/target; empty target ignored; removeDecisionRule deletes", () => {
      let doc = addDecisionRule(deciderDoc(), "cat_a");
      const id = doc.decision_rules![0]!.id;
      doc = updateDecisionRule(doc, id, {
        conditions: [cond("q1", "q1_a1"), cond("q2", "q2_a2", "is_not")],
        target_id: "cat_z",
      });
      expect(doc.decision_rules![0]!.conditions).toHaveLength(2);
      expect(doc.decision_rules![0]!.target_id).toBe("cat_z");
      // Empty-string target patch is ignored (schema min(1)).
      const kept = updateDecisionRule(doc, id, { target_id: "" });
      expect(kept.decision_rules![0]!.target_id).toBe("cat_z");
      expect(() => Quiz.parse(doc)).not.toThrow();
      const gone = removeDecisionRule(doc, id);
      expect(gone.decision_rules).toEqual([]);
      expect(removeDecisionRule(doc, "nope")).toBe(doc);
    });

    it("all four no-op on a LEGACY doc (logic_model unset — byte-stability)", () => {
      const legacy = linearQuestionsDoc();
      expect(addDecisionRule(legacy, "cat_a")).toBe(legacy);
      expect(removeDecisionRule(legacy, "r1")).toBe(legacy);
      expect(moveDecisionRule(legacy, "r1", 0)).toBe(legacy);
      expect(updateDecisionRule(legacy, "r1", { target_id: "x" })).toBe(legacy);
    });

    // Logic tab (HANDOFF G1/G4/G7) — the widened patch surface.
    it("updateDecisionRule: target_ids writes multi-target + mirrors [0] into target_id (G1)", () => {
      let doc = addDecisionRule(deciderDoc(), "cat_a");
      const id = doc.decision_rules![0]!.id;
      doc = updateDecisionRule(doc, id, { target_ids: ["cat_x", "cat_y"] });
      expect(doc.decision_rules![0]!.target_ids).toEqual(["cat_x", "cat_y"]);
      expect(doc.decision_rules![0]!.target_id).toBe("cat_x"); // the mirror
      // A plain target_id write returns to the single-target form.
      doc = updateDecisionRule(doc, id, { target_id: "cat_z" });
      expect(doc.decision_rules![0]!.target_id).toBe("cat_z");
      expect(
        Object.prototype.hasOwnProperty.call(doc.decision_rules![0], "target_ids"),
      ).toBe(false);
      // Empty target_ids ignored.
      const kept = updateDecisionRule(doc, id, { target_ids: [] });
      expect(kept.decision_rules![0]!.target_id).toBe("cat_z");
      // Length-1 normalizes to the single-target byte-form (one canonical
      // representation — same as createDecisionRule).
      const one = updateDecisionRule(
        updateDecisionRule(doc, id, { target_ids: ["cat_x", "cat_y"] }),
        id,
        { target_ids: ["cat_w"] },
      );
      expect(one.decision_rules![0]!.target_id).toBe("cat_w");
      expect(
        Object.prototype.hasOwnProperty.call(one.decision_rules![0], "target_ids"),
      ).toBe(false);
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("updateDecisionRule: action uses PRESENCE semantics — set, clear, untouched (G4/G7)", () => {
      let doc = addDecisionRule(deciderDoc(), "cat_a");
      const id = doc.decision_rules![0]!.id;
      doc = updateDecisionRule(doc, id, { action: "hide" }); // UI "Exclude"
      expect(doc.decision_rules![0]!.action).toBe("hide");
      // Omitting the key leaves it untouched…
      doc = updateDecisionRule(doc, id, { target_id: "cat_b" });
      expect(doc.decision_rules![0]!.action).toBe("hide");
      // …while an explicit undefined CLEARS it (UI "Show" = replace = absent).
      doc = updateDecisionRule(doc, id, { action: undefined });
      expect(
        Object.prototype.hasOwnProperty.call(doc.decision_rules![0], "action"),
      ).toBe(false);
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("createDecisionRule builds a complete rule; blocks zero conditions / zero targets (§4.5)", () => {
      const base = deciderDoc();
      const doc = createDecisionRule(base, {
        conditions: [cond("q1", "q1_a1")],
        target_ids: ["cat_a", "cat_b"],
        action: "show", // UI "Highlight"
      });
      expect(doc.decision_rules).toHaveLength(1);
      const r = doc.decision_rules![0]!;
      expect(r.conditions).toHaveLength(1);
      expect(r.target_id).toBe("cat_a");
      expect(r.target_ids).toEqual(["cat_a", "cat_b"]);
      expect(r.action).toBe("show");
      // Single-target stores ONLY target_id (the parse-forever form).
      const single = createDecisionRule(base, {
        conditions: [cond("q1", "q1_a1")],
        target_ids: ["cat_a"],
      });
      const sr = single.decision_rules![0]!;
      expect(sr.target_id).toBe("cat_a");
      expect(Object.prototype.hasOwnProperty.call(sr, "target_ids")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(sr, "action")).toBe(false);
      // The modal's gate, enforced at the mutation layer too.
      expect(createDecisionRule(base, { conditions: [], target_ids: ["cat_a"] })).toBe(base);
      expect(
        createDecisionRule(base, { conditions: [cond("q1", "q1_a1")], target_ids: [] }),
      ).toBe(base);
      const legacy = linearQuestionsDoc();
      expect(
        createDecisionRule(legacy, {
          conditions: [cond("q1", "q1_a1")],
          target_ids: ["cat_a"],
        }),
      ).toBe(legacy); // legacy no-op — identity

      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    // Logic-step handoff §3 — match / any_of, canonical-absent discipline.
    it("match/any_of: canonical defaults stay ABSENT; presence semantics on update", () => {
      const base = deciderDoc();
      const plain = createDecisionRule(base, {
        conditions: [cond("q1", "q1_a1")],
        target_ids: ["cat_a"],
        match: "all", // canonical default → must not be stored
        any_of: [],
      });
      const pr = plain.decision_rules![0]!;
      expect(Object.prototype.hasOwnProperty.call(pr, "match")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(pr, "any_of")).toBe(false);

      const rich = createDecisionRule(base, {
        conditions: [cond("q1", "q1_a1"), cond("q1", "q1_a2")],
        target_ids: ["cat_a"],
        match: "any",
        any_of: ["q1"],
      });
      const rr = rich.decision_rules![0]!;
      expect(rr.match).toBe("any");
      expect(rr.any_of).toEqual(["q1"]);
      expect(() => Quiz.parse(rich)).not.toThrow();

      // update: set, then clear back to the absent byte-form.
      let doc = updateDecisionRule(rich, rr.id, { match: undefined, any_of: [] });
      expect(Object.prototype.hasOwnProperty.call(doc.decision_rules![0], "match")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(doc.decision_rules![0], "any_of")).toBe(false);
      doc = updateDecisionRule(doc, rr.id, { match: "any", any_of: ["q1"] });
      expect(doc.decision_rules![0]!.match).toBe("any");
      expect(doc.decision_rules![0]!.any_of).toEqual(["q1"]);
      // Omitting the keys leaves them untouched.
      doc = updateDecisionRule(doc, rr.id, { target_id: "cat_b" });
      expect(doc.decision_rules![0]!.match).toBe("any");
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    // Logic-step handoff §12 — duplicate inserts DIRECTLY BELOW the original.
    it("duplicateDecisionRule: copy directly below, fresh id, deep-cloned arrays", () => {
      let doc = addDecisionRule(deciderDoc(), "cat_a");
      doc = addDecisionRule(doc, "cat_b");
      const [r1] = doc.decision_rules!;
      doc = updateDecisionRule(doc, r1!.id, {
        conditions: [cond("q1", "q1_a1"), cond("q1", "q1_a2")],
        target_ids: ["cat_x", "cat_y"],
        any_of: ["q1"],
      });
      const dup = duplicateDecisionRule(doc, r1!.id);
      expect(dup.decision_rules).toHaveLength(3);
      const [orig, copy, tail] = dup.decision_rules!;
      expect(copy!.id).not.toBe(orig!.id);
      expect(tail!.target_id).toBe("cat_b"); // the copy sits at index 1, not the end
      expect(copy!.conditions).toEqual(orig!.conditions);
      expect(copy!.conditions).not.toBe(orig!.conditions);
      expect(copy!.target_ids).toEqual(orig!.target_ids);
      expect(copy!.target_ids).not.toBe(orig!.target_ids);
      expect(copy!.any_of).toEqual(orig!.any_of);
      expect(copy!.any_of).not.toBe(orig!.any_of);
      expect(() => Quiz.parse(dup)).not.toThrow();
      // Unknown id / legacy doc → identity no-op.
      expect(duplicateDecisionRule(doc, "nope")).toBe(doc);
      const legacy = linearQuestionsDoc();
      expect(duplicateDecisionRule(legacy, "r1")).toBe(legacy);
    });
  });

  // Logic tab (HANDOFF §5/§6) — filter-question mapping mutations.
  describe("setAnswerFilterValues / setQuestionNarrowField", () => {
    const answersOf = (doc: ReturnType<typeof linearQuestionsDoc>, q: string) => {
      const n = doc.nodes.find((x) => x.id === q);
      if (n?.type !== "question") throw new Error("not a question");
      return n.data.answers;
    };

    it("setAnswerFilterValues is a FULL-SET write: absent keys clear their storage", () => {
      let doc = setQuestionRole(deciderDoc(), "q2", "filter");
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", {
        tags: ["soft"],
        collection_filters: ["c1", "c2"],
        metafield_filters: [{ key: "custom.fit", value: "slim" }],
      });
      let a = answersOf(doc, "q2").find((x) => x.id === "q2_a1")!;
      expect(a.tags).toEqual(["soft"]);
      expect(a.collection_filters).toEqual(["c1", "c2"]);
      expect(a.metafield_filters).toEqual([{ key: "custom.fit", value: "slim" }]);
      // Now write tags only — the other stores must CLEAR (key-absent).
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", { tags: ["stiff"] });
      a = answersOf(doc, "q2").find((x) => x.id === "q2_a1")!;
      expect(a.tags).toEqual(["stiff"]);
      expect(Object.prototype.hasOwnProperty.call(a, "collection_filters")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(a, "metafield_filters")).toBe(false);
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("no_preference: true ('Keeps everything') clears every value; values clear it back", () => {
      let doc = setQuestionRole(deciderDoc(), "q2", "filter");
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", { tags: ["soft"] });
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", { no_preference: true });
      let a = answersOf(doc, "q2").find((x) => x.id === "q2_a1")!;
      expect(a.no_preference).toBe(true);
      expect(a.tags).toEqual([]);
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", { tags: ["wide"] });
      a = answersOf(doc, "q2").find((x) => x.id === "q2_a1")!;
      expect(Object.prototype.hasOwnProperty.call(a, "no_preference")).toBe(false);
      expect(a.tags).toEqual(["wide"]);
    });

    it("setQuestionNarrowField: choosing a DIFFERENT field clears every answer's values (§6.1)", () => {
      let doc = setQuestionRole(deciderDoc(), "q2", "filter");
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", {
        tags: ["fit:slim"],
        collection_filters: ["c1"],
      });
      doc = setQuestionNarrowField(doc, "q2", "tag:fit");
      const q2 = doc.nodes.find((n) => n.id === "q2");
      expect(q2?.type === "question" && q2.data.narrow_field).toBe("tag:fit");
      // Same field again — identity (values kept).
      expect(setQuestionNarrowField(doc, "q2", "tag:fit")).toBe(doc);
      // Switch fields → values wiped.
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", { tags: ["fit:slim"] });
      doc = setQuestionNarrowField(doc, "q2", "mf:custom.gender");
      const a = answersOf(doc, "q2").find((x) => x.id === "q2_a1")!;
      expect(a.tags).toEqual([]);
      expect(Object.prototype.hasOwnProperty.call(a, "collection_filters")).toBe(false);
      // Clearing to Anything (null) KEEPS values (they're a valid arbitrary mix)…
      doc = setAnswerFilterValues(doc, "q2", "q2_a1", { tags: ["soft"] });
      doc = setQuestionNarrowField(doc, "q2", null);
      const q2b = doc.nodes.find((n) => n.id === "q2");
      expect(
        q2b?.type === "question" &&
          Object.prototype.hasOwnProperty.call(q2b.data, "narrow_field"),
      ).toBe(false);
      expect(answersOf(doc, "q2").find((x) => x.id === "q2_a1")!.tags).toEqual(["soft"]);
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("both no-op on a LEGACY doc (byte-stability)", () => {
      const legacy = linearQuestionsDoc();
      expect(setAnswerFilterValues(legacy, "q1", "q1_a1", { tags: ["x"] })).toBe(legacy);
      expect(setQuestionNarrowField(legacy, "q1", "tag:fit")).toBe(legacy);
    });
  });

  describe("rec-page-spec-V2 §3 — rec_page_settings mutations (SPARSE writes)", () => {
    it("setRecPageGlobal writes only set fields; undefined clears; empty settings DROP the root key", () => {
      let doc = setRecPageGlobal(deciderDoc(), { headline: "Custom", gridMax: 5 });
      expect(doc.rec_page_settings?.global).toEqual({ headline: "Custom", gridMax: 5 });
      // Clear one field (back to the read-time default).
      doc = setRecPageGlobal(doc, { gridMax: undefined });
      expect(doc.rec_page_settings?.global).toEqual({ headline: "Custom" });
      expect(Object.prototype.hasOwnProperty.call(doc.rec_page_settings!.global, "gridMax")).toBe(false);
      // Clear the last field → the ROOT key vanishes (absent-when-unset).
      doc = setRecPageGlobal(doc, { headline: undefined });
      expect(Object.prototype.hasOwnProperty.call(doc, "rec_page_settings")).toBe(false);
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("§7.1 capture normalization: email OFF drops name/phone keys (they require an email)", () => {
      // Name/phone stored while email is (default) ON.
      let doc = setRecPageGlobal(deciderDoc(), { captureName: true, capturePhone: true });
      expect(doc.rec_page_settings?.global).toEqual({ captureName: true, capturePhone: true });
      // Turning email OFF normalizes name/phone away — even without the
      // panel's atomic clear (defense at the mutation seam).
      doc = setRecPageGlobal(doc, { captureEmail: false });
      expect(doc.rec_page_settings?.global).toEqual({ captureEmail: false });
      // While email is off, a name/phone write is dropped by the normalizer.
      doc = setRecPageGlobal(doc, { capturePhone: true });
      expect(doc.rec_page_settings?.global).toEqual({ captureEmail: false });
      // Email back ON = the key goes ABSENT (sparse: default is true), and
      // clearing the last key drops the root (absent-when-unset).
      doc = setRecPageGlobal(doc, { captureEmail: undefined });
      expect(Object.prototype.hasOwnProperty.call(doc, "rec_page_settings")).toBe(false);
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("§8.2 whyCopyLocked stores sparse: true kept, unlock drops the key (root-droppable)", () => {
      let doc = setRecPageGlobal(deciderDoc(), { whyCopyLocked: true });
      expect(doc.rec_page_settings?.global).toEqual({ whyCopyLocked: true });
      doc = setRecPageGlobal(doc, { whyCopyLocked: undefined });
      expect(Object.prototype.hasOwnProperty.call(doc, "rec_page_settings")).toBe(false);
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("setRecPageOverride keeps overrides sparse per target; emptying one removes it (inherit again)", () => {
      let doc = setRecPageOverride(deciderDoc(), "cat_a", { headline: "Just for A" });
      doc = setRecPageOverride(doc, "cat_b", { incentiveOn: true, incentiveCode: "SAVE10" });
      expect(doc.rec_page_settings?.overrides).toEqual({
        cat_a: { headline: "Just for A" },
        cat_b: { incentiveOn: true, incentiveCode: "SAVE10" },
      });
      // Empty cat_a's override → the target key vanishes; cat_b untouched.
      doc = setRecPageOverride(doc, "cat_a", { headline: undefined });
      expect(doc.rec_page_settings?.overrides).toEqual({
        cat_b: { incentiveOn: true, incentiveCode: "SAVE10" },
      });
      // removeRecPageOverride drops the whole override (toggle OFF).
      doc = removeRecPageOverride(doc, "cat_b");
      expect(Object.prototype.hasOwnProperty.call(doc, "rec_page_settings")).toBe(false);
      expect(removeRecPageOverride(doc, "nope")).toBe(doc); // identity when absent
      expect(() => Quiz.parse(doc)).not.toThrow();
    });

    it("global + overrides coexist independently; all three no-op on a LEGACY doc", () => {
      let doc = setRecPageGlobal(deciderDoc(), { heroLogic: "bestseller" });
      doc = setRecPageOverride(doc, "cat_a", { heroLogic: "newest" });
      expect(doc.rec_page_settings?.global).toEqual({ heroLogic: "bestseller" });
      expect(doc.rec_page_settings?.overrides?.cat_a).toEqual({ heroLogic: "newest" });
      // Removing the override keeps the global.
      doc = removeRecPageOverride(doc, "cat_a");
      expect(doc.rec_page_settings?.global).toEqual({ heroLogic: "bestseller" });
      expect(doc.rec_page_settings?.overrides).toEqual({});
      const legacy = linearQuestionsDoc();
      expect(setRecPageGlobal(legacy, { headline: "x" })).toBe(legacy);
      expect(setRecPageOverride(legacy, "cat_a", { headline: "x" })).toBe(legacy);
      expect(removeRecPageOverride(legacy, "cat_a")).toBe(legacy);
    });
  });
});

// ── QZY-13 — the "content page" conversion (owner supplement) ────────────────

describe("convertQuestionToMessage", () => {
  const doc = () =>
    Quiz.parse({
      quiz_id: "qz",
      scope: { collection_ids: [] },
      logic_model: "decider",
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 0, y: 0 },
          data: {
            text: "Anything else?",
            question_type: "single_select",
            role: "qualifier",
            answers: [
              { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
            ],
          },
        },
        {
          id: "qd",
          type: "question",
          position: { x: 0, y: 0 },
          data: {
            text: "Pick",
            question_type: "single_select",
            required: true,
            role: "decides",
            answers: [
              { id: "d1", text: "X", tags: [], edge_handle_id: "h3", target_id: "cat1" },
              { id: "d2", text: "Y", tags: [], edge_handle_id: "h4", target_id: "cat1" },
            ],
          },
        },
        { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "R", fallback_collection_id: "c" } },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "qd", source_handle: "h1" },
        { id: "e2b", source: "q1", target: "qd", source_handle: "h2" },
        { id: "e3", source: "qd", target: "r1" },
      ],
      results_pages: [],
    });

  it("converts in place: same id, text carried, per-answer edges collapse to ONE", () => {
    const next = convertQuestionToMessage(doc(), "q1");
    const msg = next.nodes.find((n) => n.id === "q1");
    expect(msg?.type).toBe("message");
    expect(msg?.type === "message" && msg.data.text).toBe("Anything else?");
    const outbound = next.edges.filter((e) => e.source === "q1");
    expect(outbound.length).toBe(1);
    expect(outbound[0]?.target).toBe("qd");
    expect(outbound[0]?.source_handle ?? undefined).toBeUndefined();
    // Inbound edge intact (same node id).
    expect(next.edges.some((e) => e.source === "intro" && e.target === "q1")).toBe(true);
  });

  it("refuses on the deciding question (single-decider invariant)", () => {
    const d = doc();
    expect(convertQuestionToMessage(d, "qd")).toBe(d);
  });
});

describe("duplicateLayoutBlock (QRTZ-S4 — floating block toolbar)", () => {
  const withLayout = () => {
    const base = linearQuestionsDoc();
    return Quiz.parse({
      ...base,
      node_layouts: {
        intro: [
          { id: "b1", type: "heading", level: "h2", bind: "none", text: "Hi", style: {} },
          { id: "b2", type: "text", bind: "none", text: "Body", supports_merge_tags: false, style: { margin_top: 18 } },
          { id: "b3", type: "button", label: "Start", variant: "primary", style: {} },
        ],
      },
    });
  };

  it("splices a deep copy with a fresh id right after the original", () => {
    const next = duplicateLayoutBlock(withLayout(), "intro", "b2");
    const layout = next.node_layouts["intro"]!;
    expect(layout.length).toBe(4);
    const copy = layout[2]!;
    expect(layout.map((b) => b.id).slice(0, 2)).toEqual(["b1", "b2"]);
    expect(layout[3]!.id).toBe("b3");
    expect(copy.id).not.toBe("b2");
    expect(copy.type).toBe("text");
    expect(copy.type === "text" && copy.text).toBe("Body");
    expect(copy.style.margin_top).toBe(18);
    // Deep copy — mutating the clone's style must not touch the original.
    expect(copy.style).not.toBe(layout[1]!.style);
    // Result still parses as a valid Quiz doc.
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("is a no-op on an on-template node (never synthesizes a layout)", () => {
    const d = withLayout();
    expect(duplicateLayoutBlock(d, "q1", "b1")).toBe(d);
    expect(d.node_layouts["q1"]).toBeUndefined();
  });

  it("is a no-op for an unknown block id", () => {
    const d = withLayout();
    expect(duplicateLayoutBlock(d, "intro", "nope")).toBe(d);
  });
});
