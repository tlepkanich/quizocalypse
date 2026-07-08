import { describe, expect, it } from "vitest";
import { blockMove, blockReorder } from "./studioDoc";
import type { ContentBlock } from "../../lib/quizSchema";

// A minimal block list — only `id`/`type` matter for the ordering logic.
const list = (...ids: string[]): ContentBlock[] =>
  ids.map((id) => ({ id, type: "text", text: id }) as unknown as ContentBlock);
const ids = (bs: ContentBlock[]) => bs.map((b) => b.id);

describe("blockReorder (BT4 drag-to-reorder)", () => {
  it("moves a block down to sit before the drop target", () => {
    // drag A onto C's slot → A lands just before C.
    expect(ids(blockReorder(list("A", "B", "C", "D"), "A", 2))).toEqual([
      "B",
      "A",
      "C",
      "D",
    ]);
  });

  it("moves a block up to the drop target", () => {
    expect(ids(blockReorder(list("A", "B", "C", "D"), "D", 1))).toEqual([
      "A",
      "D",
      "B",
      "C",
    ]);
  });

  it("dropping onto the first row moves a block to the top", () => {
    expect(ids(blockReorder(list("A", "B", "C"), "C", 0))).toEqual(["C", "A", "B"]);
  });

  it("dropping onto its own index is a no-op ordering", () => {
    expect(ids(blockReorder(list("A", "B", "C"), "B", 1))).toEqual(["A", "B", "C"]);
  });

  it("an unknown id returns the list unchanged (never throws)", () => {
    const l = list("A", "B");
    expect(blockReorder(l, "Z", 0)).toBe(l);
  });

  it("clamps an out-of-range target index to the end", () => {
    expect(ids(blockReorder(list("A", "B", "C"), "A", 99))).toEqual(["B", "C", "A"]);
  });

  it("dropping a block just before its next neighbour is a no-op (insert-before semantics)", () => {
    // B is already immediately before C, so 'drop B before C' changes nothing.
    expect(ids(blockReorder(list("A", "B", "C"), "B", 2))).toEqual(["A", "B", "C"]);
  });

  it("preserves the full set — no block is dropped or duplicated", () => {
    const out = blockReorder(list("A", "B", "C", "D"), "B", 3);
    expect(ids(out).sort()).toEqual(["A", "B", "C", "D"]);
    expect(out).toHaveLength(4);
    // blockMove is the single-step cousin; both keep the set intact.
    expect(ids(blockMove(list("A", "B", "C"), "A", 1)).sort()).toEqual(["A", "B", "C"]);
  });
});
