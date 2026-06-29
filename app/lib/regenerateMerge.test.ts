import { describe, expect, it } from "vitest";
import type { Answer } from "./quizSchema";
import { mergeRegeneratedAnswers, type RegeneratedAnswer } from "./regenerateMerge";

function ans(over: Partial<Answer> & { id: string; text: string; edge_handle_id: string }): Answer {
  return { tags: [], ...over } as Answer;
}

// Deterministic fresh-id/handle generators so the test is reproducible.
function gen(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe("mergeRegeneratedAnswers", () => {
  it("carries points + points_alt onto answers whose TEXT the AI kept unchanged; drops them when reworded", () => {
    const old: Answer[] = [
      ans({ id: "a1", edge_handle_id: "h1", text: "Deep Powder", points: { snow: 1 }, points_alt: { snow: 3 } }),
      ans({ id: "a2", edge_handle_id: "h2", text: "Groomed Runs", points: { groom: 1 } }),
    ];
    const fresh: RegeneratedAnswer[] = [
      { text: "Deep Powder", tags: ["powder"] }, // unchanged text → carry
      { text: "Carving groomers", tags: ["groom"] }, // reworded → drop
    ];
    const merged = mergeRegeneratedAnswers(old, fresh, gen("a_"), gen("h_"));
    expect(merged).toHaveLength(2);
    // unchanged-text answer keeps BOTH scoring models + reuses id/handle by index
    expect(merged[0]).toMatchObject({ id: "a1", edge_handle_id: "h1", text: "Deep Powder", points: { snow: 1 }, points_alt: { snow: 3 } });
    // reworded answer: text from AI, NO points (dropped), id/handle still reused by index
    expect(merged[1]).toMatchObject({ id: "a2", edge_handle_id: "h2", text: "Carving groomers" });
    expect(merged[1]!.points).toBeUndefined();
    expect(merged[1]!.points_alt).toBeUndefined();
  });

  it("matches text case- and whitespace-insensitively (normalized carry key)", () => {
    const old: Answer[] = [ans({ id: "a1", edge_handle_id: "h1", text: "  Deep Powder ", points: { snow: 2 } })];
    const fresh: RegeneratedAnswer[] = [{ text: "deep powder", tags: [] }];
    const merged = mergeRegeneratedAnswers(old, fresh, gen("a_"), gen("h_"));
    expect(merged[0]!.points).toEqual({ snow: 2 });
  });

  it("uses the NEW answer's text/tags/collection_filter/image_url, not the old", () => {
    const old: Answer[] = [ans({ id: "a1", edge_handle_id: "h1", text: "Old", tags: ["old"], image_url: "old.png" })];
    const fresh: RegeneratedAnswer[] = [
      { text: "New", tags: ["new"], collection_filter: "gid://c", image_url: "new.png" },
    ];
    const merged = mergeRegeneratedAnswers(old, fresh, gen("a_"), gen("h_"));
    expect(merged[0]).toMatchObject({ text: "New", tags: ["new"], collection_filter: "gid://c", image_url: "new.png" });
  });

  it("when the AI returns MORE answers than before, the extras get FRESH id + handle (no points)", () => {
    const old: Answer[] = [ans({ id: "a1", edge_handle_id: "h1", text: "One", points: { x: 1 } })];
    const fresh: RegeneratedAnswer[] = [
      { text: "One", tags: [] },
      { text: "Two", tags: [] },
      { text: "Three", tags: [] },
    ];
    const merged = mergeRegeneratedAnswers(old, fresh, gen("a_"), gen("h_"));
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ id: "a1", edge_handle_id: "h1", points: { x: 1 } });
    // the two extras get the injected fresh ids/handles, no points
    expect(merged[1]).toMatchObject({ id: "a_1", edge_handle_id: "h_1" });
    expect(merged[2]).toMatchObject({ id: "a_2", edge_handle_id: "h_2" });
    expect(merged[1]!.points).toBeUndefined();
    expect(merged[2]!.points).toBeUndefined();
  });

  it("when the AI returns FEWER answers, only the new count remains, reusing ids by index", () => {
    const old: Answer[] = [
      ans({ id: "a1", edge_handle_id: "h1", text: "One", points: { x: 1 } }),
      ans({ id: "a2", edge_handle_id: "h2", text: "Two", points: { y: 1 } }),
      ans({ id: "a3", edge_handle_id: "h3", text: "Three" }),
    ];
    const fresh: RegeneratedAnswer[] = [{ text: "One", tags: [] }, { text: "Two", tags: [] }];
    const merged = mergeRegeneratedAnswers(old, fresh, gen("a_"), gen("h_"));
    expect(merged.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(merged[0]!.points).toEqual({ x: 1 });
    expect(merged[1]!.points).toEqual({ y: 1 });
  });

  it("REORDER asymmetry: id/handle follow INDEX (positional) while points follow TEXT", () => {
    const old: Answer[] = [
      ans({ id: "a1", edge_handle_id: "h1", text: "Alpha", points: { a: 1 } }),
      ans({ id: "a2", edge_handle_id: "h2", text: "Beta", points: { b: 1 } }),
    ];
    // AI swaps the order: Beta first, Alpha second.
    const fresh: RegeneratedAnswer[] = [{ text: "Beta", tags: [] }, { text: "Alpha", tags: [] }];
    const merged = mergeRegeneratedAnswers(old, fresh, gen("a_"), gen("h_"));
    expect(merged).toHaveLength(2);
    // index 0 reuses a1/h1 (positional) but carries Beta's points (text-keyed)
    expect(merged[0]).toMatchObject({ id: "a1", edge_handle_id: "h1", text: "Beta", points: { b: 1 } });
    // index 1 reuses a2/h2 but carries Alpha's points
    expect(merged[1]).toMatchObject({ id: "a2", edge_handle_id: "h2", text: "Alpha", points: { a: 1 } });
  });
});
