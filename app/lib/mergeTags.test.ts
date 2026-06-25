import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { buildMergeContext, resolveMergeTags, resolveCopyTokens } from "./mergeTags";

const docFixture = Quiz.parse({
  quiz_id: "q_merge",
  scope: { collection_ids: [] },
  nodes: [
    {
      id: "intro",
      type: "intro",
      position: { x: 0, y: 0 },
      data: { headline: "Welcome" },
    },
    {
      id: "q1",
      type: "question",
      position: { x: 100, y: 0 },
      data: {
        text: "Skin?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "Oily", tags: [], edge_handle_id: "h1" },
          { id: "a2", text: "Dry", tags: [], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "m1",
      type: "message",
      position: { x: 200, y: 0 },
      data: { text: "Hi @name — skin is @answer.q1" },
    },
  ],
  edges: [],
});

describe("buildMergeContext", () => {
  it("maps picked answer text by question node id", () => {
    const ctx = buildMergeContext(
      [{ questionNodeId: "q1", answerIds: ["a1"] }],
      docFixture,
    );
    expect(ctx["answer.q1"]).toBe("Oily");
  });

  it("merges ambient name/email", () => {
    const ctx = buildMergeContext([], docFixture, {
      name: "Anna",
      email: "a@b.co",
    });
    expect(ctx.name).toBe("Anna");
    expect(ctx.email).toBe("a@b.co");
  });

  it("ignores unknown answer ids", () => {
    const ctx = buildMergeContext(
      [{ questionNodeId: "q1", answerIds: ["zz"] }],
      docFixture,
    );
    expect(ctx["answer.q1"]).toBeUndefined();
  });
});

describe("resolveMergeTags", () => {
  it("substitutes known tags", () => {
    const out = resolveMergeTags("Hi @name — skin is @answer.q1", {
      name: "Anna",
      "answer.q1": "Oily",
    });
    expect(out).toBe("Hi Anna — skin is Oily");
  });

  it("leaves unknown tags untouched", () => {
    const out = resolveMergeTags("Hi @missing", { name: "Anna" });
    expect(out).toBe("Hi @missing");
  });

  it("handles multiple substitutions in one string", () => {
    const out = resolveMergeTags("@name @name @answer.q1", {
      name: "Anna",
      "answer.q1": "Oily",
    });
    expect(out).toBe("Anna Anna Oily");
  });

  it("end-to-end with buildMergeContext", () => {
    const ctx = buildMergeContext(
      [{ questionNodeId: "q1", answerIds: ["a2"] }],
      docFixture,
      { name: "Sam" },
    );
    const msg = docFixture.nodes.find((n) => n.id === "m1");
    if (!msg || msg.type !== "message") throw new Error("fixture broken");
    expect(resolveMergeTags(msg.data.text, ctx)).toBe(
      "Hi Sam — skin is Dry",
    );
  });
});

describe("resolveCopyTokens ({{ }} for Why-we-recommend copy)", () => {
  it("substitutes {{name}} / {{answer.<id>}} and tolerates spaces", () => {
    const out = resolveCopyTokens("Hi {{name}}, skin is {{ answer.q1 }}", {
      name: "Anna",
      "answer.q1": "Oily",
    });
    expect(out).toBe("Hi Anna, skin is Oily");
  });

  it("resolves the {{answers}} alias to the joined picked answers", () => {
    const out = resolveCopyTokens("For {{answers}}.", {}, ["Oily", "Sensitive"]);
    expect(out).toBe("For Oily, Sensitive.");
  });

  it("leaves unknown tokens and empty answers untouched", () => {
    expect(resolveCopyTokens("Hi {{missing}}", { name: "A" })).toBe("Hi {{missing}}");
    expect(resolveCopyTokens("For {{answers}}.", {}, [])).toBe("For {{answers}}.");
  });

  it("does not touch @-style tags (different syntax)", () => {
    expect(resolveCopyTokens("Hi @name", { name: "Anna" })).toBe("Hi @name");
  });
});
