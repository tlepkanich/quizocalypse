import { describe, it, expect } from "vitest";
import { clampQuestionsTo } from "./questionCountClamp";

const q = (id: string, role?: "decides" | "narrows" | "info") => ({ id, ...(role ? { role } : {}) });

describe("clampQuestionsTo", () => {
  it("trims extra questions from the end", () => {
    expect(clampQuestionsTo([q("a"), q("b"), q("c"), q("d")], 2).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("never removes the deciding question, even when it comes last", () => {
    const out = clampQuestionsTo([q("a", "narrows"), q("b", "info"), q("c", "decides")], 2);
    expect(out.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("keeps order and the decider when trimming several", () => {
    const out = clampQuestionsTo(
      [q("n1", "narrows"), q("d", "decides"), q("n2", "narrows"), q("i1", "info"), q("i2", "info")],
      3,
    );
    expect(out.map((x) => x.id)).toEqual(["n1", "d", "n2"]);
  });

  it("returns a short set unchanged", () => {
    expect(clampQuestionsTo([q("a"), q("b")], 5).map((x) => x.id)).toEqual(["a", "b"]);
  });
});
