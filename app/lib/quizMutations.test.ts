import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { setSlotWeight, setBranchMode } from "./quizMutations";

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
