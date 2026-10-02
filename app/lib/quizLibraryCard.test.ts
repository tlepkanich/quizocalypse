import { describe, it, expect } from "vitest";
import { quizCardFacts } from "./quizLibraryCard";

const q = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "question",
  data: {
    text,
    question_type: "single_choice",
    answers: [{ id: `${id}-a`, text: "A" }, { id: `${id}-b`, text: "B" }],
    ...extra,
  },
});
const edge = (source: string, target: string, source_handle?: string) => ({
  id: `${source}-${target}${source_handle ? `-${source_handle}` : ""}`,
  source,
  target,
  ...(source_handle ? { source_handle } : {}),
});

describe("§R-7 quizCardFacts", () => {
  it("counts questions and distinct persona targets", () => {
    const doc = {
      nodes: [
        { type: "intro", data: { headline: "Find your match", button_label: "Begin" } },
        { type: "question", data: { answers: [{ target_id: "g1" }, { target_id: "g2" }] } },
        { type: "question", data: { answers: [{ target_id: "g1" }, { target_id: "g3" }] } },
      ],
    };
    const f = quizCardFacts(doc);
    expect(f.questions).toBe(2);
    expect(f.personas).toBe(3); // g1,g2,g3 deduped
  });

  it("falls back to result-node count when no answer targets exist", () => {
    const doc = {
      nodes: [
        { type: "intro", data: {} },
        { type: "question", data: { answers: [{}, {}] } },
        { type: "result", data: {} },
        { type: "result", data: {} },
      ],
    };
    const f = quizCardFacts(doc);
    expect(f.questions).toBe(1);
    expect(f.personas).toBe(2);
  });

  it("never throws on a junk/empty doc (defensive — cosmetic facts)", () => {
    expect(quizCardFacts(null).questions).toBe(0);
    expect(quizCardFacts(undefined).personas).toBe(0);
    expect(quizCardFacts({ nodes: "not-an-array" }).questions).toBe(0);
    expect(quizCardFacts(42).opening).toBeNull();
  });

  it("does not modify the doc", () => {
    const doc = {
      nodes: [{ id: "intro", type: "intro", data: {} }, q("q1", "First?")],
      edges: [edge("intro", "q1")],
    };
    const before = JSON.stringify(doc);
    quizCardFacts(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("Quizzes tab — the opening question", () => {
  it("returns the flow's first question when nodes order differs from flow order", () => {
    const doc = {
      nodes: [
        { id: "intro", type: "intro", data: {} },
        q("q2", "Second in the flow"),
        q("q1", "  First in the flow  "),
      ],
      edges: [edge("intro", "q1"), edge("q1", "q2")],
    };
    expect(quizCardFacts(doc).opening).toEqual({
      text: "First in the flow",
      kind: "choices",
      questionType: "single_choice",
      answers: ["A", "B"],
      answerCount: 2,
    });
  });

  it("returns Q1 on a decider doc with a per-answer route", () => {
    const doc = {
      logic_model: "decider",
      nodes: [
        { id: "intro", type: "intro", data: {} },
        q("q3", "Routed to"),
        q("q2", "Default next"),
        q("q1", "Opening"),
      ],
      edges: [
        edge("intro", "q1"),
        edge("q1", "q2"),
        edge("q1", "q3", "q1-a"),
        edge("q2", "q3"),
      ],
    };
    expect(quizCardFacts(doc).opening?.text).toBe("Opening");
  });

  it.each(["text", "email", "numeric", "date", "slider"])("a %s question is typed and never shows its seed answer", (type) => {
    const doc = {
      nodes: [q("q1", "Tell us", { question_type: type, answers: [{ id: "seed", text: "seed answer" }] })],
      edges: [],
    };
    const opening = quizCardFacts(doc).opening;
    expect(opening).toEqual({ text: "Tell us", kind: "typed", questionType: type, answers: [], answerCount: 0 });
  });

  it("returns the first four labels and the full count, skipping empty labels and every non-text field", () => {
    const answers = ["One", "Two", "", "Three", "Four", "Five", "Six", "Seven"].map((text, i) => ({
      id: `a${i}`, text, icon: "★", image_url: "https://example.com/x.jpg",
    }));
    const opening = quizCardFacts({ nodes: [q("q1", "Pick", { answers })], edges: [] }).opening;
    expect(opening?.answers).toEqual(["One", "Two", "Three", "Four"]);
    expect(opening?.answerCount).toBe(7);
    expect(JSON.stringify(opening)).not.toContain("example.com");
  });

  it("returns empty text for an untitled question (the card draws the placeholder)", () => {
    expect(quizCardFacts({ nodes: [q("q1", "   ")], edges: [] }).opening?.text).toBe("");
  });

  it("returns null when there are no questions yet", () => {
    expect(quizCardFacts({ nodes: [{ id: "intro", type: "intro", data: {} }], edges: [] }).opening).toBeNull();
  });

  it("never throws on malformed docs: null opening or the nodes-order fallback", () => {
    expect(quizCardFacts(null).opening).toBeNull();
    expect(quizCardFacts(42).opening).toBeNull();
    expect(quizCardFacts({ nodes: "x" }).opening).toBeNull();
    // No edges → orderedQuestions is never called; nodes order wins.
    const noEdges = { nodes: [{ id: "intro", type: "intro", data: {} }, q("qa", "Nodes first"), q("qb", "Nodes second")] };
    expect(quizCardFacts(noEdges).opening?.text).toBe("Nodes first");
    // Edges that would throw inside orderFlow → caught; nodes order wins.
    const badEdges = { nodes: [q("qa", "Fallback"), null, { type: "question" }], edges: [null, 7] };
    expect(() => quizCardFacts(badEdges)).not.toThrow();
    expect(quizCardFacts(badEdges).opening?.text).toBe("Fallback");
    // A question with no data at all still yields an (empty) opening.
    expect(quizCardFacts({ nodes: [{ type: "question" }] }).opening).toEqual({
      text: "", kind: "choices", questionType: "", answers: [], answerCount: 0,
    });
  });
});
