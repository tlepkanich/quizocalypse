import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  setAnswerRoute,
  setSlotWeight,
  setBranchMode,
  promoteAbWinner,
  deleteNode,
  duplicateQuestionNode,
  insertQuestionRelative,
  moveStep,
  straightThroughRun,
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
});
